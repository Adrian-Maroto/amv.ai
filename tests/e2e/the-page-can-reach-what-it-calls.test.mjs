/* THREE FINISHED FEATURES THAT COULD NEVER RUN, FROM ONE CAUSE.

   A Content-Security-Policy names every host a page may reach. Anything else is
   refused by the browser before the request leaves - and the refusal surfaces
   as a network error in a console nobody has open, which reads exactly like the
   third party being down. So a feature can be built, styled, error-handled,
   documented and shipped, and be impossible.

   Three were:

     Canvas          fetched yourschool.instructure.com from the browser. No
                     school is in connect-src and none can be - the host differs
                     per school. It had a modal, a progress log, a rate-limit
                     pause and a help note, and had never once worked.
     Classroom       fetches classroom.googleapis.com. connect-src allows
                     accounts.google.com, gmail.googleapis.com and
                     www.googleapis.com - not that one. This is the coursework
                     reader whose read-only scopes are the subject of another
                     test file: the permission model is right and the call could
                     never happen.
     Analytics       injects a script tag for googletagmanager.com or
                     plausible.io. Neither is in script-src, so an operator can
                     configure analytics, see no error, and collect nothing.

   Fixing three is not the job. Nothing compared the app against its own policy,
   which is why all three shipped, so this compares them - every host the bundle
   fetches against connect-src, every script it injects against script-src.

   A host that is missing here is not a bug to find later. It is a feature that
   has never run. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
const worker = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* The policy as the browser reads it - and ONLY out of the policy.

   This used to search the whole file for the directive name. The first match
   is not necessarily the policy: a comment ABOUT the header sits a few lines
   above it, and once one mentioned the directive by name this read the comment
   instead and reported four hosts as blocked that the real policy allows. The
   meta content is the only place a browser looks, so it is the only place
   this looks. */
const CSP = (html.match(/<meta http-equiv="Content-Security-Policy" content="([\s\S]*?)">/) || [, ''])[1];
function directive(name) {
  const m = CSP.match(new RegExp('(?:^|\\s)' + name + '\\s+([^;]*)'));
  if (!m) return null;
  return new Set(m[1].split(/\s+/).filter(Boolean)
    .filter(v => /^https?:\/\//.test(v))
    .map(v => v.replace(/^https?:\/\//, '')));
}
/* 'self' and a wildcard entry both cover things this cannot enumerate, so a
   host is allowed if it matches exactly or matches a *.host entry. */
const allows = (set, host) => {
  if (!set) return false;
  if (set.has(host)) return true;
  for (const entry of set) {
    if (entry.startsWith('*.') && host.endsWith(entry.slice(1))) return true;
  }
  return false;
};
const hostsIn = (re) => {
  const out = new Set();
  for (const m of app.matchAll(re)) {
    const h = String(m[1] || '').replace(/^https?:\/\//, '').split('/')[0];
    if (h) out.add(h);
  }
  return [...out].sort();
};

section('The page states a policy at all');
{
  ok(!!directive('connect-src'), 'connect-src is set', !!directive('connect-src'));
  ok(!!directive('script-src'), 'script-src is set', !!directive('script-src'));
  ok((directive('connect-src') || new Set()).size > 3,
     'and it is a real list rather than a placeholder', (directive('connect-src') || new Set()).size);
}

section('A widget the page embeds is allowed to finish what it starts');
{
  /* THE CAPTCHA LOADED, RENDERED, AND COULD NOT TALK TO ITS OWN SERVER.

     challenges.cloudflare.com was in script-src and frame-src and NOT in
     connect-src, so Turnstile's script ran, its frame appeared, and the
     requests it makes to complete a challenge were refused. The widget
     half-appeared or did not appear, produced no token, and the server
     correctly rejected every sign-up for want of one - which is a locked door
     on the front of the product, arrived at by configuring a security feature
     properly.

     A third-party widget is not one permission, it is three, and getting two
     of them right fails in a way that reads as the widget being broken rather
     than as the policy being incomplete. So: a host trusted to run a script
     here must also be trusted to be framed and to be reached, or none of them.
     Cloudflare's own guidance for Turnstile names all three. */
  const WIDGETS = ['challenges.cloudflare.com'];
  for (const host of WIDGETS) {
    const inS = allows(directive('script-src'), host);
    const inF = allows(directive('frame-src'), host);
    const inC = allows(directive('connect-src'), host);
    ok(inS === inF && inF === inC,
       host + ' is allowed by script-src, frame-src and connect-src together, or by none',
       { 'script-src': inS, 'frame-src': inF, 'connect-src': inC });
  }
}

section('Every host the app FETCHES is one it is allowed to reach');
{
  /* The literal ones. A URL built from a variable cannot be checked here, which
     is exactly why the Canvas call hid for so long - and why the rule below
     about school hosts exists separately. */
  const connect = directive('connect-src');
  const fetched = hostsIn(/fetch(?:Deadline)?\(\s*['"`](https:\/\/[a-z0-9.-]+)/gi);
  ok(fetched.length > 0, 'the app really does call out to named hosts', fetched.length);
  const blocked = fetched.filter(h => !allows(connect, h));
  ok(blocked.length === 0,
     'none of them is refused by the page’s own policy', blocked);
}

section('Every script the app INJECTS is one it is allowed to load');
{
  const script = directive('script-src');
  const injected = hostsIn(/\.src\s*=\s*['"`](https:\/\/[a-z0-9.-]+)/gi);
  const blocked = injected.filter(h => !allows(script, h));
  ok(blocked.length === 0,
     'no analytics or widget script is added that the browser will refuse', blocked);
}

section('And no school host is called from the browser at all');
{
  /* This one cannot be fixed by adding a host, because the host is different
     for every school. It has to be read by the Worker, which has no policy to
     obey. Stated as a capability rather than as a spelling: the browser holds
     no school address, so it cannot build such a URL however it is written. */
  const traces = []
    .concat(app.match(/amv_canvas_url/g) || [])
    .concat(app.match(/fetch(?:Deadline)?\([^)]*instructure/g) || [])
    .concat(app.match(/baseUrl\s*\+\s*['"`]\/api\/v1/g) || []);
  ok(traces.length === 0,
     'the browser holds no school address and calls no school host', traces.slice(0, 3));
}

section('The policy has not been widened to nothing to make this pass');
{
  /* The cheap way to make everything above green is `connect-src *`, which is
     the same as having no policy. */
  const raw = (CSP.match(/(?:^|\s)connect-src\s+([^;]*)/) || [])[1] || '';
  ok(!/(^|\s)\*(\s|$)/.test(raw), 'connect-src is not a wildcard', raw.slice(0, 60));
  const rawScript = (CSP.match(/(?:^|\s)script-src\s+([^;]*)/) || [])[1] || '';
  ok(!/(^|\s)\*(\s|$)/.test(rawScript), 'script-src is not a wildcard', rawScript.slice(0, 60));
  ok(!/unsafe-eval/.test(rawScript), 'and does not allow eval', rawScript.slice(0, 80));
}

section('AMV is the only product named in AMV');
{
  /* A settings screen shipped a line reading "Set your Anthropic key" and a
     visible link out to that company's console, in the bundle every visitor
     downloads. Off-brand, and the wrong instruction as well: the key is a
     Worker secret, and which provider sits behind it is a deployment decision
     the operator has already made.

     Checked against the built bundle rather than the modules, because what
     ships is what matters. The screening list in the marketplace is exempt by
     shape: it exists to REJECT these words in what people upload, so the names
     have to appear in it, and it is data rather than something anybody reads. */
  const banned = /(Anthropic|OpenAI|ChatGPT|\bClaude\b|\bGemini\b|Copilot|\bGrok\b|Perplexity)/g;
  const hits = [];
  for (const m of app.matchAll(banned)) {
    const around = app.slice(Math.max(0, m.index - 120), m.index + 40);
    if (/banned\s*=|_BANNED|screenList/.test(around)) continue;   // the rejection list
    hits.push(m[0] + ' … ' + around.slice(-60).replace(/\s+/g, ' '));
  }
  ok(hits.length === 0, 'no other company is named in what visitors download', hits.slice(0, 3));

  const links = (app.match(/https:\/\/[a-z.]*(anthropic|openai|perplexity)\.com[^"']*/gi) || []);
  ok(links.length === 0, 'and nothing links people out to buy from one', links.slice(0, 2));
}

section('The provider is named on the server and nowhere a person can see');
{
  /* This check read app.js and stopped, so the entire Worker was outside it -
     and the Worker is a pushed artifact too. It does name the provider, in the
     only two places that cannot avoid it: the model identifiers it sends
     upstream, and the API host it sends them to. You cannot call an API
     without naming its models.

     Deleting those would not be brand discipline, it would be breaking the
     product. What matters is the property underneath the rule, which nothing
     was actually asserting: a person using AMV never sees another company's
     name. The tiers they choose from are amv-pulse, amv-core, amv-forge and
     amv-apex, and the mapping to real models stays on the server.

     So the rule is: server-side, the provider may be named where the call
     requires it. Browser-side, never - and that is now checked rather than
     coincidental. */
  const PROVIDER = /claude-(haiku|sonnet|opus|fable)[\w.-]*|api\.anthropic\.com/gi;

  const inBrowser = [...new Set([...(app.match(PROVIDER) || []), ...(html.match(PROVIDER) || [])])];
  ok(inBrowser.length === 0,
     'no provider model id or endpoint reaches the browser bundle', inBrowser.slice(0, 4));

  const inWorker = [...new Set(worker.match(PROVIDER) || [])];
  ok(inWorker.length > 0,
     'the Worker does name them, because a call has to say what it is calling', inWorker.length);

  /* And the names it is allowed to use are exactly those two shapes - a
     sentence about the provider, a comment, a piece of user-facing copy, would
     all be something else and none of them belongs here either. */
  const beyondIdentifiers = [];
  for (const m of worker.matchAll(/(?:Anthropic|OpenAI|ChatGPT|\bClaude\b|\bGemini\b|Copilot|\bGrok\b|Perplexity)/gi)) {
    const around = worker.slice(Math.max(0, m.index - 200), m.index + 60);
    /* The AMV-only screening list, which has to contain these words in order
       to reject them in what people upload. It is data the code matches
       against, not something anybody reads - the same exemption this file
       already makes for the browser side, applied for the same reason. */
    if (/banned\s*=|_MKT_PROHIBITED|_marketScreen|screenList|prohibited/i.test(around)) continue;
    /* The two identifiers a call cannot avoid. */
    if (/claude-(haiku|sonnet|opus|fable)/i.test(around) || /api\.anthropic\.com/i.test(around)) continue;
    if (/env\.AMV_MODEL_KEY/.test(around)) continue;
    /* A required request header. Same category as the model ids: the API
       defines the name, and a call that omits it is refused. */
    if (/'anthropic-version'/.test(around)) continue;
    beyondIdentifiers.push(m[0] + ' … ' + around.slice(-70).replace(/\s+/g, ' '));
  }
  ok(beyondIdentifiers.length === 0,
     'and nothing else in the Worker names another company', beyondIdentifiers.slice(0, 3));

  /* The tiers a person actually picks from are AMV's own. */
  const tiers = [...new Set(app.match(/amv-(pulse|core|forge|apex)/g) || [])];
  ok(tiers.length === 4, 'the four tiers people choose from are AMV names', tiers);
}

if (report('the-page-can-reach-what-it-calls') > 0) process.exitCode = 1;
done();
