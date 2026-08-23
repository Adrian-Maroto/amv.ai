/* THE FIRST FIVE MINUTES, WHICH IS WHERE SIGNUPS BECOME CUSTOMERS.

   Everything proven so far is that a stranger can sign up, get an answer, and
   pay. What none of it touches is the thing between those: what a brand new
   account actually SEES. An account with no chats, no automations, no
   purchases, no team and no history is the state every single customer is in
   at the moment they decide whether this product is worth anything.

   It is also the state nobody develops in. By the time you are building a
   screen you have twenty test conversations, so the version with nothing in it
   is the one you never look at - and its failures are all quiet ones: a blank
   panel, a spinner that never resolves, a table with headers and no rows, an
   error meant for a missing record shown to somebody who simply has not made
   one yet.

   None of that throws. It just reads as broken, once, to a person deciding
   whether to come back.

   Driven against the real backend, because "no data" from a live server and
   "no data" from a demo are different code paths, and only one of them is what
   a customer gets. */
import { bootLive, makeEnv, makeOutbound, BACKEND } from '../lib/live-backend.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const outbound = makeOutbound();
outbound.on(/api\.stripe\.com/, () => ({ ok: true, data: [] }));

const env = makeEnv({
  GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
  SUPPORT_EMAIL: 'help@amv.test',
  APP_URL: 'http://localhost:9176',
});
const L = await bootLive({ env, outbound, port: 9177 });
const { page } = L;

const EMAIL = 'brandnew@example.com';
const PW = 'A-real-Passw0rd!';

/* Open a tab, let it settle, and describe what a person would actually see. */
async function visit(tab) {
  return page.evaluate(async (t) => {
    setTab(t);
    await new Promise(x => setTimeout(x, 700));
    const vc = document.getElementById('vc') || document.body;
    const text = (vc.textContent || '').replace(/\s+/g, ' ').trim();
    const boxes = [...vc.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect();
      return !__under(r.width, 40) && !__under(r.height, 20);
    }).length;
    return {
      tab: t,
      text,
      len: text.length,
      /* A spinner still turning after the view has settled is the "loading
         for ever" failure - indistinguishable from working, until it isn't. */
      spinning: !!vc.querySelector('.spinner:not([hidden]), .loading:not([hidden]), .skeleton:not([hidden])'),
      hasEmptyState: !!vc.querySelector('.empty-state'),
      boxes,
    };
  }, tab);
}

/* Words that mean "something went wrong", as opposed to "there is nothing
   here yet" - which is the distinction that matters on a first visit.

   Bounded and case-correct on purpose. A loose /NaN/i matched "Fi(nan)ce" in
   the marketplace category list and reported the whole screen as broken; the
   same shape of mistake as a /cap/ that matches "capacity". NaN and null are
   matched exactly, as the literals a template leaks, not as substrings. */
const BROKEN = /(went wrong|unexpected error|failed to load|could not load|\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b|Invalid Date)/;

/* And the one a list of error WORDS misses entirely: a nav item that renders
   the 404 view. It contains none of the strings above - it is a perfectly
   composed page saying the thing does not exist - and it is the worst
   possible first session, because the person clicked something the product
   put in front of them. Sabotaging a real tab to render 404 passed the check
   above without a murmur, which is how this came to be its own pattern. */
const NOT_FOUND = /page not found|doesn.t exist or may have moved/i;

section('A brand new account, created against a real server');
{
  /* Through the real sign-up sheet, not AMV_API.signup directly. The raw API
     method issues tokens and does not populate S.user - which is what the UI
     path does, and what every screen below reads. Calling the method and then
     asserting on S.user tests neither. */
  const r = await page.evaluate(async ([em, pw]) => {
    openAuth('signup');
    await new Promise(x => setTimeout(x, 350));
    const type = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    type('#a-name', 'Brand New'); type('#a-email', em); type('#a-pass', pw);
    document.getElementById('auth-submit').click();
    await new Promise(x => setTimeout(x, 1100));
    return { signedIn: !!(S.user && S.user.email), plan: loadStr('amv_plan') || 'free' };
  }, [EMAIL, PW]);
  ok(r.signedIn === true, 'they are signed in', r);
  ok(r.plan === 'free', 'on the free plan, with nothing behind them', r.plan);

  const acct = await env.AMV_KV.get('acct:' + EMAIL);
  ok(!!acct, 'and the account is real, on the server', !!acct);
  /* And genuinely empty - no fixture, no seeded example, nothing that would
     make the screens below easier than a customer's. */
  ok(!(await env.AMV_KV.get('data:' + EMAIL)), 'with no conversations', true);
  ok(!(await env.AMV_KV.get('auto:' + EMAIL)), 'no automations', true);
  ok(!(await env.AMV_KV.get('purchases:' + EMAIL)), 'and nothing bought', true);
}

/* The tabs a person can actually click, read from the rendered navigation
   rather than from the source.

   Grepping index.html for `data-tab="..."` looked equivalent and was not: it
   also matches selector strings inside the minified bundle, and that put
   `automation` on the list - which is not a nav item at all, only half of a
   `querySelector('[data-tab="automation"], [data-tab="tasks"]')`. It rendered
   404, correctly, for a tab nobody can reach, and read like a product bug for
   twenty minutes. Asking the DOM cannot make that mistake. */
const TABS = await page.evaluate(() =>
  [...document.querySelectorAll('.snb[data-tab], .sb-tool[data-tab]')]
    .map(b => b.dataset.tab)
    .filter((t, i, a) => t && a.indexOf(t) === i));
const seen = {};

section('The navigation was read from the page, not guessed');
{
  ok(TABS.length >= 8, 'there are real tabs to walk', TABS);
  ok(TABS.includes('chat'), 'including the one everybody lands on', TABS);
}

section('Every screen says something, rather than being blank');
{
  /* The blank-panel failure: a view that renders its container and nothing
     else. It looks like the app is broken and gives a new person no idea what
     the screen is even for. */
  const blank = [];
  for (const t of TABS) {
    const r = await visit(t);
    seen[t] = r;
    if (r.len < 40) blank.push(t + ' (' + r.len + ' chars)');
  }
  ok(blank.length === 0, 'no tab renders an empty panel', blank);
}

section('And none of them shows an error to somebody who has simply just arrived');
{
  /* The failure that costs the most: an error written for a missing record,
     shown to a person who has not made one yet. It reads as "this is broken",
     not as "this is new". */
  const broken = Object.values(seen)
    .filter(r => BROKEN.test(r.text))
    .map(r => r.tab + ': ' + (r.text.match(BROKEN) || [])[0] + ' ... ' + r.text.slice(0, 90));
  ok(broken.length === 0, 'nothing reads as a failure', broken);

  /* Separately, because it is a different failure with none of those words in
     it: a tab the product itself put in the sidebar must not answer "page not
     found". */
  const missing = Object.values(seen).filter(r => NOT_FOUND.test(r.text)).map(r => r.tab);
  ok(missing.length === 0,
     'and no tab in the navigation renders a 404 to the person who clicked it', missing);
}

section('Nothing is still loading once the screen has settled');
{
  /* A spinner that never resolves is indistinguishable from one that is about
     to, right up until the person leaves. */
  const stuck = Object.values(seen).filter(r => r.spinning).map(r => r.tab);
  ok(stuck.length === 0, 'no tab is left spinning', stuck);
}

section('The screens that would be empty offer the next step');
{
  /* An empty state that only says "nothing here" wastes the one moment a new
     person is most willing to try something. The screens that matter are the
     ones a fresh account has nothing in by definition.

     Three answers are all acceptable, and the third is the one that caught me
     out. A real empty-state component; text inviting an action; OR, for a
     feature the free plan does not include, an explanation of what it is and
     what it costs. Crew does the last of those - "Give it an outcome and it
     plans the steps ... Included with Pro, $15/month" - which is a better
     first visit than an empty list, and my first version called it a failure
     for not containing the word "create". */
  const shouldGuide = ['images', 'tasks', 'crew', 'memory'];
  const silent = shouldGuide.filter(t => {
    const r = seen[t];
    if (!r) return false;
    if (r.hasEmptyState) return false;
    if (/create|start|add|try|generate|new |get started|first|give it/i.test(r.text)) return false;
    /* An upgrade explainer: says what the feature is AND what it costs. */
    if (/\$\d/.test(r.text) && /pro|elite|ultra|plan/i.test(r.text)) return false;
    return true;
  });
  ok(silent.length === 0,
     'each offers something to do, or says what it is and what it costs', silent);
}

section('Chat is ready to be typed into immediately');
{
  /* The one screen a new account lands on, and the whole product's front
     door. If the composer is not there and focusable, the first thing anybody
     does with AMV does not work. */
  const r = await page.evaluate(async () => {
    setTab('chat');
    await new Promise(x => setTimeout(x, 500));
    const box = document.getElementById('mta');
    if (!box) return { found: false };
    box.focus();
    const rect = box.getBoundingClientRect();
    return {
      found: true,
      focusable: document.activeElement === box,
      visible: !__under(rect.width, 100) && !__under(rect.height, 10),
      disabled: !!box.disabled,
      placeholder: (box.getAttribute('placeholder') || '').slice(0, 60),
    };
  });
  ok(r.found && r.visible, 'the composer is on screen', r);
  ok(r.focusable && !r.disabled, 'and can be typed into at once', r);
  ok(r.placeholder.length > 0, 'with a prompt suggesting what to do', r.placeholder);
}

section('Billing shows the free plan honestly, not a broken subscription');
{
  /* A new account has never paid, so every field a billing screen wants -
     invoice history, payment method, renewal date - is absent. That is the
     classic place for "undefined" and "Invalid Date" to reach a customer. */
  const r = await page.evaluate(async () => {
    setTab('billing');
    await new Promise(x => setTimeout(x, 700));
    const vc = document.getElementById('vc') || document.body;
    const text = (vc.textContent || '').replace(/\s+/g, ' ').trim();
    return { text, len: text.length };
  });
  ok(r.len > 40, 'the billing screen renders', r.len);
  ok(!/undefined|NaN|Invalid Date|\[object/i.test(r.text),
     'with no placeholder values leaking through', (r.text.match(/undefined|NaN|Invalid Date|\[object/i) || [])[0]);
  ok(/free/i.test(r.text), 'and it says they are on Free', /free/i.test(r.text));
  ok(/upgrade|plan|pro/i.test(r.text),
     'while showing there is something to upgrade to', true);
}

section('Nothing threw across the whole first session');
{
  ok(L.errors.length === 0, 'no JavaScript errors on any screen', L.errors.slice(0, 4));
  const failed = L.served.filter(s => s.status >= 500);
  ok(failed.length === 0, 'and no request made the worker fall over', failed.map(s => s.path));
}

section('And a first visit really did talk to the server');
{
  /* Cheap insurance that the whole file did not just exercise a demo. */
  const paths = [...new Set(L.served.map(s => s.path))];
  ok(paths.includes('/auth/signup'), 'the account was created over the wire', paths.length);
  ok(paths.some(p => /entitlement|sync|public-config/.test(p)),
     'and the screens really asked the backend about them', paths.slice(0, 8));
}

await L.close();
if (report('the-first-session') > 0) process.exitCode = 1;
done();
