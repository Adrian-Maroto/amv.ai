/* NO KEY IS SHARED BY EVERYBODY.

   Scale audit #40. One counter that every account's request touched was
   AMV's throughput ceiling, and it was invisible to every test because each
   test had one user. tools/load-probe.mjs drives the real router for many
   distinct accounts and counts every storage operation, by key and by who.
   This holds it to budgets:
     - no KV key is written by more than a handful of different accounts
       (KV takes about one write a second per key);
     - no counter object is called by more than a quarter of them (one
       object is one actor - shared by everybody, it is a queue);
     - what one chat turn costs in storage stays inside a budget, so a
       change that doubles it has to say so here.
   The budgets are tripwires several times today's measurement, not targets. */
import { probe } from '../../tools/load-probe.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const USERS = 120;
const r = await probe({ users: USERS });

section('Every route answered, for every account');
for (const [name, x] of Object.entries(r.perRoute)) {
  ok(Object.keys(x.status).length === 1 && x.status[200] === USERS, name + ': all ' + USERS + ' answered 200', x.status);
}

section('Nothing is written by everybody');
{
  const top = r.kvWritesShared[0] || { accounts: 0 };
  ok(top.accounts <= 3, 'the KV key written by the most different accounts is written by at most 3 of ' + USERS, r.kvWritesShared.slice(0, 3));
  const hot = r.doShared[0] || { accounts: 0 };
  ok(hot.accounts <= USERS / 4, 'no counter object is called by more than a quarter of the accounts', r.doShared.slice(0, 4));
}

section('One chat turn stays inside its storage budget');
{
  const c = r.perRoute.chat;
  ok(c.kvWritesPerReq <= 3, 'KV writes per turn', c.kvWritesPerReq);
  ok(c.kvReadsPerReq <= 8, 'KV reads per turn', c.kvReadsPerReq);
  ok(c.kvListsPerReq === 0, 'no KV list on a turn - a list scans', c.kvListsPerReq);
  ok(c.doCallsPerReq <= 30, 'counter calls per turn', c.doCallsPerReq);
}

section('Reading screens cost reads only');
for (const name of ['usage', 'entitlement', 'syncPull']) {
  const x = r.perRoute[name];
  ok(x.kvWritesPerReq === 0 && x.kvListsPerReq === 0, name + ': no writes, no lists', x);
}

if (report('no-key-is-shared-by-everybody') > 0) process.exitCode = 1;
done();
