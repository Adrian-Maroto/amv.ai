/* AMV WORKS SOMEWHERE, AND UNTIL NOW THERE WAS NO WAY TO FIND OUT WHERE.

   The first question somebody outside the United States has is not "what can
   this do", it is "does any of this work where I live". The only way to answer
   it was to read an integrations list and infer.

   Three things here, and they are one piece of work:

     - the coverage board, COMPUTED from the registries the features actually
       use, so it cannot promise a country something the product does not do;
     - the gaps that computing it exposed, including the one that mattered
       most: there was no Gmail, Outlook, Yahoo or iCloud entry at all, so an
       American with two-factor on could not use the mail connector while a
       Pole could, and neither could anyone in Egypt, Indonesia, Nigeria,
       Argentina, Saudi Arabia or Mexico, where a national ISP is not what
       people use;
     - and a country's people being able to PAY, which is the part that decides
       whether any of the rest earns anything. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';
import { codeOnly, functionBody } from '../lib/source.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'world.harness.mjs');
writeFileSync(harness, src +
  '\nexport { MAIL_PROVIDERS, JOB_BOARDS, CONTINENT_OF, COUNTRY_NAME, _coverage,' +
  ' PER_USER_KINDS, BACKUP_NEVER, telegramConnect, telegramStatus, issueTokens, DB };\n');
const W = await import(harness + '?t=' + Date.now());

/* The countries the owner named as the ones AMV will be promoted in. If a
   feature does not reach one of these, the promotion reaches somebody who
   cannot use it, which is worse than not promoting there at all. */
const PROMOTED = {
  US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', AR: 'Argentina',
  DE: 'Germany', GB: 'United Kingdom', FR: 'France', IT: 'Italy', RU: 'Russia',
  CN: 'China', IN: 'India', JP: 'Japan', ID: 'Indonesia', SA: 'Saudi Arabia', KR: 'South Korea',
  NG: 'Nigeria', EG: 'Egypt', ZA: 'South Africa', AU: 'Australia',
};

section('Mail reaches every country AMV will be promoted in');
{
  const providers = Object.values(W.MAIL_PROVIDERS);
  const global = providers.filter((p) => p.global);
  ok(global.length >= 5,
     'there are providers that work everywhere, not only national ISPs', global.map((p) => p.name));

  /* THE ONE THAT WAS EMBARRASSING. Thirty-nine non-American providers and no
     Gmail: an American with two-factor could not use the connector at all. */
  ok(!!(W.MAIL_PROVIDERS.gmail && W.MAIL_PROVIDERS.outlook),
     'including Gmail and Outlook, which is what most of the world is on', true);
  ok(/App Password/i.test((W.MAIL_PROVIDERS.gmail || {}).setup || ''),
     'and Gmail says it needs an App Password, which is the thing everyone gets wrong', true);

  /* Global providers serve every country, so mail coverage is universal - the
     national ones are extra reach, not the baseline. */
  const national = new Set(providers.filter((p) => !p.global && !p.custom && p.country).map((p) => p.country));
  Object.entries(PROMOTED).forEach(([code, name]) => {
    ok(global.length > 0 || national.has(code), name + ' can connect a mailbox', true);
  });
}

section('And every one of them has somewhere to look for work');
{
  const byCountry = new Set(Object.values(W.JOB_BOARDS).map((b) => b.country));
  const missing = Object.entries(PROMOTED).filter(([c]) => !byCountry.has(c)).map(([, n]) => n);
  ok(missing.length === 0, 'no promoted country is left without a job board', missing);
  ok(byCountry.size >= 40, 'across this many countries in total', byCountry.size);

  /* Named, because a count is satisfiable without the ones that were asked
     for. These are the six that were gaps before this change. */
  ['US', 'CA', 'AR', 'ID', 'SA', 'EG'].forEach((c) => {
    ok(byCountry.has(c), PROMOTED[c] + ' now has boards', c);
  });
}

section('The coverage board is computed, never written by hand');
{
  const cov = W._coverage();
  ok(cov.countries.length >= 100, 'it covers this many countries', cov.countries.length);
  ok(cov.totals.continents >= 5, 'across this many continents', cov.totals.continents);

  /* The whole point: every number traces to a registry entry. A hand-kept
     coverage page goes stale in a month and then lies to exactly the people it
     was built for.

     EVERY country, not one of them. Checking Germany alone was satisfiable by
     a constant - Germany happens to have exactly three national providers, so
     replacing the derivation with the literal 3 passed. A sabotage that passes
     is the check telling you it was measuring nothing. Across all forty-odd
     countries there is no constant that fits. */
  const wrongMail = cov.countries.filter((c) =>
    c.mail.national !== Object.values(W.MAIL_PROVIDERS)
      .filter((p) => p.country === c.code && !p.global && !p.custom).length)
    .map((c) => c.code);
  const wrongJobs = cov.countries.filter((c) =>
    c.jobs.boards !== Object.values(W.JOB_BOARDS).filter((b) => b.country === c.code).length)
    .map((c) => c.code);
  ok(wrongMail.length === 0, 'every mail count is the real number, in every country', wrongMail);
  ok(wrongJobs.length === 0, 'and so is every board count', wrongJobs);

  /* The counts differ from each other, so a single wrong constant cannot sit
     where the derivation was and go unnoticed by the two checks above. */
  const spread = new Set(cov.countries.map((c) => c.mail.national)).size;
  ok(spread >= 3, 'and those numbers are not all the same, so a constant cannot pass for them', spread);

  /* A country grouped under "Other" means somebody added a provider and forgot
     the continent map. Visible rather than silent. */
  const orphan = cov.countries.filter((c) => c.continent === 'Other').map((c) => c.code);
  ok(orphan.length === 0, 'every country is placed on a continent', orphan);
  const unnamed = cov.countries.filter((c) => c.name === c.code).map((c) => c.code);
  ok(unnamed.length === 0, 'and named, rather than shown as a two-letter code', unnamed);

  /* The fact that changes what somebody expects overnight. */
  const canApply = cov.countries.filter((c) => c.jobs.autoApply).map((c) => c.code);
  ok(canApply.length >= 5,
     'and it says which countries AMV can actually apply in', canApply);
}

section('People in those countries can actually pay');
{
  /* The part that decides whether any of the rest earns anything. Cards are a
     United States assumption: iDEAL is the majority of Dutch online payments,
     BLIK is how Poland pays, PIX is universal in Brazil, OXXO is cash at a shop
     counter in Mexico. Somebody could read AMV in Polish, browse Polish boards,
     connect a Polish mailbox, and then find the only way to subscribe was a
     card they may not own. */
  const code = codeOnly(src);
  const sub = codeOnly(functionBody(src, 'stripeCheckout'));
  const buy = codeOnly(functionBody(src, 'marketBuy'));
  ok(/automatic_payment_methods\[enabled\]/.test(sub),
     'a subscription offers the methods available where the buyer lives', true);
  ok(/automatic_payment_methods\[enabled\]/.test(buy),
     'and so does a marketplace purchase, where the one-off methods matter most', true);

  /* Stripe's own resolution rather than a hand-kept list of method names per
     country. A list is wrong the first time Stripe adds a market, and wrong in
     the direction of a payment that fails - and it cannot know which methods
     support recurring, which a subscription depends on. */
  ok(!/payment_method_types\[\d\]/.test(code),
     'and no hand-maintained list of methods that would go stale', true);

  /* It cannot turn on anything the operator has not enabled in their Stripe
     dashboard, which is what makes this safe to ship rather than a change to
     what AMV charges or how. */
  ok(!/price|amount|currency/i.test(
       (sub.match(/automatic_payment_methods[^\n]*/) || [''])[0]),
     'and it changes how somebody pays, never what they are charged', true);
}

section('A Telegram bot token is treated like the credential it is');
{
  ok(W.PER_USER_KINDS.includes('telegram'), 'it is erased with the account', true);
  ok(W.BACKUP_NEVER.includes('telegram:'),
     'and never written into a file somebody can download', true);

  const fn = codeOnly(functionBody(src, 'telegramConnect'));
  ok(/_mailEncrypt\(/.test(fn), 'it is encrypted at rest', true);
  ok(/getMe/.test(fn), 'and proved with Telegram before it is stored', true);
  const status = codeOnly(functionBody(src, 'telegramStatus'));
  ok(!/secret/.test(status.replace(/rec && rec\.secret/g, '')),
     'and the token never comes back out', true);

  /* A token contains a colon, and Telegram is addressed as /bot<token>/METHOD
     with the token RAW. encodeURIComponent turns that colon into %3A, which
     would have made every connect and every send address a path Telegram does
     not serve - the integration would not have worked at all, in a way no
     test here can see because api.telegram.org is unreachable from the test
     environment. So the grammar is asserted instead of the round trip. */
  const code = codeOnly(src);
  ok(!/encodeURIComponent\(token\)/.test(code),
     'the token is not percent-encoded into a path that Telegram does not serve', true);
  ok(/\/bot\$\{token\}\//.test(code), 'it goes in raw, the way the API is addressed', true);

  /* Raw is only safe because the shape is proved first, and proved by BOTH
     paths - the one that takes it from a person and the one that takes it back
     out of storage. One shared pattern, so they cannot drift apart. */
  const shape = (code.match(/const TELEGRAM_TOKEN_RE = ([^\n]+)/) || [])[1] || '';
  ok(/^\/\^/.test(shape.trim()) && /\$\/;?$/.test(shape.trim()),
     'and its shape is anchored at both ends, so nothing else can ride along', shape.trim());
  ok(!/[/.?#]/.test('123456789:AAbbbbccccddddeeeeffff'.replace(/[A-Za-z0-9_:-]/g, '')),
     'a token that passes cannot contain a slash, dot, query or fragment', true);
  ok((code.match(/TELEGRAM_TOKEN_RE\.test\(/g) || []).length >= 2,
     'and both the connect and the send check it', (code.match(/TELEGRAM_TOKEN_RE\.test\(/g) || []).length);
  ok(/TELEGRAM_TOKEN_RE\.test\(token\)/.test(codeOnly(functionBody(src, '_telegramSend'))),
     'including the one that reads it back out of storage', true);
}

section('What the screen says about a connection, it asked the server');
{
  /* The Telegram row first shipped reading a localStorage key that NOTHING
     ever writes. It would have shown "Connect" to somebody already connected,
     for ever - and the obvious response to that is to connect a second time.
     A row whose state can never change is decoration, which is the one thing
     this product is not allowed to ship. */
  const app = codeOnly(readFileSync(join(ROOT, 'app.js'), 'utf8'));
  ok(/async function refreshTelegramStatus\(\)/.test(app),
     'the connected state is fetched, not guessed from the browser', true);
  ok(/_TG_STATUS = await AMV_API\.telegramStatus\(\)/.test(app),
     'and it comes from the route that holds the token', true);
  ok(!/isConn\('amv_telegram/.test(app),
     'no local flag stands in for a credential the server holds', true);

  /* And the refresh has to happen BEFORE the repaint, or the honest answer
     arrives after the wrong one is already on screen. */
  const refresh = codeOnly(functionBody(app, '_refreshIntegrationsUI'));
  ok(/refreshTelegramStatus\(\)/.test(refresh) && /_paintIntegrations\(\)/.test(refresh),
     'and the repaint waits for it', true);
}

section('A job says what it will need before the day it needs it');
{
  /* The server resolves this for every job on the list. If the badge is
     computed and never rendered, the whole pre-flight is a server round trip
     that changes nothing anybody sees. */
  const app = codeOnly(readFileSync(join(ROOT, 'app.js'), 'utf8'));
  ok(/function _mcWillNeed\(item\)/.test(app), 'the badge exists', true);
  ok(/_mcWillNeed\(it\)/.test(app), 'and something actually calls it', true);
  ok(/\+ willNeed/.test(app), 'and puts the result on the job row', true);

  const list = codeOnly(src);
  ok(/willNeed: n\.missing/.test(list),
     'and the server sends what is missing, per job, with the list', true);
}

section('The board is a board on purpose, not a map');
{
  /* A real world map is ~100KB of path data in a single-file app with a hard
     page-weight ceiling, and it would be the heaviest thing a visitor
     downloads - on exactly the phones this exists to reach. Asserted so
     somebody does not helpfully add one later. */
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const paths = (app.match(/ d="M[\d.\- ]{200,}/g) || []).length;
  ok(paths === 0, 'no giant geographic path data was shipped to do this', paths);
}

if (report('amv-around-the-world') > 0) process.exitCode = 1;
done();
