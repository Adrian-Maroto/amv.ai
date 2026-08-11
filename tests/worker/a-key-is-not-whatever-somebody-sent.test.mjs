/* A STORAGE KEY IS NEVER JUST WHAT SOMEBODY SENT.

   Almost every route in the Worker builds its keys from a literal prefix and a
   validated id - `market:${id}` after a format check, `withdraw:${id}` after a
   regex, `site:${slug}` after SLUG_RE. Two did not. They took `body.thread`
   and handed it straight to the namespace, and one of them for a WRITE:

       await env.AMV_KV.put(tid, JSON.stringify(t));

   Nothing bad happened, because underneath it there is a membership check that
   needs the record to carry `a` or `b` equal to the caller, and only thread
   records have those. That is the entire guard, and it is a guard made out of
   somebody else's schema. The day any other record gains an `a` or a `b`
   holding an address - a pairing, an A/B assignment, a two-party anything -
   that write becomes a way to overwrite it by name, and the change that
   introduces it will be somewhere else entirely and will look harmless.

   So the rule is about the key, not about what is behind it: a value from the
   request is shaped before it addresses storage. It costs one regex and it
   stops depending on a fact about unrelated records staying true.

   Checked as a shape rather than a list, so the next route is covered on the
   day it is written. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly } from '../lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const code = codeOnly(src);

const lines = code.split('\n');
const fns = [];
lines.forEach((l, i) => {
  const m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
         || l.match(/^const\s+([A-Za-z_$][\w$]*)\s*=/);
  if (m) fns.push({ name: m[1], line: i });
});
const bodies = fns.map((f, k) => ({
  name: f.name,
  text: lines.slice(f.line, k + 1 < fns.length ? fns[k + 1].line : lines.length).join('\n'),
}));

/* A key expression that is a BARE variable - no literal prefix in sight. A
   template with a prefix (`market:${id}`) names the namespace itself and is
   not what this is about. */
const BARE_KEY = /AMV_KV\.(get|put|delete)\(\s*([A-Za-z_$][\w$.]*)\s*[,)]/g;

/* Names that hold a key built elsewhere in the same function, rather than a
   value that came off the request. `k`, `key` and `name` are what the loops
   over a page of KV keys call each entry. */
const BUILT_LOCALLY = /^(k|key|name|kn|cacheKey|costName|mName|dName|vName|wName|minName|dayName|ownerDayName|ownerMonthName|MARKET_CACHE_KEY|harness)$/;

section('Both the keys and the handlers were found');
{
  const all = [...code.matchAll(BARE_KEY)];
  ok(all.length > 5, 'storage is addressed by a variable in a number of places', all.length);
  ok(bodies.length > 200, 'and every handler was read', bodies.length);
}

section('Nothing from a request addresses storage before it is shaped');
{
  /* For each bare-variable key, find where that variable came from in the same
     handler. If it was assigned from the request - body, JSON, a query
     parameter - the handler has to test its shape before using it. */
  const unshaped = [];
  for (const b of bodies) {
    for (const m of b.text.matchAll(BARE_KEY)) {
      const v = m[2];
      if (BUILT_LOCALLY.test(v)) continue;
      if (/^k\.name$/.test(v)) continue;                       // a key listed FROM storage
      /* Where does it come from? */
      const assign = new RegExp('(?:const|let|var)\\s+' + v.replace(/[.$]/g, '\\$&') + '\\s*=\\s*([^;\\n]+)');
      const from = (b.text.match(assign) || [])[1] || '';
      const fromRequest = /body\.|request\.json|searchParams|params\.|\bthread\b|\bid\b/.test(from);
      if (!fromRequest) continue;
      /* Shaped how? A regex test, or a rebuild through a helper that puts the
         prefix on. Either is a decision about the key; neither is trusting it. */
      const shaped = new RegExp('(?:test\\(\\s*(?:String\\()?' + v + '|' + v + '\\s*\\)\\s*\\)|_threadKeyOK\\(\\s*' + v + '|' + v + '\\s*=\\s*_thread)').test(b.text)
                  || new RegExp('[A-Za-z_$][\\w$]*OK\\(\\s*' + v + '\\s*\\)').test(b.text);
      if (!shaped) unshaped.push(b.name + ': ' + m[1] + '(' + v + ')');
    }
  }
  ok(unshaped.length === 0,
     'a caller-supplied value is validated before it names a record', unshaped);
}

section('And the two that were not, are');
{
  /* Named, because the general rule above can be satisfied by adding a name to
     BUILT_LOCALLY, which for these would be the wrong answer. */
  ok(/const _threadKeyOK =/.test(code), 'there is one definition of what a thread key looks like', true);
  ok(/\^mkthread:/.test(code), 'and it insists on the prefix the product writes', true);
  const read = bodies.find(b => b.name === 'marketThreadRead');
  ok(read && /_threadKeyOK\(tid\)/.test(read.text),
     'marking a conversation read shapes the id before it writes to it', !!read);
  const recip = bodies.find(b => b.name === '_messageRecipient');
  ok(recip && /_threadKeyOK\(tid\)/.test(recip.text),
     'and so does resolving who a message is for', !!recip);
}

section('The shape really refuses what it should');
{
  /* The regex is the whole control, so it is exercised rather than admired. */
  const m = code.match(/const _threadKeyOK = \(tid\) =>\s*([\s\S]{0,200}?);/);
  ok(!!m, 'the test was located', !!m);
  const re = new RegExp(((m || [])[1] || '').match(/\/(\^[^/]+)\//)?.[1] || 'x^');
  const ok_ = (s) => re.test(s);
  ok(ok_('mkthread:a@x.com__b@y.com'), 'a real thread key passes', true);
  ok(!ok_('acct:victim@x.com'), 'an account record cannot be addressed', true);
  ok(!ok_('wallet:victim@x.com'), 'nor a wallet', true);
  ok(!ok_('ADMIN_TOKEN'), 'nor a bare configuration name', true);
  ok(!ok_('mkthread:a@x.com'), 'and a half-formed one is refused rather than guessed at', true);
}

if (report('a-key-is-not-whatever-somebody-sent') > 0) process.exitCode = 1;
done();
