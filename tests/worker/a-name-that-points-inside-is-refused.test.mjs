/* A NAME THAT POINTS INSIDE IS REFUSED (Nov 8 audit CONN-034).

   The outbound gate read the address as written, so a public-looking name
   whose DNS answer was a private or metadata address passed it. Every hop's
   name is now looked up and refused when any answer is private, loopback,
   link-local or metadata - including after a redirect. */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
mkdirSync(join(__dir, '.build'), { recursive: true });
const harness = join(__dir, '.build', 'dnsgate.' + process.pid + '.harness.mjs');
writeFileSync(harness, readFileSync(join(ROOT, 'amv-backend.js'), 'utf8') + '\nexport { fetchGuarded };\n');
const W = await import(harness + '?t=' + Date.now());
const quiet = console.log; console.log = (...a) => { if (String(a[0]).startsWith('AUDIT')) return; quiet(...a); };

const DNS = {
  'inside.example.com': { A: ['169.254.169.254'] },
  'lan.example.com': { A: ['10.0.0.5'] },
  'v6.example.com': { AAAA: ['::1'] },
  'mapped.example.com': { AAAA: ['::ffff:127.0.0.1'] },
  'public.example.com': { A: ['93.184.216.34'], AAAA: ['2606:2800:220:1:248:1893:25c8:1946'] },
  'hop.example.com': { A: ['93.184.216.35'] },
};
let dnsDown = false; const reached = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.hostname === 'cloudflare-dns.com') {
    if (dnsDown) throw new Error('dns unreachable');
    const name = u.searchParams.get('name'), type = u.searchParams.get('type');
    const ans = ((DNS[name] || {})[type] || []).map(data => ({ type: type === 'A' ? 1 : 28, data }));
    return new Response(JSON.stringify({ Status: 0, Answer: ans }), { status: 200 });
  }
  reached.push(u.hostname);
  if (u.hostname === 'hop.example.com') return new Response('', { status: 302, headers: { location: 'https://inside.example.com/latest/meta-data/' } });
  return new Response('ok', { status: 200 });
};

section('A name that resolves to a private or metadata address is not fetched');
for (const host of ['inside.example.com', 'lan.example.com', 'v6.example.com', 'mapped.example.com']) {
  const g = await W.fetchGuarded('https://' + host + '/x', {}, 3000);
  ok(g.blocked && !reached.includes(host), host + ' is refused before anything is sent to it', g);
}

section('A public name is fetched as before');
{
  const g = await W.fetchGuarded('https://public.example.com/x', {}, 3000);
  ok(!g.blocked && g.response && g.response.status === 200, 'a name with only public answers goes through', g.why);
}

section('A redirect to a name that points inside is refused at that hop');
{
  const g = await W.fetchGuarded('https://hop.example.com/', {}, 3000);
  ok(g.blocked && g.hop === 1 && !reached.includes('inside.example.com'), 'the second hop is looked up and refused', g);
}

section('A lookup that cannot be made does not stop an ordinary request');
{
  dnsDown = true;
  const g = await W.fetchGuarded('https://unlisted.example.org/x', {}, 3000);
  ok(!g.blocked, 'the request goes ahead, bounded by the Worker’s own egress', g.why);
  dnsDown = false;
}

console.log = quiet;
report();
done();
