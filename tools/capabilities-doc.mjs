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

export function renderCapabilities(reg) {
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
      planned.length + ' more are planned and listed at the end.',
    '',
  ];
  for (const a of areas) {
    out.push('## ' + (AREA[a] || a), '', '| What | Built in | Proved by |', '|---|---|---|');
    for (const c of built.filter(x => areaOf(x.id) === a)) {
      const code = [...new Set((c.code || []).map(([f]) => '`' + f + '`'))].join(', ');
      const tests = (c.tests || []).map(t => '`' + t.replace(/^tests\//, '') + '`').join(', ');
      out.push('| ' + esc(c.name) + ' | ' + code + ' | ' + tests + ' |');
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
