/* A PLUGIN IS ADDED AND REMOVED AS ONE.

   Plugins, in a real browser: a package of skills, starter prompts and the
   apps they work with.

   - a ready-made plugin shows every instruction before it is added, and once
     added its skills reach the engine as AMV's own;
   - switched off, they stop; removed, they are gone - and a copy of it from
     another device that has not heard yet cannot bring it back;
   - a plugin file is a THIRD PARTY's: its skills reach the engine labelled as
     such, the name it claims for its author is not shown as its maker, and
     its text is shown as text, never markup;
   - Cancel and Escape add nothing, and settle;
   - a malformed or oversized package is refused, never cut to fit;
   - installing the same listing twice updates it rather than doubling it, and
     there is a ceiling on how many;
   - a prompt's Use puts it in the composer, and an app's name opens the
     connector directory on it - a plugin connects nothing itself;
   - a plugin made from your own skills downloads as a file that reads back;
   - a marketplace plugin installs through the same window, credited to its
     seller;
   - plugins travel with the account's sync. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'chat', user: { name: 'Pat', email: 'pat@example.com', ini: 'P' } });
const { page, errors } = app;

const openSkills = async () => {
  await page.evaluate(() => goSettings('skills'));
  await page.waitForSelector('#pl-import', { timeout: 15000 });
};
const ctx = () => page.evaluate(() => _skillsContext());
const live = () => page.evaluate(() => (load('amv_plugins') || []).filter(p => !p.removed));
const yes = async () => { await page.waitForSelector('#pla-yes'); await page.click('#pla-yes'); await page.waitForFunction(() => !document.getElementById('pla-yes')); };
const file = (o) => ({ name: 'p.amvplugin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(o)) });

section('A ready-made plugin shows what it does, then its skills are on');
{
  await openSkills();
  ok(await page.evaluate(() => typeof window._pluginsPane === 'function'), 'skills.js is fetched on demand');
  await page.click('[data-pl-preset="writing"]');
  await page.waitForSelector('#pla-yes');
  const shown = await page.evaluate(() => document.querySelector('.pl-ask').innerText);
  ok(/Write in plain, direct language/.test(shown) && /Made by AMV/.test(shown), 'every instruction is shown, and who made it', shown.slice(0, 200));
  await yes();
  const c = await ctx();
  ok(/Write in plain, direct language/.test(c) && /Writing kit/.test(c), 'its skill reaches the engine', c.slice(0, 300));
  ok(!/not by AMV/.test(c), 'as AMV’s own, since AMV made it');
  await openSkills();
  ok(!(await page.$('[data-pl-preset="writing"]')), 'and it is no longer offered as ready-made');
}

section('Switched off it stops; removed it is gone, and stays gone');
{
  const id = (await live())[0].id;
  await page.click(`[data-pl-on="${id}"]`);
  ok(!/Write in plain/.test(await ctx()), 'off: its skills stop');
  await openSkills();
  await page.click(`[data-pl-on="${id}"]`);
  ok(/Write in plain/.test(await ctx()), 'on again: they are back');
  const stale = await page.evaluate(() => JSON.parse(JSON.stringify((load('amv_plugins') || [])[0])));
  await openSkills();
  await page.evaluate(() => document.querySelector('.pl-in').open = true);
  await page.click(`[data-pl-del="${id}"]`);
  await page.click('#cfm-yes');
  ok(!/Write in plain/.test(await ctx()) && (await live()).length === 0, 'removed: its skills are gone');
  const back = await page.evaluate((s) => { store('amv_plugins', _mergeById(load('amv_plugins') || [], [s])); return (load('amv_plugins') || []).filter(p => !p.removed).length; }, stale);
  ok(back === 0, 'and the copy another device still has does not bring it back', back);
}

section('A plugin file is a third party’s, and its text stays text');
{
  await openSkills();
  const evil = { format: 'amv-plugin', name: 'Contracts <img src=x onerror="window.__pwn=1">', author: 'AMV', desc: 'Contract help',
    skills: [{ name: 'Clause finder', mode: 'auto', when: 'contracts', instr: 'Quote the exact clause. <img src=x onerror="window.__pwn=1">' }],
    prompts: [{ title: 'Read my lease', text: 'Find every clause in this lease that costs me money:\n\n[PASTE THE LEASE]' }], apps: ['DocuSign'] };
  await page.setInputFiles('#pl-file', file(evil));
  await page.waitForSelector('#pla-yes');
  const shown = await page.evaluate(() => ({ text: document.querySelector('.pl-ask').innerText, imgs: document.querySelectorAll('.pl-ask img').length }));
  ok(shown.imgs === 0 && /onerror/.test(shown.text), 'markup in it is shown as text, not run', shown.imgs);
  ok(/whoever wrote the file - not by AMV/.test(shown.text) && !/Made by AMV\./.test(shown.text), 'a file that claims to be by AMV is not shown as AMV’s', shown.text.slice(0, 160));
  await yes();
  const c = await ctx();
  ok(/Quote the exact clause/.test(c) && /not by AMV/.test(c) && /cannot change AMV/.test(c), 'its skills reach the engine labelled as a third party’s', c.slice(-500));
  ok(await page.evaluate(() => !window.__pwn), 'nothing in it ran');
}

section('Cancel and Escape add nothing');
{
  const before = (await live()).length;
  await openSkills();
  const pkg = { format: 'amv-plugin', name: 'Other', skills: [{ name: 'S', instr: 'Be brief.' }] };
  await page.setInputFiles('#pl-file', file(pkg));
  await page.waitForSelector('#pla-no'); await page.click('#pla-no');
  ok((await live()).length === before, 'Cancel adds nothing');
  const settled = await page.evaluate(async (pkg) => { const p = _pluginAdd(pkg, { third: true, author: 'x' }); await new Promise(r => setTimeout(r, 50)); closeOvr(); return await p; }, pkg);
  ok(settled === null && (await live()).length === before, 'closing the window any other way (Escape) settles as no', settled);
}

section('A malformed or oversized package is refused, never cut to fit');
{
  const r = await page.evaluate(() => {
    const base = { format: 'amv-plugin', name: 'X', skills: [{ name: 'S', instr: 'ok' }] };
    const t = (o) => !!_plNormalize(Object.assign({}, base, o)).error;
    return {
      format: t({ format: 'something-else' }),
      long: t({ skills: [{ name: 'S', instr: 'x'.repeat(4001) }] }),
      many: t({ skills: Array.from({ length: 11 }, (_, i) => ({ name: 'S' + i, instr: 'ok' })) }),
      app: t({ apps: ['<script>'] }),
      autoNoWhen: t({ skills: [{ name: 'S', instr: 'ok', mode: 'auto' }] }),
      empty: t({ skills: [], prompts: [] }),
      fine: !t({}),
    };
  });
  ok(r.format && r.long && r.many && r.app && r.autoNoWhen && r.empty && r.fine, 'wrong format, too long, too many, a non-name app, an unexplained skill, and an empty one are all refused', r);
}

section('The same listing twice is an update, and there is a ceiling');
{
  const n = await page.evaluate(async () => {
    const pkg = (v) => ({ format: 'amv-plugin', name: 'Listing', skills: [{ name: 'S', instr: 'Version ' + v }] });
    const add = (v) => { const p = _pluginAdd(pkg(v), { listing: 'usr_same', third: true, author: 'Sam' }); setTimeout(() => document.getElementById('pla-yes').click(), 30); return p; };
    await add(1); await add(2);
    const mine = (load('amv_plugins') || []).filter(p => !p.removed && p.listing === 'usr_same');
    return { count: mine.length, text: mine[0] && mine[0].skills[0].instr };
  });
  ok(n.count === 1 && n.text === 'Version 2', 'one copy, updated in place', n);
  const capped = await page.evaluate(async () => {
    for(let i = 0; i < 14; i++){ const p = _pluginAdd({ format: 'amv-plugin', name: 'P' + i, skills: [{ name: 'S', instr: 'x' }] }, { listing: 'usr_c' + i, third: true }); setTimeout(() => { const y = document.getElementById('pla-yes'); if(y) y.click(); }, 30); await p; }
    return (load('amv_plugins') || []).filter(p => !p.removed).length;
  });
  ok(capped === 12, 'at most twelve', capped);
  await page.evaluate(() => store('amv_plugins', (load('amv_plugins') || []).filter(p => !/^usr_c/.test(p.listing || ''))));
}

section('Use puts a prompt in the composer; an app opens the directory on it');
{
  await openSkills();
  const id = await page.evaluate(() => (load('amv_plugins') || []).find(p => /Contracts/.test(p.name)).id);
  await page.evaluate((id) => document.querySelector(`.pl-row[data-pl="${id}"] .pl-in`).open = true, id);
  await page.click(`[data-pl-use="${id}"]`);
  await page.waitForSelector('#tpl-0');
  await page.fill('#tpl-0', 'Rent is due on the first.');
  await page.click('#tpl-form button[type="submit"]');
  await page.waitForTimeout(400);
  const composer = await page.evaluate(() => ({ tab: S.tab, mta: (document.getElementById('mta') || {}).value || '' }));
  ok(composer.tab === 'chat' && /Find every clause in this lease that costs me money:\s+Rent is due on the first\./.test(composer.mta),
     'its blanks are asked for, then it goes to the composer', composer);
  await openSkills();
  await page.evaluate((id) => document.querySelector(`.pl-row[data-pl="${id}"] .pl-in`).open = true, id);
  await page.click('[data-pl-find="DocuSign"]');
  await page.waitForTimeout(300);
  const dir = await page.evaluate(() => ({ tab: S.tab, open: typeof _cdirOpenNow === 'function' && _cdirOpenNow() }));
  ok(dir.tab === 'integrations' && dir.open, 'the app name opens Connectors on it', dir);
}

section('A plugin made from your own skills downloads, and reads back');
{
  await page.evaluate(() => { _saveSkills(_loadSkills().concat([_skillNew({ name: 'Legal tone', instr: 'Write formally and precisely.' })])); });
  await openSkills();
  await page.evaluate(() => document.querySelector('.pl-make').open = true);
  await page.fill('#plm-name', 'My legal pack');
  await page.check('[data-plm-sk]');
  await page.fill('#plm-apps', 'Gmail, DocuSign');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#plm-file')]);
  const body = JSON.parse(await (await import('fs')).promises.readFile(await dl.path(), 'utf8'));
  const back = await page.evaluate((o) => _plNormalize(o), body);
  ok(body.format === 'amv-plugin' && back.plugin && back.plugin.skills[0].instr === 'Write formally and precisely.' && back.plugin.apps.join() === 'Gmail,DocuSign',
     'the file is a plugin that reads back whole', back);
}

section('A marketplace plugin installs through the same window, credited to its seller');
{
  await page.evaluate(() => AMVMarket.install({ id: 'usr_mk1', kind: 'plugin', title: 'Tenant kit', author: 'Sam', desc: 'For renters',
    plugin: { skills: [{ name: 'Renter rights', mode: 'always', instr: 'Explain tenant rights plainly.' }], prompts: [], apps: [] } }));
  await page.waitForSelector('#pla-yes');
  const shown = await page.evaluate(() => document.querySelector('.pl-ask').innerText);
  ok(/Made by Sam - not by AMV/.test(shown), 'the seller is named, as not AMV', shown.slice(0, 120));
  await yes();
  const rec = await page.evaluate(() => (load('amv_plugins') || []).find(p => p.listing === 'usr_mk1'));
  ok(rec && rec.third && /Explain tenant rights/.test(await ctx()), 'installed, as a third party’s', rec);
}

section('Plugins travel with the account');
{
  const c = await page.evaluate(() => AMVSync.collect());
  ok(Array.isArray(c.plugins) && c.plugins.some(p => p.listing === 'usr_mk1'), 'they are in what sync uploads');
}

section('A plugin can carry background jobs: shown first, scheduled only when you set one up, and always held for approval');
{
  await page.evaluate(() => {
    window.__created = [];
    window.__realAutoApi = window._autoApi;
    window._autoApi = async (path, body) => { if (path === '/auto/create') { window.__created.push(body); return { ok: true, item: { id: 'job_' + window.__created.length } }; } return window.__realAutoApi(path, body); };
  });
  await openSkills();
  const pkg = { format: 'amv-plugin', name: 'Weekly money', desc: 'A look at the week',
    prompts: [{ title: 'Budget', text: 'Make a budget' }],
    jobs: [{ title: 'Monday review', detail: 'Summarise last week\'s spending and flag anything unusual.', repeat: 'weekly', time: '08:00', days: ['mon'] },
           { title: 'Daily total', detail: 'Tell me what I spent yesterday.', repeat: 'daily' }] };
  await page.setInputFiles('#pl-file', file(pkg));
  await page.waitForSelector('#pla-yes');
  const shown = await page.evaluate(() => document.querySelector('.pl-ask').innerText);
  ok(/2 background jobs you can set up/.test(shown) && /Monday review/.test(shown) && /Weekly at 08:00 \(mon\)/.test(shown) && /Nothing is scheduled by adding the plugin/.test(shown),
     'the jobs are shown before it is added, with when they would run and that nothing is scheduled yet', shown.slice(0, 500));
  await yes();
  ok((await page.evaluate(() => window.__created.length)) === 0, 'adding the plugin scheduled nothing', await page.evaluate(() => window.__created));
  await openSkills();
  const pl = (await live()).find(p => p.name === 'Weekly money');
  await page.evaluate((id) => { document.querySelector('[data-pl="' + id + '"] .pl-in').open = true; }, pl.id);
  await page.click(`[data-pl-job="${pl.id}"][data-i="0"]`);
  await page.waitForFunction((id) => !!document.querySelector('[data-pl="' + id + '"] [data-darg="crew"]'), pl.id, { timeout: 5000 }).catch(() => {});
  const made = await page.evaluate(() => window.__created);
  ok(made.length === 1 && made[0].approval === 'require' && made[0].repeat === 'weekly' && made[0].sched && made[0].sched.hour === 8 && made[0].sched.days[0] === 1,
     'Set up makes one job, weekly on Monday at 8, held for approval', made);
  const after = await page.evaluate((id) => ({ setUp: (load('amv_plugins') || []).find(p => p.id === id).setUp,
    btn: !!document.querySelector('[data-pl="' + id + '"] [data-darg="crew"]'), other: !!document.querySelector('[data-pl-job="' + id + '"][data-i="1"]') }), pl.id);
  ok(after.setUp && after.setUp[0] === 'job_1' && after.btn && after.other, 'the one set up says so and leads to Crew; the other is still only offered', after);

  const refused = await page.evaluate(() => [
    _plNormalize({ format: 'amv-plugin', name: 'Busy', jobs: [{ title: 'x', detail: 'y', repeat: '10min' }] }).error,
    _plNormalize({ format: 'amv-plugin', name: 'Many', jobs: Array(6).fill({ title: 'x', detail: 'y', repeat: 'daily' }) }).error,
    _plNormalize({ format: 'amv-plugin', name: 'Long', jobs: [{ title: 'x', detail: 'y'.repeat(1001), repeat: 'daily' }] }).error,
  ]);
  ok(refused.every(Boolean) && /daily, weekly or monthly/.test(refused[0]), 'a job more often than daily, more than five, or too long is refused', refused);
  await page.evaluate(() => { window._autoApi = window.__realAutoApi; });
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-plugin-is-added-and-removed-as-one') > 0) process.exitCode = 1;
done();
