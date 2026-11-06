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
    /* What the objects hold, for a suite that asserts on it. */
    _objects: store,
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
        /* The commit (revCommit/revGet/revReset), as the object keeps it:
           revision and digest together, refused when it holds a newer one. */
        if (b.op === 'revCommit' || b.op === 'revGet' || b.op === 'revReset') {
          const k = 'rc|' + String(id); const cur = store.get(k);
          const out = (o) => new Response(JSON.stringify(o));
          if (b.op === 'revGet') return out(cur ? { committed: !!(cur.digest || cur.absent), rev: cur.rev || 0, digest: cur.digest || null, absent: !!cur.absent } : { committed: false, rev: 0 });
          if (b.op === 'revReset') { store.set(k, b.absent ? { rev: (cur && cur.rev) || 0, absent: true } : { rev: +b.rev || 0, digest: String(b.digest || '') }); return out({ ok: true }); }
          if (cur && !cur.absent && cur.rev > (+b.expect || 0)) return out({ ok: false, cur: cur.rev });
          store.set(k, { rev: +b.set || 0, digest: String(b.digest || '') }); return out({ ok: true });
        }
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
        /* A Postgres row's proof, as the object keeps it: one epoch, moved by
           every fence; a proof set only under the epoch it was read in. */
        if (b.op === 'proofGet' || b.op === 'proofFence' || b.op === 'proofSet') {
          const k = 'pf|' + String(id); const p = store.get(k) || { epoch: 0, digest: null };
          const out = (o) => new Response(JSON.stringify(o));
          if (b.op === 'proofGet') return out({ epoch: p.epoch, digest: p.digest });
          if (b.op === 'proofFence') { store.set(k, { epoch: p.epoch + 1, digest: null }); return out({ ok: true, epoch: p.epoch + 1 }); }
          if (p.epoch !== Number(b.epoch)) return out({ ok: false, epoch: p.epoch });
          store.set(k, { epoch: p.epoch, digest: String(b.digest || '') || null }); return out({ ok: true, epoch: p.epoch });
        }
        return inner.fetch(u, init);
      } };
    },
  });
}
