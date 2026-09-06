/* THE CLIENT HONOURED A SIGNAL THE SERVER NEVER SENT.

   The service worker decides what it may keep by reading Cache-Control, and
   its own comment says so: marking a response no-store is "how a server says
   this is about one person, or it can be revoked". Good rule. Nothing in
   `amv-backend.js` ever sent that header, so `storable` came back true for
   every JSON answer it saw - a wallet balance, a team roster, a chat list.

   It is latent rather than live today. `amv-api-base` points at the Worker on
   its own origin and the service worker returns early for anything
   cross-origin, so none of this is being cached now. Routing the Worker on
   the site's own domain is an ordinary Cloudflare setup and would turn it on
   with no change to this repository, which is exactly the kind of thing a
   header should be holding rather than somebody's memory.

   Asserted on the SOURCE, not by driving a route. The property is about the
   one function every JSON answer in the product goes through, and about the
   spread ORDER inside it - `extra` must come last so the genuinely public
   answers can still opt into caching. A handful of live routes would prove
   neither of those about the hundred and fifty that were not driven. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');

/* The one line every JSON answer is built by. */
const jsonLine = (src.split('\n').find(l => /^const json = \(o, s = 200, extra\)/.test(l)) || '');

section('Every JSON answer says it must not be stored');
{
  ok(!!jsonLine, 'the json() builder is where this file thinks it is', jsonLine.slice(0, 60));
  ok(/'Cache-Control':\s*'no-store'/.test(jsonLine),
     'it sets Cache-Control: no-store', jsonLine.includes('no-store'));
}

section('And a public answer can still say otherwise');
{
  /* The default is only safe if the override is real: the pricing counts, the
     model catalogue and the public config are answers about nobody, and
     making them uncacheable would be a cost and a delay for no privacy. */
  const iNoStore = jsonLine.indexOf("'Cache-Control': 'no-store'");
  const iExtra = jsonLine.indexOf('...(extra || {})');
  ok(iNoStore > -1 && iExtra > iNoStore,
     'extra spreads AFTER it, so a route that opts into caching wins',
     'no-store@' + iNoStore + ' extra@' + iExtra);

  const optIns = (src.match(/'Cache-Control':\s*'public, max-age=\d+/g) || []).length;
  ok(optIns >= 4,
     'and there really are public answers relying on that, not a hypothetical',
     optIns);
}

section('The rule the service worker applies is the rule this is aimed at');
{
  /* If the client stops reading the header, the header stops being a
     defence - and it would stop silently, because a response nobody consults
     looks exactly like one that was honoured. */
  ok(/no-store\|private/.test(sw),
     'the service worker still refuses to store a no-store answer', true);
  ok(/storable/.test(sw),
     'and still gates its own put on that decision', true);
}

if (report('an-answer-about-one-person-is-not-cacheable') > 0) process.exitCode = 1;
done();
