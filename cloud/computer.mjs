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
/* How many failed idle saves in a row before the machine is HELD and the
   person told (Nov 3 audit COMP-016). It is never stopped with work it could
   not save: it keeps trying at every idle window until a save works or the
   person chooses to discard the work. Its awake time is metered as always. */
const WS_SAVE_TRIES = 3;
/* A CHECKPOINT WHILE IT IS IN USE (Nov 1 audit COMP-015). The idle save is
   the only save if nothing else happens - but the platform can stop a
   container for its own reasons (a host moved, a release rolled out), and
   then nothing since the last idle save survives. So a machine in use is
   also saved at most every WS_CHECKPOINT_MS, in the background of a request,
   never twice at once. What a platform stop can lose is then minutes. */
const WS_CHECKPOINT_MS = 10 * 60 * 1000;

/* ── ONE KEY PER MACHINE, ONE TOKEN PER CALL (Nov 1 audit COMP-006) ───────

   The root key (AMV_COMPUTER_KEY) used to be handed to every container as
   its bridge key, and the person's own code runs in that container - so a
   program reading its own process table held the key of the whole fleet.
   Now the root key never leaves the two Workers:
     - each container gets a key DERIVED from the root, this machine's id and
       a counter that moves every time the container starts. A key read out
       of a container opens that one machine (its owner's), and only until it
       next starts - stopping a machine revokes its key, nothing else rotates;
     - every call from the main Worker carries a token signed with the root
       for THIS machine's id and THIS path, good for a minute and once: a
       token for one person's machine is refused by every other one.
   An incoming root key is never passed on to the container. */
const CALL_TTL_MS = 60 * 1000;
const _enc = new TextEncoder();
async function _hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', _enc.encode(String(key)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, _enc.encode(msg)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function _sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* The names a save recorded as changing while it was read, or nothing. */
function _wsChanging(meta) {
  if (!meta || !meta.changing) return {};
  try { const v = JSON.parse(decodeURIComponent(meta.changing)); return Array.isArray(v) ? { changing: v.slice(0, 20).map(String) } : {}; } catch (e) { return {}; }
}

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
    /* The bridge key is filled in (_machineKey) before the container starts. */
    this.envVars = { PORT: '8080' };
  }

  async _kv(k) { const s = this.ctx && this.ctx.storage; if (s && typeof s.get === 'function') return s.get(k); return (this._mem || {})[k]; }
  async _kvPut(k, v) { const s = this.ctx && this.ctx.storage; if (s && typeof s.put === 'function') return s.put(k, v); (this._mem = this._mem || {})[k] = v; }
  /* This machine's bridge key: derived, never the root. `fresh` moves the
     counter first - called only when a container is about to start. */
  async _machineKey(fresh) {
    const root = String((this.env && this.env.AMV_COMPUTER_KEY) || '');
    if (root.length < 32) return '';
    if (fresh || !this._key) {
      let epoch = +(await this._kv('key_epoch')) || 0;
      if (fresh) { epoch += 1; await this._kvPut('key_epoch', epoch); }
      this._key = await _hmacHex(root, 'amv-computer-machine\nv1\n' + this.ctx.id.toString() + '\n' + epoch);
      this.envVars = Object.assign({}, this.envVars, { AMV_CLOUD_KEY: this._key });
    }
    return this._key;
  }
  /* A call from the main Worker: signed for this machine, this path, THIS
     METHOD AND BODY, within the minute, and not seen before (Nov 3 audit
     COMP-018). The token used to cover the path alone, so one captured in
     the minute it lived could carry a different command; and the record of
     tokens already used was in memory, so a restart forgot it. The body's
     SHA-256 and the method are signed now, and a used token is kept in this
     object's own storage until it expires. */
  async _callOk(request, path) {
    const root = String((this.env && this.env.AMV_COMPUTER_KEY) || '');
    if (root.length < 32) return false;
    const t = String(request.headers.get('X-AMV-Computer-Call') || '').split('.');
    if (t.length !== 4 || t[0] !== 'v2' || !/^\d{13}$/.test(t[1]) || !/^[0-9a-f]{32}$/.test(t[2]) || !/^[0-9a-f]{64}$/.test(t[3])) return false;
    const exp = +t[1], now = Date.now();
    if (exp < now || exp > now + CALL_TTL_MS + 5000) return false;
    let body = '';
    try { body = await request.clone().text(); } catch (e) { return false; }
    const bodySha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', _enc.encode(body)))].map(b => b.toString(16).padStart(2, '0')).join('');
    const want = await _hmacHex(root, ['amv-computer-call', 'v2', this.ctx.id.toString(), String(request.method || 'POST').toUpperCase(), path, bodySha, t[1], t[2]].join('\n'));
    if (!_sameHex(want, t[3])) return false;
    const used = (await this._kv('call_used')) || {};
    for (const n of Object.keys(used)) if (used[n] < now) delete used[n];
    if (used[t[2]]) return false;
    used[t[2]] = exp;
    await this._kvPut('call_used', used);
    return true;
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
      sha ? Object.assign(verify ? { sha256: sha } : {}, { customMetadata: Object.assign({}, obj.customMetadata, { sha256: sha }) })
        : (obj.customMetadata ? { customMetadata: Object.assign({}, obj.customMetadata) } : {})));
    await done;
    /* Read back before it counts (Nov 3 audit COMP-009): the copy is there,
       at its full size, or this did not happen. */
    const back = typeof this.env.WORKSPACES.head === 'function' ? await this.env.WORKSPACES.head(to) : await this.env.WORKSPACES.get(to);
    if (!back || +back.size !== +obj.size) return false;
    return true;
  }
  async _wsVersions() {
    const out = [];
    let cursor;
    do {
      const page = await this.env.WORKSPACES.list({ prefix: this._wsVerPrefix(), cursor, include: ['customMetadata'] });
      for (const o of page.objects || []) {
        const m = /\/(\d{13}(?:-[0-9a-f]{8})?)\.tgz$/.exec(o.key);
        if (m) out.push(Object.assign({ id: m[1], at: new Date(+m[1].slice(0, 13)).toISOString(), bytes: o.size, key: o.key }, _wsChanging(o.customMetadata)));
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return out.sort((a, b) => b.id.localeCompare(a.id));
  }
  async _wsKeepCurrent(opts) {
    /* The millisecond orders the copies; eight random hex characters after
       it keep two copies made in the same millisecond apart (Nov 1 audit
       COMP-008) - the second used to overwrite the first. */
    const key = this._wsVerPrefix() + Date.now() + '-' + [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('') + '.tgz';
    const kept = await this._wsCopy(this._wsKey(), key, opts);
    /* Older copies are pruned only once the new one is confirmed: a copy
       that did not land must not cost the person their oldest good one. */
    if (!kept) return false;
    const all = await this._wsVersions();
    for (const v of all.slice(WS_VERSIONS)) await this.env.WORKSPACES.delete(v.key);
    return kept;
  }
  _wsOn() { return !!(this.env && this.env.WORKSPACES && typeof this.env.WORKSPACES.put === 'function'); }
  /* The container's own port, directly: containerFetch would try to start a
     container that is already starting. */
  async _bridge(path, init) {
    const headers = Object.assign({}, (init && init.headers) || {}, { 'X-AMV-Bridge-Token': await this._machineKey(false) });
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
      /* A copy saved before checksums (COMP-017) is not trusted silently: it
         is held back, the person is told, and it is unpacked only when they
         choose to use it anyway (`/amv-workspace/trust`). Saved again, it
         gets its checksum. */
      if (!sha && !(await this._st()).trustOnce) {
        try { await obj.body.cancel(); } catch (e) {}
        await this._setSt({ restoreFailed: { at: Date.now(), why: 'saved without a checksum', unverified: true } });
        console.log(JSON.stringify({ event: 'workspace_restore_held', why: 'no_checksum' }));
        return;
      }
      if (!sha) await this._setSt({ trustOnce: null });
      const r = await this._bridge('restore', { method: 'PUT', body: obj.body, headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(obj.size), ...(sha ? { 'X-AMV-SHA256': sha } : {}) } });
      console.log(JSON.stringify({ event: r.ok ? 'workspace_restored' : 'workspace_restore_failed', status: r.status, bytes: obj.size }));
      if (r.ok) {
        await this._setSt({ restoreFailed: null });
        /* Its own setup, when the image changed under it (COMP-014). The
           outcome is kept for the person to see; a setup that fails leaves
           the files exactly as restored and the machine usable. */
        try {
          const su = await this._bridge('setup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageWas: (obj.customMetadata && obj.customMetadata.image) || '' }) });
          const d = await su.json().catch(() => ({}));
          if (d && d.ran) {
            await this._setSt({ setup: { at: Date.now(), ok: !!d.ok, image: d.image || '', imageWas: d.imageWas || '' } });
            console.log(JSON.stringify({ event: d.ok ? 'workspace_setup_done' : 'workspace_setup_failed', image: d.image || '', was: d.imageWas || '' }));
          }
        } catch (e) { console.log(JSON.stringify({ event: 'workspace_setup_failed', error: String((e && e.message) || e).slice(0, 160) })); }
        return;
      }
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
        /* NEVER A COPY WITHOUT ITS CHECKSUM (Nov 3 audit COMP-017). A snapshot
           the bridge sent without a valid SHA-256 used to be stored anyway,
           and restored later with nothing to check it against. It is not
           saved: the last good copy stays, and this counts as a failed save. */
        if (!ok) {
          try { await r.body.cancel(); } catch (e) {}
          console.log(JSON.stringify({ event: 'workspace_not_saved', why: 'no_checksum' }));
          return false;
        }
        /* Files that kept changing on every try while it was read (Nov 1
           audit COMP-004): kept with the copy, so it says which may be torn. */
        const changing = String(r.headers.get('X-AMV-Changing') || '').slice(0, 2000);
        /* The image it was running on, so a restore onto another one knows
           to rebuild the workspace's tools (COMP-014). */
        const image = String(r.headers.get('X-AMV-Image') || '').slice(0, 60);
        const meta = Object.assign({ sha256: sha }, changing ? { changing } : {}, image ? { image } : {});
        /* The copy about to be replaced becomes an earlier copy. Failing to
           keep it is logged and does not stop today's save. */
        try { await this._wsKeepCurrent(); } catch (e) { console.log(JSON.stringify({ event: 'workspace_version_not_kept', error: String((e && e.message) || e).slice(0, 160) })); }
        await this.env.WORKSPACES.put(this._wsKey(), readable, Object.assign({ httpMetadata: { contentType: 'application/gzip' } },
          { sha256: sha, customMetadata: meta }));
        await done;
        console.log(JSON.stringify(Object.assign({ event: 'workspace_saved', bytes: size }, changing ? { changing: true } : {})));
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

  async _checkpointMaybe() {
    if (!this._wsOn() || !this.container.running || this._checkpointing) return;
    const st = await this._st();
    if (st.restoreFailed) return;
    const last = +(await this._kv('ws_saved_at')) || 0;
    if (!last) { await this._kvPut('ws_saved_at', Date.now()); return; }   // the first request starts the clock
    if (Date.now() - last < WS_CHECKPOINT_MS) return;
    this._checkpointing = true;
    const run = (async () => {
      try { if (await this._wsSave()) { await this._kvPut('ws_saved_at', Date.now()); console.log(JSON.stringify({ event: 'workspace_checkpoint' })); } }
      finally { this._checkpointing = false; }
    })();
    if (this.ctx && typeof this.ctx.waitUntil === 'function') this.ctx.waitUntil(run); else await run;
  }

  async onActivityExpired() {
    if (this._wsOn() && this.container.running && !(await this._st()).restoreFailed) {
      if (await this._wsSave()) {
        await this._setSt({ saveFails: null, unsavedHeld: null });
        await this._kvPut('ws_saved_at', Date.now());
      } else {
        /* NEVER STOPPED WITH WORK IT COULD NOT SAVE (COMP-001, Nov 3 audit
           COMP-016). The disk holds work the saved copy does not, and stopping
           the machine throws that work away. It used to be stopped after
           three failed tries anyway; now, after WS_SAVE_TRIES, it is HELD:
           kept running, still tried at every idle window, and the person is
           told - with the machine still there to copy their work out of.
           It stops only when a save works, or when the person chooses to
           discard the unsaved work (`/amv-workspace/discard`). Its awake time
           is metered against their plan as always. */
        const st = await this._setSt({ saveFails: ((await this._st()).saveFails || 0) + 1 });
        if (st.saveFails >= WS_SAVE_TRIES && !st.unsavedHeld) {
          await this._setSt({ unsavedHeld: { since: Date.now(), tries: st.saveFails } });
          console.log(JSON.stringify({ event: 'workspace_held_unsaved', tries: st.saveFails }));
        } else console.log(JSON.stringify({ event: 'workspace_save_retry', tries: st.saveFails }));
        if (st.unsavedHeld) await this._setSt({ unsavedHeld: Object.assign({}, st.unsavedHeld, { tries: st.saveFails, lastTry: Date.now() }) });
        return;
      }
    }
    await this._setSt({ unsavedHeld: null });
    await this.stop();
  }

  /* The main Worker forgets a person's saved workspace when their account is
     erased or they sign out everywhere: one request, with AMV's key. */
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/amv-workspace/forget') {
      if (!(await this._callOk(request, url.pathname)))
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
    if (url.pathname === '/amv-workspace/versions' || url.pathname === '/amv-workspace/rollback' || url.pathname === '/amv-workspace/fresh'
        || url.pathname === '/amv-workspace/discard' || url.pathname === '/amv-workspace/trust') {
      const reply = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
      if (!(await this._callOk(request, url.pathname)))
        return reply({ error: 'not_allowed' }, 401);
      if (!this._wsOn()) return reply({ error: 'Saved copies are not switched on for this deployment.', code: 'needs_service' }, 503);
      if (url.pathname === '/amv-workspace/versions') {
        const cur = await this.env.WORKSPACES.get(this._wsKey());
        const current = cur ? Object.assign({ bytes: cur.size, at: cur.uploaded ? new Date(cur.uploaded).toISOString() : null }, _wsChanging(cur.customMetadata)) : null;
        if (cur) try { await cur.body.cancel(); } catch (e) {}
        const st = await this._st();
        /* What the person must be told: the copy could not be put back, or
           the machine stopped without its last save. Seen once, then gone. */
        if (st.lostUnsaved) await this._setSt({ lostUnsaved: null });
        return reply({ current, versions: (await this._wsVersions()).map(({ id, at, bytes, changing }) => Object.assign({ id, at, bytes }, changing ? { changing } : {})),
          state: { restoreFailed: st.restoreFailed || null, lostUnsaved: st.lostUnsaved || null, unsavedHeld: st.unsavedHeld || null, setup: st.setup || null } });
      }
      /* THE PERSON'S DECISION, NOT A TIMER'S (COMP-016): a machine held
         because its work could not be saved is stopped - and that work lost -
         only when they say so. Tried once more first. */
      if (url.pathname === '/amv-workspace/discard') {
        const st0 = await this._st();
        if (!st0.unsavedHeld) return reply({ error: 'Nothing is waiting to be saved.', code: 'not_needed' }, 409);
        if (this.container.running && await this._wsSave()) {
          await this._setSt({ saveFails: null, unsavedHeld: null });
          await this._kvPut('ws_saved_at', Date.now());
          try { await this.stop(); } catch (e) {}
          return reply({ discarded: false, saved: true });
        }
        await this._setSt({ saveFails: null, unsavedHeld: null, lostUnsaved: { at: Date.now(), tries: st0.unsavedHeld.tries || 0, chosen: true } });
        try { if (this.container.running) await this.destroy(); } catch (e) {}
        console.log(JSON.stringify({ event: 'workspace_discarded_unsaved' }));
        return reply({ discarded: true });
      }
      /* A copy saved before checksums, used anyway because the person chose
         to: unpacked at the next start, then saved again with its checksum. */
      if (url.pathname === '/amv-workspace/trust') {
        const st0 = await this._st();
        if (!(st0.restoreFailed && st0.restoreFailed.unverified)) return reply({ error: 'There is no unchecked copy waiting.', code: 'not_needed' }, 409);
        await this._setSt({ restoreFailed: null, trustOnce: true });
        try { if (this.container.running) await this.destroy(); } catch (e) {}
        console.log(JSON.stringify({ event: 'workspace_trusted_unverified' }));
        return reply({ trusted: true });
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
      if (!/^\d{13}(?:-[0-9a-f]{8})?$/.test(id)) return reply({ error: 'Choose one of the saved copies.', code: 'bad_request' }, 400);
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
    /* Nothing below is reached without a call signed for this machine. */
    if (!(await this._callOk(request, url.pathname)))
      return new Response(JSON.stringify({ error: 'not_allowed' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    /* A machine that did not get its workspace back does no work (COMP-002):
       a command run there would run on an empty disk as though it were
       theirs. The page is told why and offered the remedies. */
    if ((await this._st()).restoreFailed)
      return new Response(JSON.stringify({ error: 'Your saved workspace could not be put back on this machine, so it is not running anything until it is. Put back an earlier saved copy, or start fresh (the copy is kept).', code: 'workspace_restore_failed' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } });
    /* Everything else is passed to the machine: only with a call signed for
       it, and with this machine's own key in place of whatever came in. A
       container about to start gets a key no earlier container had. */
    await this._machineKey(!this.container.running);
    const h = new Headers(request.headers);
    h.delete('X-AMV-Computer-Call');
    h.set('X-AMV-Bridge-Token', await this._machineKey(false));
    const res = await super.fetch(new Request(request, { headers: h }));
    await this._checkpointMaybe();
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
