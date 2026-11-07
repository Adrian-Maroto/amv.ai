/* docs/CAPABILITIES.md, WRITTEN FROM docs/capabilities.json (Oct 31 audit,
   item 73: product docs generated from the capability registry).

   The registry is the one list of what AMV can do, where each thing is built
   and which test proves it - and the gate already fails when an entry claims
   code or a test that is not there. This turns it into the page a person
   reads, so the readable list cannot drift from the checked one: build.mjs
   writes it, and the capability stage of the gate fails when the committed
   copy is not what the registry renders. Edit the registry, never the page. */
const AREA = {
  account: 'Accounts', action: 'Actions on connected accounts', agents: 'Agents', artifact: 'Documents', auth: 'Sign-in',
  browser: 'AMV’s browser', code: 'Code', computer: 'The cloud computer', data: 'Data', dev: 'Developers', health: 'Health',
  library: 'Files', market: 'Marketplace', notify: 'Notifications', office: 'Office files', ops: 'Operations', plugin: 'Plugins',
  project: 'Projects', research: 'Research', search: 'Search', surface: 'Where AMV runs', task: 'Background work', teach: 'Teaching',
  team: 'Teams', trigger: 'Triggers', voice: 'Voice',
};
const areaOf = (id) => String(id).split('.')[0];
const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/* WHAT EACH ONE NEEDS SWITCHED ON, READ FROM ITS CODE (Nov 3 audit REL-015).
   A hand-kept "needs X" column is one more sentence that drifts, so it is
   derived: the body of every function an entry names is read, and every
   setting it reads (env.NAME) is listed. Only the named code, not what it
   calls - so this is what the entry reads directly, and the readiness screen
   is where the operator sees whether each is set. The settings every request
   needs are left out; they are not what distinguishes one capability. */
const BASE_ENV = new Set(['AMV_KV', 'JWT_SECRET', 'APP_URL', 'APP_ORIGIN', 'ALLOWED_ORIGIN']);
function _bodyOf(text, symbol) {
  const re = new RegExp('(?:^|[^\\w$.])(?:async\\s+)?function\\s*\\*?\\s*' + symbol.replace(/[$]/g, '\\$') + '\\s*\\(', 'm');
  const m = re.exec(text); if (!m) return '';
  let i = text.indexOf('{', m.index + m[0].length); if (i < 0) return '';
  let d = 0; const start = i;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') { const q = ch; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } continue; }
    if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue; }
    if (ch === '{') d++; else if (ch === '}' && --d === 0) return text.slice(start, i + 1);
  }
  return '';
}
export function settingsOf(cap, read) {
  if (!read) return [];
  const names = new Set();
  for (const [file, symbol] of (cap.code || [])) {
    if (!symbol || !/\.(m?js)$/.test(file)) continue;
    let text = ''; try { text = read(file); } catch (e) { continue; }
    const body = _bodyOf(text, symbol);
    for (const [, n] of body.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})\b/g)) if (!BASE_ENV.has(n)) names.add(n);
  }
  return [...names].sort();
}

export function renderCapabilities(reg, read) {
  const caps = reg.capabilities || [];
  const built = caps.filter(c => c.status === 'built');
  const planned = caps.filter(c => c.status !== 'built');
  const areas = [...new Set(built.map(c => areaOf(c.id)))].sort((a, b) => (AREA[a] || a).localeCompare(AREA[b] || b));
  const out = [
    '# What AMV can do',
    '',
    '<!-- Generated from docs/capabilities.json by tools/capabilities-doc.mjs on every build. Edit the registry, not this page. -->',
    '',
    built.length + ' capabilities are built. Each names the code that does it and the test that proves it; the gate fails if either is missing. ' +
      'The settings column is read from that code on every build: what it reads directly, shown on the go-live screen as on or off. ' +
      planned.length + ' more are planned and listed at the end.',
    '',
  ];
  for (const a of areas) {
    out.push('## ' + (AREA[a] || a), '', '| What | Built in | Reads these settings | Proved by |', '|---|---|---|---|');
    for (const c of built.filter(x => areaOf(x.id) === a)) {
      const code = [...new Set((c.code || []).map(([f]) => '`' + f + '`'))].join(', ');
      const tests = (c.tests || []).map(t => '`' + t.replace(/^tests\//, '') + '`').join(', ');
      const set = settingsOf(c, read).map(n => '`' + n + '`').join(', ') || '-';
      out.push('| ' + esc(c.name) + ' | ' + code + ' | ' + set + ' | ' + tests + ' |');
    }
    out.push('');
  }
  if (planned.length) {
    out.push('## Planned, not built', '', '| What | Decided |', '|---|---|');
    for (const c of planned) out.push('| ' + esc(c.name) + ' | ' + esc(c.decided || (c.owner ? 'needs ' + c.owner : '')) + ' |');
    out.push('');
  }
  return out.join('\n');
}
