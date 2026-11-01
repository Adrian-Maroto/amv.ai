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

const WS_VERSIONS = 5;
/* How many times an idle machine whose save failed is kept up to try again
   before it is stopped anyway (Nov 1 audit COMP-001). Each try is one more
   sleepAfter window of awake time, which the provider bills - so it is
   bounded, and a stop without a save is recorded and told, never silent. */
const WS_SAVE_TRIES = 3;

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
  /* EARLIER COPIES (Oct 31 audit, item 33: versioning). Before a save
     replaces the copy, the copy it replaces is kept under this prefix, named
     by when it was saved; the newest WS_VERSIONS are kept and older ones
     deleted. A person can put any of them back (rollback below), which first
     keeps the current copy too - so putting one back can itself be undone. */
  _wsVerPrefix() { return 'ws/' + this.ctx.id.toString() + '.v/'; }
  /* `verify: false` keeps a copy whose bytes do not match its recorded
     checksum (one a restore refused) without the bucket refusing it - the
     checksum stays in its metadata, so a later restore still refuses it. */
  async _wsCopy(from, to, opts) {
    const obj = await this.env.WORKSPACES.get(from);
    if (!obj) return false;
    const { readable, writable } = new FixedLengthStream(obj.size);
    const done = obj.body.pipeTo(writable);
    const sha = obj.customMetadata && obj.customMetadata.sha256;
    const verify = !(opts && opts.verify === false);
    await this.env.WORKSPACES.put(to, readable, Object.assign({ httpMetadata: { contentType: 'application/gzip' } },
      sha ? Object.assign(verify ? { sha256: sha } : {}, { customMetadata: { sha256: sha } }) : {}));
    await done;
    return true;
  }
  async _wsVersions() {
    const out = [];
    let cursor;
    do {
      const page = await this.env.WORKSPACES.list({ prefix: this._wsVerPrefix(), cursor });
      for (const o of page.objects || []) {
        const m = /\/(\d{13})\.tgz$/.exec(o.key);
        if (m) out.push({ id: m[1], at: new Date(+m[1]).toISOString(), bytes: o.size, key: o.key });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return out.sort((a, b) => b.id.localeCompare(a.id));
  }
  async _wsKeepCurrent(opts) {
    const key = this._wsVerPrefix() + Date.now() + '.tgz';
    const kept = await this._wsCopy(this._wsKey(), key, opts);
    const all = await this._wsVersions();
    for (const v of all.slice(WS_VERSIONS)) await this.env.WORKSPACES.delete(v.key);
    return kept;
  }
  _wsOn() { return !!(this.env && this.env.WORKSPACES && typeof this.env.WORKSPACES.put === 'function'); }
  /* The container's own port, directly: containerFetch would try to start a
     container that is already starting. */
  async _bridge(path, init) {
    const headers = Object.assign({ 'X-AMV-Bridge-Token': String(this.env.AMV_COMPUTER_KEY || '') }, (init && init.headers) || {});
    return this.container.getTcpPort(8080).fetch('http://container/amv-bridge/' + path, Object.assign({}, init || {}, { headers }));
  }

  /* THE WORKSPACE'S STATE, KEPT WHERE A RESTART CANNOT LOSE IT (Nov 1 audit
     COMP-001/002): this object's own storage. `restoreFailed` - the saved
     copy could not be put back, so the machine's disk is not the person's
     workspace; `saveFails` - idle saves that failed in a row; `lostUnsaved`
     - the machine was stopped without its last save, and when. */
  async _st() {
    const s = this.ctx && this.ctx.storage;
    if (s && typeof s.get === 'function') return (await s.get('ws_state')) || {};
    return this._memState || {};
  }
  async _setSt(patch) {
    const next = Object.assign({}, await this._st(), patch);
    for (const k of Object.keys(next)) if (next[k] == null || next[k] === false || next[k] === 0) delete next[k];
    const s = this.ctx && this.ctx.storage;
    if (s && typeof s.put === 'function') await s.put('ws_state', next); else this._memState = next;
    return next;
  }

  async onStart() {
    if (!this._wsOn()) return;
    let why = '';
    try {
      const obj = await this.env.WORKSPACES.get(this._wsKey());
      if (!obj) { await this._setSt({ restoreFailed: null }); return; }
      const sha = obj.customMetadata && obj.customMetadata.sha256;
      const r = await this._bridge('restore', { method: 'PUT', body: obj.body, headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(obj.size), ...(sha ? { 'X-AMV-SHA256': sha } : {}) } });
      console.log(JSON.stringify({ event: r.ok ? 'workspace_restored' : 'workspace_restore_failed', status: r.status, bytes: obj.size }));
      if (r.ok) { await this._setSt({ restoreFailed: null }); return; }
      why = 'the copy could not be unpacked (' + r.status + ')';
    } catch (e) {
      why = String((e && e.message) || e).slice(0, 160);
      console.log(JSON.stringify({ event: 'workspace_restore_failed', error: why }));
    }
    /* NOT A FRESH WORKSPACE. The disk is empty or partial, so nothing may be
       saved over the good copy and no work may run on it as though it were
       theirs: the machine refuses work (fetch below) until a restore works
       on a later start, the person puts back an earlier copy, or they
       choose to start fresh - which keeps the copy first. */
    await this._setSt({ restoreFailed: { at: Date.now(), why } });
  }

  /* Saves the running machine's workspace as the copy (the copy it replaces
     becomes an earlier copy). True when it was saved. */
  async _wsSave() {
    let saved = false;
    /* Never over the good copy from a machine that did not get it back. */
    if ((await this._st()).restoreFailed) {
      console.log(JSON.stringify({ event: 'workspace_not_saved', why: 'restore_failed' }));
      return false;
    }
    try {
      const r = await this._bridge('snapshot', { method: 'GET' });
      const size = Number(r.headers.get('Content-Length')) || 0;
      if (r.ok && size > 0 && r.body) {
        /* Streamed into storage at its stated length - a workspace can be
           far larger than this object's memory. */
        const { readable, writable } = new FixedLengthStream(size);
        const done = r.body.pipeTo(writable);
        /* With its checksum: the bucket checks the bytes it received against
           it and refuses the upload if they differ (the last good copy
           stays), and the restore checks it again before unpacking. */
        const sha = String(r.headers.get('X-AMV-SHA256') || '').toLowerCase();
        const ok = /^[0-9a-f]{64}$/.test(sha);
        /* The copy about to be replaced becomes an earlier copy. Failing to
           keep it is logged and does not stop today's save. */
        try { await this._wsKeepCurrent(); } catch (e) { console.log(JSON.stringify({ event: 'workspace_version_not_kept', error: String((e && e.message) || e).slice(0, 160) })); }
        await this.env.WORKSPACES.put(this._wsKey(), readable, Object.assign({ httpMetadata: { contentType: 'application/gzip' } },
          ok ? { sha256: sha, customMetadata: { sha256: sha } } : {}));
        await done;
        console.log(JSON.stringify({ event: 'workspace_saved', bytes: size }));
        saved = true;
      } else {
        /* Too large or unreadable: the last good copy stays as it was,
           rather than being replaced by nothing. */
        console.log(JSON.stringify({ event: 'workspace_not_saved', status: r.status }));
        try { await r.body?.cancel(); } catch (e) {}
      }
    } catch (e) {
      console.log(JSON.stringify({ event: 'workspace_not_saved', error: String((e && e.message) || e).slice(0, 160) }));
    }
    return saved;
  }

  async onActivityExpired() {
    if (this._wsOn() && this.container.running && !(await this._st()).restoreFailed) {
      if (await this._wsSave()) {
        await this._setSt({ saveFails: null });
      } else {
        /* NOT STOPPED ON A FAILED SAVE (COMP-001): the disk holds work the
           saved copy does not. Kept up for another idle window to try again;
           after WS_SAVE_TRIES it is stopped anyway - a machine that can never
           save would otherwise run, and bill, for ever - and that loss is
           recorded for the person to be told, with the last good copy kept. */
        const st = await this._setSt({ saveFails: ((await this._st()).saveFails || 0) + 1 });
        if (st.saveFails < WS_SAVE_TRIES) {
          console.log(JSON.stringify({ event: 'workspace_save_retry', tries: st.saveFails }));
          return;
        }
        await this._setSt({ saveFails: null, lostUnsaved: { at: Date.now(), tries: st.saveFails } });
        console.log(JSON.stringify({ event: 'workspace_stopped_unsaved', tries: st.saveFails }));
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
      if (this._wsOn()) {
        await this.env.WORKSPACES.delete(this._wsKey());
        for (const v of await this._wsVersions()) await this.env.WORKSPACES.delete(v.key);
        await this.env.WORKSPACES.delete('ws/' + this.ctx.id.toString() + '.restore.tgz');
      }
      try { if (this.container.running) await this.destroy(); } catch (e) {}
      return new Response(JSON.stringify({ forgotten: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    /* The earlier copies, and putting one back. AMV's key only - the main
       Worker reaches this with the person's sign-in checked, never the page. */
    if (url.pathname === '/amv-workspace/versions' || url.pathname === '/amv-workspace/rollback' || url.pathname === '/amv-workspace/fresh') {
      const reply = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
      if (request.headers.get('X-AMV-Bridge-Token') !== String(this.env.AMV_COMPUTER_KEY || '') || !this.env.AMV_COMPUTER_KEY)
        return reply({ error: 'not_allowed' }, 401);
      if (!this._wsOn()) return reply({ error: 'Saved copies are not switched on for this deployment.', code: 'needs_service' }, 503);
      if (url.pathname === '/amv-workspace/versions') {
        const cur = await this.env.WORKSPACES.get(this._wsKey());
        const current = cur ? { bytes: cur.size, at: cur.uploaded ? new Date(cur.uploaded).toISOString() : null } : null;
        if (cur) try { await cur.body.cancel(); } catch (e) {}
        const st = await this._st();
        /* What the person must be told: the copy could not be put back, or
           the machine stopped without its last save. Seen once, then gone. */
        if (st.lostUnsaved) await this._setSt({ lostUnsaved: null });
        return reply({ current, versions: (await this._wsVersions()).map(({ id, at, bytes }) => ({ id, at, bytes })),
          state: { restoreFailed: st.restoreFailed || null, lostUnsaved: st.lostUnsaved || null } });
      }
      /* START FRESH after a failed restore, on purpose: the copy that could
         not be put back is kept as an earlier copy first, then the machine
         is stopped and starts empty. */
      if (url.pathname === '/amv-workspace/fresh') {
        if (!(await this._st()).restoreFailed) return reply({ error: 'The workspace is fine; there is nothing to start fresh from.', code: 'not_needed' }, 409);
        /* Kept as it is, checksum and all - if it cannot be kept, nothing is
           deleted and the person is told. */
        try { await this._wsKeepCurrent({ verify: false }); }
        catch (e) { return reply({ error: 'The copy that could not be put back could not be kept, so nothing was changed. Try again in a minute.', code: 'keep_failed' }, 503); }
        await this.env.WORKSPACES.delete(this._wsKey());
        await this._setSt({ restoreFailed: null });
        try { if (this.container.running) await this.destroy(); } catch (e) {}
        console.log(JSON.stringify({ event: 'workspace_started_fresh' }));
        return reply({ fresh: true });
      }
      const body = await request.json().catch(() => ({}));
      const id = String(body.id || '');
      if (!/^\d{13}$/.test(id)) return reply({ error: 'Choose one of the saved copies.', code: 'bad_request' }, 400);
      const key = this._wsVerPrefix() + id + '.tgz';
      const there = typeof this.env.WORKSPACES.head === 'function' ? await this.env.WORKSPACES.head(key) : await this.env.WORKSPACES.get(key);
      if (!there) return reply({ error: 'That saved copy is no longer kept.', code: 'not_found' }, 404);
      /* The copy in use now is kept first, so this can be undone; then the
         chosen one becomes the copy, and the machine is stopped so the next
         start unpacks it (a running machine's disk is newer than any copy,
         and is not saved on top of the one just chosen). */
      /* The chosen copy is set aside FIRST: keeping the current copy prunes
         to the newest five, and the one chosen may be the oldest of them. */
      const stage = 'ws/' + this.ctx.id.toString() + '.restore.tgz';
      if (!(await this._wsCopy(key, stage))) return reply({ error: 'That saved copy could not be read.', code: 'not_found' }, 404);
      /* What is on a running machine is saved first, and then whatever the
         copy now is - that, or the last save - is kept as an earlier copy,
         so the put-back can itself be undone. */
      /* A running machine whose work cannot be saved is not rolled back over:
         that would throw the work away. Unless it never got its copy back -
         then its disk is not their work, and the rollback is the remedy. */
      if (this.container.running && !(await this._st()).restoreFailed && !(await this._wsSave())) {
        await this.env.WORKSPACES.delete(stage);
        return reply({ error: 'What is in the workspace now could not be saved first, so nothing was put back. Try again in a minute.', code: 'save_failed' }, 409);
      }
      /* After a failed restore the copy is the one that could not be put back:
         kept as it is, its checksum still in its metadata. */
      await this._wsKeepCurrent((await this._st()).restoreFailed ? { verify: false } : undefined);
      const moved = await this._wsCopy(stage, this._wsKey());
      await this.env.WORKSPACES.delete(stage);
      if (!moved) return reply({ error: 'That saved copy could not be read.', code: 'not_found' }, 404);
      await this._setSt({ restoreFailed: null });
      try { if (this.container.running) await this.destroy(); } catch (e) {}
      console.log(JSON.stringify({ event: 'workspace_rolled_back', to: id }));
      return reply({ restored: true, id });
    }
    /* A machine that did not get its workspace back does no work (COMP-002):
       a command run there would run on an empty disk as though it were
       theirs. The page is told why and offered the remedies. */
    if ((await this._st()).restoreFailed)
      return new Response(JSON.stringify({ error: 'Your saved workspace could not be put back on this machine, so it is not running anything until it is. Put back an earlier saved copy, or start fresh (the copy is kept).', code: 'workspace_restore_failed' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } });
    const res = await super.fetch(request);
    /* The request that started the machine ran its restore first; if that
       failed, its answer came from an empty disk and is not handed back. */
    if ((await this._st()).restoreFailed)
      return new Response(JSON.stringify({ error: 'Your saved workspace could not be put back on this machine, so that was not run. Put back an earlier saved copy, or start fresh (the copy is kept).', code: 'workspace_restore_failed' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } });
    return res;
  }
}

/* Nothing is served from this Worker directly. */
export default {
  async fetch() { return new Response('Not found', { status: 404 }); },
};
