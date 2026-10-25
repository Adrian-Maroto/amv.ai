/* A SOURCE SAYS WHAT KIND OF SITE IT IS - AND ONLY WHEN ITS ADDRESS SAYS SO.

   Audit #28: a research answer lists its sources, and a person reading it
   should be able to tell a government page from a forum post at a glance.
   AMV labels each source by the kind of site it is - Official, Academic,
   Documentation, Reference, Community, News - told from its address, which
   is all it can honestly know without reading the page, and the label says
   so. Run in the real page against its own functions:

   - the address decides, and only an exact suffix counts: gov.example.com
     is not a government, notreuters.com is not Reuters;
   - an address that matches nothing gets no label, never a guess;
   - the research panel shows the label on the source and says, on hover,
     how it was decided. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ user: { name: 'Kim', email: 'kim@example.com', ini: 'K' }, tab: 'chat' });
const { page } = app;

section('The kind of site, from its address');
{
  const r = await page.evaluate(() => Object.fromEntries([
    'irs.gov', 'gov.uk', 'service-public.gouv.fr', 'canada.gc.ca', 'who.int',
    'mit.edu', 'ox.ac.uk', 'arxiv.org', 'ncbi.nlm.nih.gov',
    'docs.python.org', 'developer.mozilla.org', 'requests.readthedocs.io',
    'en.wikipedia.org',
    'reddit.com', 'old.reddit.com', 'stackoverflow.com',
    'reuters.com', 'bbc.co.uk',
    'gov.example.com', 'notreuters.com', 'reddit.com.evil.io', 'my-edu-site.com', 'example.com', '',
  ].map(h => [h, _rsKind(h)])));
  ok(['irs.gov', 'gov.uk', 'service-public.gouv.fr', 'canada.gc.ca', 'who.int'].every(h => r[h] === 'official'), 'governments and international bodies are Official', r);
  ok(['mit.edu', 'ox.ac.uk', 'arxiv.org', 'ncbi.nlm.nih.gov'].every(h => r[h] === 'academic'), 'universities and journals are Academic', r);
  ok(['docs.python.org', 'developer.mozilla.org', 'requests.readthedocs.io'].every(h => r[h] === 'docs'), 'documentation sites are Documentation', r);
  ok(r['en.wikipedia.org'] === 'reference', 'an encyclopedia is Reference', r['en.wikipedia.org']);
  ok(['reddit.com', 'old.reddit.com', 'stackoverflow.com'].every(h => r[h] === 'community'), 'forums are Community', r);
  ok(r['reuters.com'] === 'news' && r['bbc.co.uk'] === 'news', 'newsrooms are News', r);
  ok(['gov.example.com', 'notreuters.com', 'reddit.com.evil.io', 'my-edu-site.com'].every(h => r[h] === ''), 'a look-alike address gets no label - only an exact suffix counts', r);
  ok(r['example.com'] === '' && r[''] === '', 'and an ordinary site gets none, rather than a guess', r);
}

section('The research panel shows it, and says how it was decided');
{
  const html = await page.evaluate(() => {
    const st = { searches: 1, trail: [{ q: 'tax deadline', n: 3, hosts: [] }], cited: new Set(['https://www.irs.gov/filing']),
      sources: new Map([
        ['https://www.irs.gov/filing', { url: 'https://www.irs.gov/filing', title: 'When to file' }],
        ['https://old.reddit.com/r/tax/x', { url: 'https://old.reddit.com/r/tax/x', title: 'Thread' }],
        ['https://example.com/a', { url: 'https://example.com/a', title: 'A blog' }]]) };
    const d = document.createElement('div'); d.innerHTML = _buildResearchPanel(st, true);
    return [...d.querySelectorAll('.rsrc-chip')].map(a => ({ text: a.textContent, title: a.title, kind: (a.querySelector('.rsrc-kind') || {}).textContent || '' }));
  });
  const irs = html.find(c => /irs\.gov/.test(c.text)) || {}, red = html.find(c => /reddit/.test(c.text)) || {}, ex = html.find(c => /example\.com/.test(c.text)) || {};
  ok(irs.kind === 'Official' && red.kind === 'Community', 'each labelled source shows its kind', html);
  ok(ex.kind === '', 'an unlabelled one shows nothing', ex);
  ok(/by its address/.test(irs.title) && /cited in the answer/.test(irs.title), 'and on hover it says the label comes from the address, beside whether it was cited', irs.title);
}

ok(app.errors.length === 0, 'no JavaScript errors', app.errors.slice(0, 3));
await app.close();
if (report('a-source-says-what-kind-of-site-it-is') > 0) process.exitCode = 1;
done();
