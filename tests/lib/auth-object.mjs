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
        return a || inner.fetch(u, init);
      } };
    },
  });
}
