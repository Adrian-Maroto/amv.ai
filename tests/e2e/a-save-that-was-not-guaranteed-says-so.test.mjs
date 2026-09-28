/* THE SERVER SAYS WHETHER THE WRITE IT JUST MADE COULD BE ARBITRATED. THE
   CLIENT WAS THROWING THAT AWAY.

   `DB.putIfRev` is a compare-and-set on D1: the write lands only if the
   revision is still the one we read, so the device that lost the race is told
   to pull instead of being allowed to overwrite. KV has no conditional write,
   so there the same call degrades to a plain put and reports `guarded:false`.
   The push route passes that flag straight through, with a comment saying it
   exists so the caller can be honest about which guarantee it has.

   `syncPush` read `ok`, `rev`, `merged` and `code` - and not `guarded`. Both
   answers arrived as "saved". A deployment where two devices can silently
   overwrite each other's conversations was, from inside the app, identical to
   one where they cannot, and nothing anywhere ever observed it happening.

   The second half is the same seam: the pull that reconciles a merged push was
   fire-and-forget, so `syncPush` resolved before the reconciled state existed
   and the next debounced push could re-send the state the server had already
   moved past. */
import { ok, section, report, done } from '../lib/assert.mjs';
import { bootApp } from '../lib/harness.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

section('The server still tells the client which guarantee it had');
{
  const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  ok(/return\s*\{\s*ok:\s*changed\s*>\s*0,\s*guarded:\s*true\s*\}/.test(src),
     'the conditional write on D1 reports itself as guarded');
  ok(/return\s*\{\s*ok:\s*true,\s*guarded:\s*false\s*\}/.test(src),
     'and the unconditional KV put reports that it is not');
  ok(/json\(\{\s*ok:true,\s*rev:[^}]*guarded/.test(src),
     'and the push route hands the flag to the client');
}

const app = await bootApp({ tab: 'chat' });
try {
  await app.connect();

  /* One stub for every case: the test drives it by setting window.__mode. */
  await app.stubFetch(async (u, o) => {
    const m = window.__mode || {};
    if (u.includes('/sync/push')) {
      window.__pushes = (window.__pushes || 0) + 1;
      return { ok: true, json: async () => ({
        ok: true, rev: 7, merged: !!m.merged, guarded: m.guarded }) };
    }
    if (u.includes('/sync/pull')) {
      await new Promise(r => setTimeout(r, 250));
      window.__pullDone = true;
      return { ok: true, json: async () => ({ ok: true, rev: 7, data: {} }) };
    }
    if (u.includes('/errors')) {
      window.__reported = (window.__reported || []).concat(
        JSON.parse(o.body).events.map(e => e.where + ': ' + e.msg));
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  });

  section('A guaranteed save is recorded as guaranteed, and says nothing');
  {
    const r = await app.page.evaluate(async () => {
      window.__mode = { guarded: true, merged: false };
      const saved = await AMV_API.syncPush({});
      await _errFlush();
      return { saved, guarded: AMV_API.syncGuarded, reported: window.__reported || [] };
    });
    ok(r.saved === true, 'the push reports saved');
    ok(r.guarded === true, 'and the client knows the write was arbitrated', r.guarded);
    ok(r.reported.length === 0, 'and nobody is told anything, because nothing is wrong', r.reported);
  }

  section('A save the server could not guarantee is not reported as one');
  {
    const r = await app.page.evaluate(async () => {
      window.__mode = { guarded: false, merged: false };
      const saved = await AMV_API.syncPush({});
      await _errFlush();
      return { saved, guarded: AMV_API.syncGuarded, reported: window.__reported || [] };
    });
    ok(r.saved === true, 'the data still went, so the user is not blocked');
    ok(r.guarded === false, 'but the client no longer believes it was arbitrated', r.guarded);
    /* Said to the operator by the server, once a week - not reported as an
       error from every visitor's browser, where it was one issue growing an
       event per page load about something no visitor can act on. */
    ok(!r.reported.some(x => x.startsWith('sync.unguarded')),
       'and it is not reported from the visitor\u2019s browser', r.reported);
    const W = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
    const alert = W.slice(W.indexOf("if(!guarded){"), W.indexOf("if(!guarded){") + 900);
    ok(/alertOnce\(env, 'sync_unguarded'/.test(alert) && /do NOT just bind/.test(alert) && /7 \* 24 \* 60/.test(alert),
       'the server tells the operator, weekly, and warns that binding D1 without a migration would hide every account', alert.slice(0, 160));
  }

  section('And autosaves add nothing to the error reports');
  {
    const n = await app.page.evaluate(async () => {
      window.__mode = { guarded: false, merged: false };
      for (let i = 0; i < 4; i++) await AMV_API.syncPush({});
      await _errFlush();
      return (window.__reported || []).filter(x => x.startsWith('sync.unguarded')).length;
    });
    ok(n === 0, 'four more unguarded pushes add no reports', n);
  }

  section('A merged push waits for the reconciliation it asked for');
  /* The pull takes 250ms in the stub. Fire-and-forget resolved immediately and
     left the next debounced push - 1.2s later - free to collect a list the
     server had already moved past, and push the same conflict again. */
  {
    const r = await app.page.evaluate(async () => {
      window.__pullDone = false;
      window.__mode = { guarded: false, merged: true };
      await AMV_API.syncPush({});
      return { pullDone: window.__pullDone === true };
    });
    ok(r.pullDone === true,
       'syncPush had not resolved while the pull was still in flight', r.pullDone);
  }

  section('The revision the server returned is the one echoed next time');
  {
    const rev = await app.page.evaluate(() => AMV_API.syncRev);
    ok(rev === 7, 'so the next push can be authoritative and its deletions stick', rev);
  }

  ok(app.errors.length === 0, 'and no page error was thrown throughout', app.errors);
} finally {
  await app.close();
}

report();
done();
