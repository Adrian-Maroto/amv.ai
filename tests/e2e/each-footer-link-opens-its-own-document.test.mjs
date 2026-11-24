/* EACH FOOTER LINK OPENS ITS OWN DOCUMENT.

   The landing page's footer has Privacy Policy, Terms of Service and Cookie
   Policy, and all three opened the Terms. So a visitor deciding whether to
   sign up could not reach the Privacy Policy from the page that asks them to
   - the document a payment processor and data-protection law both expect to
   be one click away. Nothing noticed, because every suite about the policies
   opened them by calling the function, never by pressing the link.

   This presses each link as a signed-out visitor and reads the heading of
   what opened. The cookie link opens the Privacy Policy, whose section on
   cookies and local storage is where AMV states that. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: null });
const { page, errors } = app;

const press = (id) => page.evaluate(async (bid) => {
  const o = document.getElementById('ovr'); o.innerHTML = ''; o.className = '';
  document.getElementById('ck')?.remove();
  const b = document.getElementById(bid);
  if (!b) return { missing: true };
  b.scrollIntoView();
  b.click();
  await new Promise(r => setTimeout(r, 400));
  const h = o.querySelector('h2');
  return { heading: h ? h.textContent.trim() : '', text: (o.innerText || '').slice(0, 4000) };
}, id);

section('Privacy Policy opens the Privacy Policy');
{
  const r = await press('fp-btn');
  ok(!r.missing && /privacy policy/i.test(r.heading), 'the link opens the document it names', r.heading || r);
  ok(/who we share it with/i.test(r.text), 'with what is shared and with whom', r.text.slice(0, 80));
}

section('Terms of Service opens the Terms');
{
  const r = await press('ft-btn');
  ok(!r.missing && /terms/i.test(r.heading) && !/privacy/i.test(r.heading), 'the link opens the Terms', r.heading || r);
  ok(/payments &|payments and|refund/i.test(r.text), 'which carry the payment and refund terms', r.text.slice(0, 80));
}

section('Cookie Policy opens where cookies are explained');
{
  const r = await press('fc-btn');
  ok(!r.missing && /privacy policy/i.test(r.heading), 'the cookie link opens the Privacy Policy', r.heading || r);
  ok(/cookies/i.test(r.text) && /local storage/i.test(r.text), 'which has the section on cookies and local storage', /cookies/i.test(r.text));
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors);

report();
await app.close();
done();
