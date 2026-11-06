/* The account revocation operations of the counter object (AMVCounter's
   authGet / authSeed / authRevokeAll / authEndSession), for the hand-made
   counter stand-ins many suites build.

   A stand-in that answers these with something that is not an epoch is, to
   the Worker, a revocation object answering nonsense: sign-in carries on from
   the KV epoch, and every route that must be sure the session is current
   (security settings, keys, money, permissions, deleting the account) refuses
   with `auth_unconfirmed`. That is right in production and wrong as the
   accidental state of a suite that is testing something else.

   Faithful in the parts that matter: the epoch only rises, a revocation
   raises it past the floor it is given, an ended session stays ended. */
export function authObjectOp(name, body, store = authObjectOp._store) {
  if (!body || typeof body.op !== 'string' || !body.op.startsWith('auth')) return null;
  const rec = store.get(name) || { epoch: 0, seeded: false, ended: new Set() };
  const floor = Number(body.floor) || 0;
  let out;
  if (body.op === 'authGet') out = { seeded: rec.seeded, epoch: rec.epoch, ended: !!(body.sid && rec.ended.has(body.sid)) };
  else if (body.op === 'authSeed') { rec.epoch = Math.max(rec.epoch, floor); rec.seeded = true; out = { epoch: rec.epoch }; }
  else if (body.op === 'authRevokeAll') { rec.epoch = Math.max(rec.epoch, floor) + 1; rec.seeded = true; rec.ended.clear(); out = { epoch: rec.epoch }; }
  else if (body.op === 'authEndSession') { rec.epoch = Math.max(rec.epoch, floor); rec.seeded = true; if (body.sid) rec.ended.add(body.sid); out = { ok: true, epoch: rec.epoch }; }
  else return null;
  store.set(name, rec);
  return new Response(JSON.stringify(out));
}
authObjectOp._store = new Map();

/* Wrap a hand-made AMV_COUNTER stand-in so it answers the auth operations
   faithfully (one shared store per wrapped namespace) and passes every other
   operation to the stand-in unchanged. */
export function withAuthOps(ns) {
  const store = new Map();
  return Object.assign({}, ns, {
    idFromName: ns.idFromName ? ns.idFromName.bind(ns) : (n) => n,
    get: (id) => {
      const inner = ns.get(id);
      return { fetch: async (u, init) => {
        let b = {}; try { b = JSON.parse((init && init.body) || '{}'); } catch (e) {}
        const a = authObjectOp(String(id), b, store);
        if (a) return a;
        /* A record's revision (revCas), as the object keeps it: a write goes
           ahead only from the current revision; one never seen is taken as
           given; undo puts it back. Faithful enough that a suite exercising
           sync sees real conflicts, not a stand-in that says no to all. */
        if (b.op === 'revCas') {
          const k = 'rev|' + String(id);
          const cur = store.get(k);
          const expect = +b.expect || 0, set = +b.set || 0;
          if (b.undo) { if (cur === set) store.set(k, expect); return new Response(JSON.stringify({ ok: true })); }
          if (cur !== undefined && cur > expect) return new Response(JSON.stringify({ ok: false, cur }));
          store.set(k, set);
          return new Response(JSON.stringify({ ok: true }));
        }
        /* Fields of one object (tallyMany / tallyFields), as the object keeps
           them: the owner's month figures and an agent's sign-in generation. */
        if (b.op === 'tallyMany') {
          const k = 'tm|' + String(id); const f = store.get(k) || {};
          for (const [n, v] of Object.entries(b.fields || {})) f[n] = (f[n] || 0) + (+v || 0);
          store.set(k, f); return new Response(JSON.stringify({ ok: true, many: true }));
        }
        if (b.op === 'tallyFields') return new Response(JSON.stringify({ fields: Object.assign({}, store.get('tm|' + String(id)) || {}) }));
        return inner.fetch(u, init);
      } };
    },
  });
}
