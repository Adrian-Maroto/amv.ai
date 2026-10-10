/* A SKILL CAN BE EDITED, KEEPS ITS HISTORY, AND TRAVELS AS A FILE.

   Skills were a name and one instruction that could only be created or
   deleted. Now: edit with every previous version kept, restore any of them
   (as a new version - nothing is lost), "always on" or "only when relevant",
   and export/import as a package. Import shows the full text before adding,
   because a skill's words go into AMV's instructions; a file that is not a
   skill, or is too long, is refused by name.

   Asserted on the Settings screen a person uses and on the system prompt a
   chat sends. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';
import { readFileSync } from 'fs';

const app = await bootApp({ tab: 'chat', user: { name: 'Kai', email: 'kai@example.com', ini: 'K' } });
const { page, errors } = app;
await page.evaluate(() => {
  localStorage.setItem('amv_cookie_consent', JSON.stringify({ essential: true }));
  document.getElementById('cookie-consent-banner')?.remove();
  window.__toasts = [];
  const real = window.toast; window.toast = (m, k, ms) => { window.__toasts.push((k || '') + ' | ' + m); return real(m, k, ms); };
});
const openSkills = async () => { await page.evaluate(() => goSettings('skills')); await page.waitForSelector('#sk-add', { timeout: 8000 }); };
const skills = () => page.evaluate(() => _loadSkills());

section('Create a skill');
{
  await openSkills();
  await page.fill('#sk-name', 'Legal tone');
  await page.fill('#sk-instr', 'Write formally and cite the clause you rely on.');
  await page.click('#sk-add');
  const s = await skills();
  ok(s.length === 1 && s[0].v === 1 && s[0].mode === 'always' && s[0].updated > 0, 'it is saved as version 1, always on', s[0]);
  await page.waitForSelector('[data-sktoggle]');
  await page.evaluate((id) => { const cb = document.querySelector('[data-sktoggle="' + id + '"]'); cb.checked = true; cb.dispatchEvent(new Event('change')); }, s[0].id);
  const ctx = await page.evaluate(() => _skillsContext());
  ok(/\[Active skills\]\n- Write formally and cite the clause/.test(ctx), 'switched on, it is in what chat is told', ctx);
}

section('Edit it: a new version, the old one kept');
{
  const id = (await skills())[0].id;
  await page.click(`[data-skedit="${id}"]`);
  ok(/v1/.test(await page.evaluate(() => document.querySelector('.skill-form-h').textContent)), 'the form says which version is being edited');
  await page.fill('#sk-instr', 'Write formally, cite the clause, and flag any deadline in bold.');
  await page.click('#sk-add');
  let s = (await skills())[0];
  ok(s.v === 2 && s.history.length === 1 && s.history[0].v === 1 && /cite the clause you rely on/.test(s.history[0].instr), 'version 2, with version 1 in its history', s);
  ok(/flag any deadline/.test(await page.evaluate(() => _skillsContext())), 'and chat follows the new text');
  await page.click(`[data-skedit="${id}"]`);
  await page.click('#sk-add');
  s = (await skills())[0];
  ok(s.v === 2, 'saving without a change does not make an empty version', s.v);
}

section('History: restoring an old version is itself a new version');
{
  const id = (await skills())[0].id;
  await page.click(`[data-skhist="${id}"]`);
  await page.waitForSelector('[data-skrestore="0"]');
  ok(/cite the clause you rely on/.test(await page.evaluate(() => document.querySelector('.skill-hist-t').textContent)), 'the history shows what version 1 said');
  await page.click('[data-skrestore="0"]');
  const s = (await skills())[0];
  ok(s.v === 3 && /cite the clause you rely on\.$/.test(s.instr) && s.history.length === 2 && /deadline/.test(s.history[0].instr), 'restored as version 3; version 2 is still in the history', { v: s.v, h: s.history.map(h => h.v) });
}

section('"Only when relevant" tells AMV what the skill is for');
{
  const id = (await skills())[0].id;
  await page.click(`[data-skedit="${id}"]`);
  await page.check('input[name="sk-mode"][value="auto"]');
  await page.fill('#sk-when', '');
  await page.click('#sk-add');
  ok((await page.evaluate(() => window.__toasts.slice(-1)[0])).includes('Say what the skill is for'), 'without a purpose it is refused, with the reason');
  await page.fill('#sk-when', 'contracts and formal letters');
  await page.click('#sk-add');
  const ctx = await page.evaluate(() => _skillsContext());
  ok(!/\[Active skills\]/.test(ctx) && /only when the request matches[\s\S]*"Legal tone" - use when: contracts and formal letters/.test(ctx), 'it is offered with its purpose, not imposed on every answer', ctx);
}

section('Export, then import the same package');
{
  const id = (await skills())[0].id;
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-skexp="${id}"]`)]);
  const pkg = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  ok(dl.suggestedFilename() === 'Legal-tone.amvskill.json' && pkg.format === 'amv-skill' && pkg.v === 4 && pkg.history.length === 3 && pkg.mode === 'auto', 'a package with its text, mode and history', { name: dl.suggestedFilename(), v: pkg.v });
  await page.setInputFiles('#sk-file', { name: 'legal.amvskill.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...pkg, name: 'Legal tone (shared)' })) });
  await page.waitForSelector('#cfm-yes');
  const shown = await page.evaluate(() => document.querySelector('#ovr .ob-sub').textContent);
  ok(/Legal tone \(shared\)/.test(shown) && /cite the clause you rely on/.test(shown), 'before anything is added, its full text is shown', shown.slice(0, 120));
  await page.click('#cfm-yes');
  await page.waitForSelector('#sk-add');
  const s = await skills();
  const imp = s.find(x => x.name === 'Legal tone (shared)');
  ok(s.length === 2 && imp && imp.v === 4 && imp.history.length === 3 && imp.id !== id, 'it arrives as a separate skill with its history, and Settings is back on Skills', imp);
  ok(!(await page.evaluate((id) => _activeSkillIds().includes(id), imp.id)), 'and is not switched on until the person chooses');
}

section('Import refuses what is not a skill, and declining adds nothing');
{
  const before = (await skills()).length;
  await page.setInputFiles('#sk-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => window.__toasts.slice(-1)[0])).includes('not a skill package'), 'an unrelated file is refused by name');
  await page.setInputFiles('#sk-file', { name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'amv-skill', name: 'Huge', instr: 'x'.repeat(5000) })) });
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => window.__toasts.slice(-1)[0])).includes('longer than AMV accepts'), 'one longer than the limit is refused with the limit');
  await page.setInputFiles('#sk-file', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'amv-skill', name: 'Pirate', instr: 'Talk like a pirate.' })) });
  await page.waitForSelector('#cfm-no');
  await page.click('#cfm-no');
  await page.waitForSelector('#sk-add');
  ok((await skills()).length === before, 'Cancel adds nothing');
}

section('Delete asks, and takes the history with it');
{
  const id = (await skills())[0].id;
  await page.click(`[data-skdel="${id}"]`);
  await page.waitForSelector('#cfm-yes');
  await page.click('#cfm-yes');
  await page.waitForSelector('#sk-add');
  const s = await skills();
  ok(!s.some(x => x.id === id) && !(await page.evaluate((id) => _activeSkillIds().includes(id), id)), 'gone, and no longer active');
}

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close?.();
if (report('a-skill-keeps-its-history') > 0) process.exitCode = 1;
done();
