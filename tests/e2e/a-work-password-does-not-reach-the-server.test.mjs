/* THE BOX SAID IT WOULD NOT STORE PASSWORDS, AND IT STORED THEM.

   A Crew job can ask a setup question - "what does this job need to know?" -
   and the answer is kept ON THE SERVER and read on every run. The dialog says
   so, and says plainly: "Do not put passwords, card numbers or security codes
   here. AMV does not store them."

   refuseSecrets is what made that true, and it required a SEPARATOR after the
   label - `password: x`, `password = x`, `password is x`. The reasoning was
   that a separator marks a credential being handed over rather than a sentence
   about one. Sound, and far too narrow for how people actually type. Tested
   against what somebody would really write in that box, both of these were
   allowed straight through:

       "my LinkedIn login is adrian@x.com password Hunter2!"
       "Point72 portal user amaroto pass Tr@d3r2024"

   The second is worse: `pass` was not in the list at all. So a work password
   would have been written to KV and re-read on every run for as long as the job
   was on, under a promise that it would not be.

   WHY THIS IS THE ONE THAT MATTERS. The owner has asked for a box where people
   put "website account password details etc" so AMV can sign in and do the job.
   That is the feature this guard exists to refuse, and the refusal is the
   product working correctly - a stored third-party password is a breach waiting
   for somebody else's schedule, and signing in to an employer's systems with
   borrowed credentials is not something a product should help anybody do. The
   path that DOES work is Connected accounts: a real sign-in at the provider,
   scoped, revocable, and the token never in the browser.

   BOTH DIRECTIONS ARE ASSERTED. A guard that refuses everything is not a guard,
   it is an outage - somebody describing ordinary work must not be told they
   pasted a credential. The first widening did exactly that: it matched "reset
   my password today" because the symbol class included a comma, so any word
   followed by punctuation looked like a credential. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const MUST_REFUSE = {
  'a label with no separator':      'my LinkedIn login is adrian@x.com password Hunter2!',
  'the short form "pass"':          'Point72 portal user amaroto pass Tr@d3r2024 at portal.point72.com',
  'an address and a slash':         'login adrian@x.com / Hunter2!',
  'the ordinary colon form':        'password: Hunter2',
  'one-letter labels':              'u: amaroto p: whatever - portal.point72.com',
  'somebody else’s work login': 'my dad works at Point72, his portal login is dmaroto and the password is Summer2024!',
  /* These two depend on the label rule ALONE - no user/login/email word nearby
     for the pairing rules to catch. Without them the sabotage run passed with
     the password rule deleted, because the pairing rules were quietly covering
     every case: defence in depth is good, and a test that cannot tell which
     layer is working is not. */
  'a bare label, no pairing':       'the portal wants pass Hunter2024! every morning',
  'a passphrase on its own':        'passphrase correct-horse-9!-battery',
  'an API key':                     'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
  'a card and its code':            'card 4111 1111 1111 1111 exp 04/28 cvv 123',
  'a private key':                  '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA',
  'a recovery phrase':              'seed phrase: alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima',
};

const MUST_ALLOW = {
  'describing the work':        'I work at a hedge fund and need my overdue tasks summarised each morning',
  'naming services only':       'Dropbox, LinkedIn, my bank',
  'talking about a password':   'remind me to reset my password today, it expired',
  'a boarding pass':            'check my boarding pass yesterday was refunded',
  'a bug about a login page':   'the password reset page on our site is broken, draft a bug report',
  'sites to update':            'LinkedIn, Indeed and Otta - update my CV on each',
  'an address in prose':        'email me at adrian@example.com when it is done',
  'a URL to watch':             'watch https://news.example.com/markets for me',
  'a pass/fail ratio':          'the pass/fail ratio last term was 82%',
  'a long ordinary sentence':   'Every Monday check which of my accounts have unread items and tell me which need me',
};

const app = await bootApp({ tab: 'crew', user: { name: 'A', email: 'a@x.com', ini: 'A' } });
const { page, errors } = app;

section('The detector is really being asked');
{
  const live = await page.evaluate(() => typeof findSecrets === 'function' && typeof refuseSecrets === 'function');
  ok(live, 'both the detector and the refusal are on the page', live);
  /* A detector that finds nothing at all would pass every "must allow" case
     and fail nothing - so prove it can find something before trusting it. */
  const control = await page.evaluate(() => findSecrets('password: Hunter2').length);
  ok(control > 0, 'and it finds the plainest case, so the rest means something', control);
}

section('Nothing that hands over a credential gets through');
{
  const leaks = await page.evaluate((cases) =>
    Object.entries(cases).filter(([, v]) => findSecrets(v).length === 0).map(([k]) => k), MUST_REFUSE);
  ok(leaks.length === 0, 'every one is caught before it can be saved', leaks);
}

section('And describing ordinary work is not mistaken for one');
{
  const wrong = await page.evaluate((cases) =>
    Object.entries(cases).map(([k, v]) => [k, findSecrets(v)]).filter(([, f]) => f.length)
      .map(([k, f]) => k + ' -> ' + f.join(', ')), MUST_ALLOW);
  ok(wrong.length === 0, 'not one ordinary sentence is refused', wrong);
}

section('The refusal does the safe thing rather than describing it');
{
  /* This used to assert that the word "Integrations" appeared in the body,
     which is a check on prose: it passes for a dialog that names the right
     place and leaves somebody to go and find it among forty rows. What the
     person came here for is the job getting done, so the assertion is now
     that the button DOES it - the refusal is unchanged either way. */
  const r = await page.evaluate(async () => {
    let seen = null;
    const realModal = window._showModalAsync;
    window._showModalAsync = async (o) => { seen = o; return true; };   // press the primary
    const allowed = refuseSecrets('my LinkedIn login is a@x.com password Hunter2!', 'crew_ask');
    window._showModalAsync = realModal;
    await new Promise(f => setTimeout(f, 250));
    return { allowed, said: (seen && seen.body) || '', ok: seen && seen.okText,
             cancel: seen && seen.cancelText, tab: S.tab, pane: S.settingsPane };
  });
  ok(r.allowed === false, 'the write is still refused', r.allowed);
  ok(/not saved|Nothing was saved/i.test(r.said),
     'and the person is told plainly that nothing was stored', r.said.slice(0, 90));
  ok(/^Connect /.test(r.ok || ''), 'the primary button offers the way that works', r.ok);
  ok(/LinkedIn/.test(r.ok || ''),
     'and names the service they were trying to hand over, so it is one step not a search', r.ok);
  ok(!!r.cancel, 'with a way to decline, so the dialog is not a trap', r.cancel);
  ok(r.tab === 'settings' && r.pane === 'integrations',
     'and pressing it actually lands on Connected accounts', { tab: r.tab, pane: r.pane });
}

section('A credential with no service named still gets a way out');
{
  const r = await page.evaluate(async () => {
    let seen = null;
    const realModal = window._showModalAsync;
    window._showModalAsync = async (o) => { seen = o; return false; };  // decline
    const allowed = refuseSecrets('the portal wants pass Hunter2024! every morning', 'crew_ask');
    window._showModalAsync = realModal;
    return { allowed, ok: seen && seen.okText };
  });
  ok(r.allowed === false, 'still refused', r.allowed);
  ok(r.ok === 'Connect an account',
     'and offered the generic route rather than nothing at all', r.ok);
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
if (report('a-work-password-does-not-reach-the-server') > 0) process.exitCode = 1;
done();
