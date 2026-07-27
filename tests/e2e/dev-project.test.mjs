/* DEV PROJECTS — multi-file builds, named after the project, reachable from
   chat. Proves: a build produces a real file tree (not one blob), files carry
   the project's name, and chat/Crew can pull the ACTUAL files back rather than
   regenerating a guess. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'dev' });
const { page, errors } = app;

const r = await page.evaluate(async () => {
  // reset, then simulate what a multi-file AI build writes
  try { localStorage.removeItem('amv_dev_name'); } catch (e) {}
  _DEV.name = ''; _DEV.project = {}; _DEV.activePath = '';
  _devDeriveName('build me a portfolio site for a photographer');
  _devSetFile('index.html', '<h1>Hi</h1>');
  _devSetFile('styles/main.css', 'body{}');
  _devSetFile('scripts/app.js', 'console.log(1)');
  _devSetFile('README.md', '# docs');
  if (typeof _devRenderTree === 'function') _devRenderTree();

  const C = window.AMVConnectors;
  const info = await C.run('dev.project_info', {});
  const all = await C.run('dev.get_all_files', {});
  const one = await C.run('dev.get_file', { path: 'index.html' });
  let wrongProject = null, missingFile = null;
  try { await C.run('dev.list_files', { project: 'totally-different-app' }); } catch (e) { wrongProject = e.code; }
  try { await C.run('dev.get_file', { path: 'nope.js' }); } catch (e) { missingFile = e.code; }

  return {
    name: _devProjectName(), files: _devProjectFiles(),
    info, all, one, wrongProject, missingFile,
    treeHeader: (document.querySelector('.dev-tree-h') || {}).textContent || '',
    devInCatalog: C.catalog().filter(a => a.connector === 'dev').map(a => a.id)
  };
});

section('A build is a real multi-file project, not one blob');
ok(r.files.length === 4, 'the project holds several files', r.files);
ok(r.files.includes('index.html') && r.files.includes('styles/main.css') && r.files.includes('scripts/app.js'),
  'with conventional paths (markup / styles / scripts)', r.files);

section('Files are named after the project');
ok(r.name === 'portfolio-site-photographer', 'the project is auto-named from the build request', r.name);
ok(/portfolio-site-photographer/.test(r.treeHeader), 'the file tree shows the project name', r.treeHeader);
ok(/4 files/.test(r.treeHeader), 'and the file count', r.treeHeader);

section('Chat and Crew can pull the real files (the Dev bridge)');
ok(r.devInCatalog.length >= 4, 'Dev is registered as a connector with real actions', r.devInCatalog);
ok(r.info.project === 'portfolio-site-photographer' && r.info.fileCount === 4, 'project_info returns the live project', r.info);
ok(r.all.count === 4 && Array.isArray(r.all.files), '"give me all my files" returns every file', r.all.count);
ok(r.all.files.every(f => typeof f.content === 'string'), 'each file comes back with its ACTUAL contents');
ok(r.one.path === 'index.html' && r.one.content === '<h1>Hi</h1>', 'a single file can be read exactly', r.one);

section('It never fabricates a project or a file it does not have');
ok(r.wrongProject === 'needs_info', 'asking for a different project says so instead of inventing one', r.wrongProject);
ok(r.missingFile === 'needs_info', 'asking for a missing file is reported, not hallucinated', r.missingFile);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
