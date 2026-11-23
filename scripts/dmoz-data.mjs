#!/usr/bin/env node
/* SERVICES BY CATEGORY FROM THE OPEN DIRECTORY (DMOZ), FOR THE THIN TOPICS
   (Nov 23).

   The owner: "integrations need 200 for all sections, all countries, backed
   on popularity". Wikidata files too few help desks, payroll services,
   monitoring tools, workflow tools, legal databases, test tools, calendars,
   mail providers and food services for those topics to reach it. The Open
   Directory Project (DMOZ, 1998-2017, continued as Curlie) is the largest
   web directory edited by people - every site placed in a category by an
   editor who looked at it - and its final public dump (CC BY 3.0) is the
   standard category source in web-classification research. This reads that
   dump and keeps, per topic, the sites filed under the topic's categories.

   A directory says what a site IS, not whether anybody still uses it, so
   nothing from here is shown unless the site is in the Chrome UX Report
   (scripts/global-reach.mjs measures these hosts too) - categorised by
   people, kept by use. Each entry keeps its category path.

   Run where archive.org is reachable (the dmoz-data workflow does it):
     node scripts/dmoz-data.mjs [topic ...]
   Writes data/dmoz/<topic>.json: { topic, source, generated, items: [{ n, s, p }] } */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import { createInterface } from 'readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'dmoz');
const UA = 'AMV-dmoz-data/1.0 (public-data builder; contact via the project repository)';

/* Category paths per topic, matched against the English tree (Top/... but
   not Top/World, Top/Regional, Top/Adult or Top/Kids_and_Teens). A path
   must start with one of `in` and contain one of `has`. */
export const DMOZ = {
  email:    { in: ['Top/Computers/Internet/E-mail', 'Top/Computers/Software/Internet/Clients/Mail', 'Top/Computers/Internet/Email'], has: [''] },
  calendar: { in: ['Top/Computers/Software', 'Top/Computers/Internet/On_the_Web', 'Top/Business/Business_Services', 'Top/Computers/Internet'], has: ['/Calendar', '/Scheduling', '/Time_Tracking', '/Time_Management', '/Appointment', '/Personal_Information_Manag'] },
  food:     { in: ['Top/Home/Cooking', 'Top/Shopping/Food', 'Top/Business/Food_and_Related_Products'], has: ['/Recipe_Collections', '/Delivery', '/Grocer', '/Meal_Kit', '/Online_Ordering', '/Recipe'] },
  support:  { in: ['Top/Computers/Software', 'Top/Business/Customer_Service', 'Top/Business/Business_Services', 'Top/Computers/Internet'], has: ['/Help_Desk', '/Customer_Service', '/Customer_Support', '/Live_Chat', '/Customer_Relationship_Management', '/Knowledge_Management', '/Call_Cent'] },
  auto:     { in: ['Top/Computers/Software', 'Top/Business/Business_Services', 'Top/Computers/Internet'], has: ['/Workflow', '/Business_Process', '/Process_Automation', '/Robotic_Process', '/Web_Scraping', '/Integration', '/Rapid_Application_Development'] },
  monitor:  { in: ['Top/Computers/Software', 'Top/Computers/Internet', 'Top/Computers/Hardware', 'Top/Computers/Systems'], has: ['/Monitoring', '/Network_Management', '/Systems_Management', '/Log_Analysis', '/Uptime', '/Performance'] },
  legal:    { in: ['Top/Society/Law/Legal_Information', 'Top/Computers/Software', 'Top/Society/Law/Services', 'Top/Business/Business_Services'], has: ['', '/Legal', '/Law', '/Contract', '/Signature', '/Document_Assembly'] },
  hr:       { in: ['Top/Computers/Software', 'Top/Business/Human_Resources', 'Top/Business/Employment'], has: ['', '/Human_Resources', '/Payroll', '/Recruit', '/Staffing', '/Time_and_Attendance', '/Applicant_Tracking'] },
  testing:  { in: ['Top/Computers/Software', 'Top/Computers/Programming', 'Top/Computers/Internet/Web_Design_and_Development'], has: ['/Testing', '/Quality_Assurance', '/Test_Automation', '/Unit_Testing', '/Load_Testing', '/Validators'] },
  marketing:{ in: ['Top/Computers/Software', 'Top/Business/Marketing_and_Advertising', 'Top/Computers/Internet'], has: ['/Email_Marketing', '/Search_Engine_Optimization', '/Affiliate', '/Marketing_Software', '/Online_Advertising', '/Web_Analytics', '/Social_Media'] },
};
const NEVER = /^Top\/(World|Regional|Adult|Kids_and_Teens)\//;

/* The final dump on archive.org: found by search, so a renamed item does not
   break the run, and refused unless it really is the DMOZ content file. */
async function dumpUrl() {
  if (process.env.DMOZ_URL) return process.env.DMOZ_URL;
  const s = await (await fetch('https://archive.org/advancedsearch.php?q=' + encodeURIComponent('dmoz AND (rdf OR "content.rdf")') + '&fl[]=identifier&rows=50&output=json', { headers: { 'User-Agent': UA } })).json();
  for (const d of (s.response && s.response.docs) || []) {
    const m = await (await fetch('https://archive.org/metadata/' + encodeURIComponent(d.identifier), { headers: { 'User-Agent': UA } })).json().catch(() => null);
    const f = m && (m.files || []).find(x => /(^|\/)content\.rdf\.u8\.gz$/.test(x.name) && +x.size > 100e6);
    if (f) { console.log('dump:', d.identifier, f.name, f.size); return 'https://archive.org/download/' + d.identifier + '/' + f.name.split('/').map(encodeURIComponent).join('/'); }
  }
  throw new Error('no DMOZ content dump found on archive.org');
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2).filter(t => DMOZ[t]);
  const topics = only.length ? only : Object.keys(DMOZ);
  const url = await dumpUrl();
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('dump ' + r.status);
  const lines = createInterface({ input: Readable.fromWeb(r.body).pipe(createGunzip()), crlfDelay: Infinity });
  const got = Object.fromEntries(topics.map(t => [t, new Map()]));
  let page = null, n = 0;
  const unent = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;|&gt;/g, '');
  for await (const line of lines) {
    let m;
    if ((m = line.match(/<ExternalPage about="([^"]+)"/))) { page = { url: unent(m[1]) }; continue; }
    if (!page) continue;
    if ((m = line.match(/<d:Title>(.*)<\/d:Title>/))) page.title = unent(m[1]).trim();
    else if ((m = line.match(/<topic>(.*)<\/topic>/))) page.topic = m[1];
    else if (/<\/ExternalPage>/.test(line)) {
      n++;
      const p = page.topic || '';
      if (p && !NEVER.test(p)) for (const t of topics) {
        const rule = DMOZ[t];
        if (!rule.in.some(pre => p === pre || p.startsWith(pre + '/'))) continue;
        if (!rule.has.some(h => h === '' ? true : p.includes(h))) continue;
        let host = ''; try { const u = new URL(page.url); if (!/^https?:$/.test(u.protocol) || (u.pathname && u.pathname !== '/')) break; host = u.hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { break; }
        const name = String(page.title || '').replace(/\s+/g, ' ').trim();
        if (!host || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host) || name.length < 2 || name.length > 90) break;
        if (/[\u0000-\u001f\u007f<>{}\[\]`]|https?:|www\./i.test(name)) break;
        if (!got[t].has(host)) got[t].set(host, { n: name, s: host, p: p.replace(/^Top\//, '') });
        break;
      }
      page = null;
    }
  }
  console.log('pages read:', n);
  const generated = new Date().toISOString().slice(0, 10);
  for (const t of topics) {
    const items = [...got[t].values()];
    writeFileSync(join(OUT, t + '.json'), JSON.stringify({ topic: t, source: 'DMOZ Open Directory Project, final dump (CC BY 3.0), via archive.org', generated, items }));
    console.log('topic', t, items.length);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
