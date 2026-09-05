/* THE GO-LIVE SCREEN - it used to be a list of guesses.

   Three of its rows were hardcoded to "not set up" whatever the truth was, and
   the row for the AI engine reported whether THIS BROWSER had a session, which
   says nothing about whether the Worker holds an API key. The screen whose
   entire job is to answer "is this real yet" could not see a single server
   secret and answered confidently anyway. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { overflowingElement } from '../lib/layout.mjs';

const app = await bootApp({ tab: 'settings' });
const { page, errors } = app;
await page.evaluate(() => {
  S.user = { name: 'Owner', email: OWNER_EMAIL, ini: 'O', provider: 'email' };
  store('amv_user', S.user);
});

const REPORT = {
  ok: true, checkedAt: Date.now(),
  items: [
    { id: 'ai', name: 'AI engine', blocking: true, on: false, group: 'Core',
      turnsOn: 'Every answer, agent, build, document and scheduled task.', how: 'wrangler secret put AMV_MODEL_KEY' },
    { id: 'auth', name: 'Accounts and sessions', blocking: true, on: true, group: 'Core',
      turnsOn: 'Sign-in, sync and every authenticated route.', how: 'wrangler secret put JWT_SECRET' },
    { id: 'email', name: 'Email delivery', blocking: false, on: false, group: 'Reaching people',
      turnsOn: 'Password resets, the weekly digest, and automation results reaching an inbox.', how: 'wrangler secret put EMAIL_API_KEY' },
    { id: 'stripePrices', name: 'Plan prices (Stripe)', blocking: false, on: false, group: 'Taking money',
      turnsOn: 'Buying Pro, Elite and Ultra. Without the price id that plan cannot be sold.',
      how: 'wrangler secret put STRIPE_PRICE_PRO' },
  ],
  groupOrder: ['Core', 'Taking money', 'Reaching people', 'Signing in', 'Connected accounts', 'Watching it run', 'Other'],
  tuning: [
    { id: 'spendCap', name: 'Daily spend ceiling', env: 'GLOBAL_DAILY_USD_CAP', set: false,
      effect: 'The most AMV will spend on model calls in one day before it starts refusing. Defaults to $500.' },
    { id: 'writeCap', name: 'Non-essential write budget', env: 'NONESSENTIAL_WRITE_CAP', set: true,
      effect: 'How many writes a day telemetry and the waitlist may spend before they are dropped.' },
  ],
  storage: [
    { id: 'kv', name: 'KV namespace', blocking: true, on: true,
      turnsOn: 'All persistence. Nothing works without it.', how: 'Bind AMV_KV in wrangler.toml' },
    { id: 'd1', name: 'D1 database', blocking: false, on: false,
      turnsOn: 'Guaranteed sync writes: without it two devices saving at the same instant cannot be arbitrated.', how: 'Bind DB in wrangler.toml' },
  ],
  summary: { on: 2, total: 6, blockingMissing: 1, verdict: 'Not ready: AI engine still missing.' },
};

const wire = (opts = {}) => page.evaluate(cfg => {
  window.__calls = [];
  saveStr('amv_api_base', cfg.noBase ? '' : 'https://amv-stub.workers.dev');
  if (typeof _setAdminToken === 'function') _setAdminToken(cfg.noToken ? '' : 'admin-secret');
  window.fetchDeadline = async (url, init) => {
    const u = String(url);
    window.__calls.push({ url: u, auth: (init && init.headers && init.headers.Authorization) || '' });
    if (u.includes('/admin/readiness')) {
      if (cfg.status === 403) return { ok: false, status: 403, json: async () => ({ error: 'forbidden' }) };
      if (cfg.throws) throw new Error('offline');
      return { ok: true, status: 200, json: async () => cfg.report };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
}, { report: REPORT, noBase: !!opts.noBase, noToken: !!opts.noToken, status: opts.status || 200, throws: !!opts.throws });

const openPlatform = async () => {
  await page.evaluate(() => { S.settingsPane = 'platform'; renderSetPane(); });
  await page.waitForSelector('#golive-body', { timeout: 15000 });
};
const golive = () => page.evaluate(() => document.getElementById('golive-body').textContent);

section('It reads the real configuration from the server');
{
  await wire();
  await openPlatform();
  await page.waitForFunction(() => /AI engine/.test(document.getElementById('golive-body').textContent), { timeout: 15000 });
  const t = await golive();
  ok(/Not ready: AI engine still missing/.test(t), 'the verdict is the first thing said', t.slice(0, 60));
  ok(/2 of 6 configured/.test(t), 'with a real count', t);
  ok(/Every answer, agent, build/.test(t), 'each line says what it turns on');
  ok(/wrangler secret put AMV_MODEL_KEY/.test(t), 'and the exact command for the ones that are off');

  const auth = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.gl-row')];
    const r = rows.find(x => /Accounts and sessions/.test(x.textContent));
    return { done: r.classList.contains('gl-done'), hasCmd: !!r.querySelector('.gl-cmd') };
  });
  ok(auth.done === true, 'something already configured is marked live');
  ok(auth.hasCmd === false, 'and is not told how to set what it already has');
}

section('Thirty-six rows are grouped, not stacked');
{
  /* The screen carried sixteen rows and read as a list. Every capability the
     Worker can switch on has a row now, and an undivided list that long is one
     somebody scrolls past - so the money rows, the delivery rows and the
     sign-in rows each sit under their own heading, in the order the SERVER
     sends, because the server is what decides which group a row belongs to. */
  const g = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#golive-body .gl-sec')].map(h => h.textContent);
    /* Which heading each row actually sits under, walked in document order -
       the thing that would break if the grouping rendered but put every row in
       one bucket, which reading the headings alone would not catch. */
    const under = {};
    let cur = null;
    for (const el of document.querySelectorAll('#golive-body .gl-sec, #golive-body .gl-row')) {
      if (el.classList.contains('gl-sec')) cur = el.textContent;
      else {
        /* Keyed off .gl-label rather than the row's textContent: the status
           circle and the "live" badge are inside the row too, so the row's own
           text is the icon glyph followed by the name and never starts with
           it. */
        const lab = el.querySelector('.gl-label');
        const name = lab ? lab.childNodes[0].textContent.trim() : '';
        if (name) under[name] = cur;
      }
    }
    return { heads, under };
  });
  ok(g.heads.includes('Core') && g.heads.includes('Taking money') && g.heads.includes('Reaching people'),
     'each group the server sent rows for gets a heading', g.heads);
  ok(g.heads.indexOf('Core') < g.heads.indexOf('Taking money'),
     'in the order the server sent, not alphabetically', g.heads);
  ok(!g.heads.includes('Signing in'),
     'and a group with no rows is skipped rather than rendered empty', g.heads);
  ok(/Core/.test(g.under['AI engine'] || ''), 'the AI engine sits under Core', g.under['AI engine']);
  ok(/Taking money/.test(g.under['Plan prices (Stripe)'] || ''),
     'and the price row under Taking money, so the grouping is real and not just headings',
     g.under['Plan prices (Stripe)']);
  ok(/Storage bindings/.test(g.heads.join('|')), 'storage keeps its own heading', g.heads);
}

section('A setting with a working default is not drawn as a fault');
{
  /* Six of the rows are knobs, not capabilities: a spend ceiling, a write
     budget, an endpoint override. Drawing them as .gl-row would put six
     permanent "not set up" circles on a deployment behaving exactly as
     intended, and a screen with standing red on it is one somebody stops
     reading - which costs the rows that ARE saying something. */
  const t = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#golive-body .gl-tune')];
    const cap = rows.find(r => /Daily spend ceiling/.test(r.textContent));
    const write = rows.find(r => /Non-essential write budget/.test(r.textContent));
    const cs = cap && getComputedStyle(cap);
    return {
      count: rows.length,
      capTag: cap && cap.querySelector('.gl-tag').textContent.trim(),
      writeTag: write && write.querySelector('.gl-tag').textContent.trim(),
      capCmd: !!(cap && cap.querySelector('.gl-cmd')),
      noIcon: !!(cap && !cap.querySelector('.gl-ic')),
      styled: !!(cs && cs.paddingTop !== '0px'),
      heads: [...document.querySelectorAll('#golive-body .gl-sec')].map(h => h.textContent),
    };
  });
  ok(t.count === 2, 'each knob the server sent is rendered', t.count);
  ok(t.capTag === 'default', 'an unset knob says "default", not "not set up"', t.capTag);
  ok(t.writeTag === 'set', 'and a set one says so', t.writeTag);
  ok(t.capCmd, 'each still carries the command, because it is a thing you can change');
  ok(t.noIcon, 'but not a status circle, because there is no fault to report');
  ok(t.styled, 'and the class has a rule, which is how the rows shipped unstyled last time');
  ok(t.heads.some(h => /working default/.test(h)), 'under a heading that says what they are', t.heads);
}

section('A missing REQUIRED thing looks different from an optional one');
{
  const v = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.gl-row')];
    const ai = rows.find(x => /AI engine/.test(x.textContent));
    const email = rows.find(x => /Email delivery/.test(x.textContent));
    return { aiBlock: ai.classList.contains('gl-block'), aiTag: ai.querySelector('.gl-tag').textContent,
             emailBlock: email.classList.contains('gl-block'), emailTag: email.querySelector('.gl-tag').textContent };
  });
  ok(v.aiBlock && /required/.test(v.aiTag), 'the blocker is marked required', v.aiTag);
  ok(!v.emailBlock && /not set up/.test(v.emailTag), 'an optional one is simply off, not an alarm', v.emailTag);
}

section('And the rows LOOK like rows, which nothing here ever checked');
{
  /* THE GAP THAT LET THE SCREEN SHIP UNSTYLED.

     Every assertion above this one reads text or a class name, and a class name
     is a promise about appearance, not the appearance. LAYER A39 styled the
     verdict, the command line, the section headings and the closing note - and
     never styled the rows. .gl-row had no layout, .gl-ic no size, .gl-tag no
     shape, and .gl-body, .gl-label and .gl-how no rule at all, so the screen
     somebody reads before deciding AMV can launch rendered as stacked
     default-weight divs. Sixteen green assertions above did not notice, because
     "does it contain the word required" is true either way.

     So this measures. Not pixel values - those are somebody's design decision
     and will change - but the properties that distinguish a designed row from
     an undesigned one: it is laid out, the icon and the label share a line, the
     label outranks the body text, and the tag is a pill rather than a word. */
  const v = await page.evaluate(() => {
    const row = document.querySelector('.gl-row');
    const ic = row.querySelector('.gl-ic');
    const label = row.querySelector('.gl-label');
    const how = row.querySelector('.gl-how');
    const tag = row.querySelector('.gl-tag');
    const num = x => parseFloat(x) || 0;
    const rs = getComputedStyle(row), ls = getComputedStyle(label), hs = getComputedStyle(how), ts = getComputedStyle(tag);
    return {
      rowDisplay: rs.display,
      rowPad: num(rs.paddingTop) + num(rs.paddingLeft),
      rowFramed: num(rs.borderTopWidth) > 0 || rs.backgroundColor !== 'rgba(0, 0, 0, 0)',
      iconW: Math.round(ic.getBoundingClientRect().width),
      sameLine: Math.abs(ic.getBoundingClientRect().top - label.getBoundingClientRect().top) < 12,
      labelWeight: num(ls.fontWeight),
      labelSize: num(ls.fontSize),
      howSize: num(hs.fontSize),
      howMuted: hs.color !== ls.color,
      tagRadius: num(ts.borderTopLeftRadius),
      tagPad: num(ts.paddingLeft),
    };
  });
  ok(v.rowDisplay === 'flex', 'a row is laid out rather than left as a stack of divs', v.rowDisplay);
  ok(v.rowPad > 0 && v.rowFramed, 'and is a surface with padding, not bare text on the page',
     v.rowPad + 'px pad, framed:' + v.rowFramed);
  ok(v.iconW > 0 && v.sameLine, 'the status mark sits beside the name, not above it',
     v.iconW + 'px, sameLine:' + v.sameLine);
  ok(v.labelWeight >= 600, 'the name of the thing is weighted as a name', v.labelWeight);
  ok(v.howSize < v.labelSize && v.howMuted,
     'and what it turns on reads as supporting text, not as another heading',
     v.howSize + ' vs ' + v.labelSize + ', muted:' + v.howMuted);
  ok(v.tagRadius >= 8 && v.tagPad > 0, 'live / required / not set up is a pill, not a loose word',
     'radius ' + v.tagRadius + ', pad ' + v.tagPad);
}

section('Storage bindings are shown, and what their absence costs');
{
  const t = await golive();
  ok(/Storage bindings/.test(t), 'they are listed under their own heading');
  ok(/two devices saving at the same instant/.test(t), 'and a missing one explains the real consequence');
}

section('It carries the ADMIN token, not the user session');
{
  const c = await page.evaluate(() => window.__calls.find(x => x.url.includes('/admin/readiness')));
  ok(c.auth === 'Bearer admin-secret', 'the admin secret is what is sent', c.auth);
}

section('With nothing to ask, it asks - it does not guess');
{
  await wire({ noBase: true });
  await openPlatform();
  const t = await golive();
  ok(/Connect your backend first/.test(t), 'no backend, so it says to connect one', t.slice(0, 80));
  ok(!/live/.test(t), 'and claims nothing is live');

  await wire({ noToken: true });
  await openPlatform();
  const t2 = await golive();
  ok(/admin token/.test(t2), 'no token, so it asks for one', t2.slice(0, 80));
  ok((await page.evaluate(() => window.__calls.filter(c => c.url.includes('/admin/readiness')).length)) === 0,
     'and makes no request it cannot authenticate');

  /* It asks HERE rather than sending the operator to another screen - this is
     the page they are on while pasting secrets. */
  ok(await page.evaluate(() => !!document.getElementById('gl-tok')), 'the field is on this page');
  await page.evaluate(() => {
    document.getElementById('gl-tok').value = 'admin-secret';
    document.getElementById('gl-tok-go').click();
  });
  await page.waitForFunction(() => /AI engine/.test(document.getElementById('golive-body').textContent), { timeout: 15000 });
  ok(/Not ready/.test(await golive()), 'and entering it loads the report without leaving');
}

section('A refusal or an outage says so, rather than showing a stale all-clear');
{
  await wire({ status: 403 });
  await openPlatform();
  await page.waitForFunction(() => /rejected/.test(document.getElementById('golive-body').textContent), { timeout: 15000 });
  ok(/rejected/.test(await golive()), 'a bad token is reported as a bad token');

  await wire({ throws: true });
  await openPlatform();
  await page.waitForFunction(() => /out of date|Could not reach/.test(document.getElementById('golive-body').textContent), { timeout: 15000 });
  ok(/Could not reach/.test(await golive()), 'and an outage is reported instead of showing a stale answer');
}

section('It reads on a phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await wire();
  await openPlatform();
  await page.waitForFunction(() => /AI engine/.test(document.getElementById('golive-body').textContent), { timeout: 15000 });
  const m = await page.evaluate(() => ({
        cmdScrolls: getComputedStyle(document.querySelector('.gl-cmd')).overflowX,
  }));
  ok((await overflowingElement(page)) === null, 'nothing overflows the screen', await overflowingElement(page));
  ok(m.cmdScrolls === 'auto', 'a long command scrolls inside its own box instead of stretching the page', m.cmdScrolls);
  await page.setViewportSize({ width: 1280, height: 900 });
}

ok(errors.length === 0, 'no console errors', errors.slice(0, 3));
report('readiness-ui');
done();
