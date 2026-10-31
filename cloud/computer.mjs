/* ══════════════════════════════════════════════════════════════════════════
   AMV'S CLOUD COMPUTER - one container per person, running the AMV bridge.

   A Worker of its own (deployed from this folder, wrangler.toml here), so the
   main Worker never imports the container runtime: it reaches these through a
   Durable Object binding by name (AMV_COMPUTER, script_name "amv-computer").

   Each person's container is a separate instance, started on first use and
   asleep after ten minutes with nothing to do. Inside it is the same bridge
   people run on their own machines, in --cloud mode: no pairing, no screen,
   and every request must carry the key this Worker starts it with. Nothing
   outside reaches the container's port - only the Durable Object below.

   It may reach the internet (installing packages, cloning repositories), and
   it may not reach private and internal addresses: the cloud provider's
   metadata service and the private ranges are refused before they leave. */
import { Container } from '@cloudflare/containers';
export { ContainerProxy } from '@cloudflare/containers';

export class AMVComputer extends Container {
  defaultPort = 8080;
  /* Kept in step with COMPUTER_AWAKE_S in amv-backend.js, which bills this
     tail: a machine is paid for while it is awake, not while it computes. */
  sleepAfter = '5m';
  enableInternet = true;
  deniedHosts = [
    'localhost', '*.localhost', '*.internal', 'metadata', 'metadata.*',
    '169.254.*', '127.*', '0.*', '10.*', '192.168.*',
    '172.16.*', '172.17.*', '172.18.*', '172.19.*', '172.20.*', '172.21.*', '172.22.*', '172.23.*',
    '172.24.*', '172.25.*', '172.26.*', '172.27.*', '172.28.*', '172.29.*', '172.30.*', '172.31.*',
    '100.64.*', '[*',
  ];
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = { AMV_CLOUD_KEY: String((env && env.AMV_COMPUTER_KEY) || ''), PORT: '8080' };
  }

  /* ── THE WORKSPACE OUTLIVES THE CONTAINER ────────────────────────────────
     A container's disk goes when it stops. With the WORKSPACES bucket bound
     (wrangler.toml here), the workspace is saved before the container is
     stopped for being idle, and put back when the next one starts - before
     any request reaches it, because onStart runs while requests wait. One
     object per person's machine, named by this object's id, which is itself
     a hash of the account (the main Worker names it), so no address or name
     is in the key. Without the bucket nothing changes: the workspace lasts
     as long as the container, which the page says. */
  _wsKey() { return 'ws/' + this.ctx.id.toString() + '.tgz'; }
  _wsOn() { return !!(this.env && this.env.WORKSPACES && typeof this.env.WORKSPACES.put === 'function'); }
  /* The container's own port, directly: containerFetch would try to start a
     container that is already starting. */
  async _bridge(path, init) {
    const headers = Object.assign({ 'X-AMV-Bridge-Token': String(this.env.AMV_COMPUTER_KEY || '') }, (init && init.headers) || {});
    return this.container.getTcpPort(8080).fetch('http://container/amv-bridge/' + path, Object.assign({}, init || {}, { headers }));
  }

  async onStart() {
    if (!this._wsOn()) return;
    try {
      const obj = await this.env.WORKSPACES.get(this._wsKey());
      if (!obj) return;
      const r = await this._bridge('restore', { method: 'PUT', body: obj.body, headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(obj.size) } });
      console.log(JSON.stringify({ event: r.ok ? 'workspace_restored' : 'workspace_restore_failed', status: r.status, bytes: obj.size }));
    } catch (e) {
      /* An empty workspace is worse than a slow one, but a machine that never
         starts is worse than both: logged, and the saved copy is kept for the
         next start. */
      console.log(JSON.stringify({ event: 'workspace_restore_failed', error: String((e && e.message) || e).slice(0, 160) }));
    }
  }

  async onActivityExpired() {
    if (this._wsOn() && this.container.running) {
      try {
        const r = await this._bridge('snapshot', { method: 'GET' });
        const size = Number(r.headers.get('Content-Length')) || 0;
        if (r.ok && size > 0 && r.body) {
          /* Streamed into storage at its stated length - a workspace can be
             far larger than this object's memory. */
          const { readable, writable } = new FixedLengthStream(size);
          const done = r.body.pipeTo(writable);
          await this.env.WORKSPACES.put(this._wsKey(), readable, { httpMetadata: { contentType: 'application/gzip' } });
          await done;
          console.log(JSON.stringify({ event: 'workspace_saved', bytes: size }));
        } else {
          /* Too large or unreadable: the last good copy stays as it was,
             rather than being replaced by nothing. */
          console.log(JSON.stringify({ event: 'workspace_not_saved', status: r.status }));
          try { await r.body?.cancel(); } catch (e) {}
        }
      } catch (e) {
        console.log(JSON.stringify({ event: 'workspace_not_saved', error: String((e && e.message) || e).slice(0, 160) }));
      }
    }
    await this.stop();
  }

  /* The main Worker forgets a person's saved workspace when their account is
     erased or they sign out everywhere: one request, with AMV's key. */
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/amv-workspace/forget') {
      if (request.headers.get('X-AMV-Bridge-Token') !== String(this.env.AMV_COMPUTER_KEY || '') || !this.env.AMV_COMPUTER_KEY)
        return new Response(JSON.stringify({ error: 'not_allowed' }), { status: 401 });
      if (this._wsOn()) await this.env.WORKSPACES.delete(this._wsKey());
      try { if (this.container.running) await this.destroy(); } catch (e) {}
      return new Response(JSON.stringify({ forgotten: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    return super.fetch(request);
  }
}

/* Nothing is served from this Worker directly. */
export default {
  async fetch() { return new Response('Not found', { status: 404 }); },
};
