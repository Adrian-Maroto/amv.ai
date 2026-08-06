/*
 * AMV build - assembles the single-file index.html from app.js + styles.css.
 *
 *   node build.mjs          # rebuild index.html
 *   node build.mjs check    # syntax-check app.js and the assembled JS only
 *
 * Performance: the main script is injected between the BUILD:JS markers as a
 * NON-render-blocking deferred script. The JS body is placed in a
 * <script type="text/plain"> (the browser does NOT parse/execute inert text),
 * then a tiny bootstrap turns it into a deferred Blob-URL <script>. This lets
 * the static landing HTML + CSS paint immediately (fast first paint) while the
 * ~790KB app parses in the background - without breaking the single-file app
 * (still one index.html, no external requests, global scope + strict mode
 * preserved, DOM fully available when the code runs).
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const cmd = args.find(a => !a.startsWith('--')) || 'build';
/* Minified by DEFAULT. index.html is the artifact users download - 2.3MB
   plain, 1.8MB minified, 690KB vs 516KB over the wire - and app.js is written
   unminified beside it either way, which is what check, preflight and grep
   read. So the readable copy is kept where it is actually used, and the copy
   that crosses the network is the small one. --no-minify opts out. */
const MINIFY = !args.includes('--no-minify');

// The app SOURCE is modular: src/app/NN-name.js files, concatenated in name
// order, form the single app bundle. app.js is the GENERATED concatenation of
// those modules - it stays committed so check.mjs / preflight / grep keep
// working unchanged. IMPORTANT: do NOT hand-edit app.js; edit the src/app/
// modules and rebuild (the build overwrites app.js from them).
const APP_SRC_DIR = 'src/app';
function assembleJS() {
  const files = readdirSync(APP_SRC_DIR).filter(f => /\.js$/.test(f)).sort();
  if (!files.length) throw new Error(`no source modules found in ${APP_SRC_DIR}/`);
  const src = files.map(f => readFileSync(`${APP_SRC_DIR}/${f}`, 'utf8')).join('');
  writeFileSync('app.js', src);   // regenerate the committed bundle from the modules
  return src;
}

// Optionally minify with terser. Kept opt-in (--minify) so the default build
// stays readable/debuggable; a production build can ship the smaller bundle.
// The minified code is always syntax-validated before use, and the build
// refuses to ship if terser errors.
async function minifyJS(code) {
  const { minify } = await import('terser');
  const result = await minify(code, {
    ecma: 2020,
    compress: { passes: 2, drop_debugger: true },
    mangle: { keep_fnames: false },
    format: { comments: false },
    // Keep top-level names reachable: the app relies on many globals being
    // referenced by name across the single script (and from the deferred blob).
    toplevel: false,
  });
  if (result.error) throw result.error;
  if (!result.code) throw new Error('terser produced no output');
  return result.code;
}

function validate(js) {
  writeFileSync('/tmp/_amv_check.js', js);
  execSync('node --check /tmp/_amv_check.js', { stdio: 'pipe' });
}

async function rebuild() {
  let html = readFileSync('index.html', 'utf8');
  const source = assembleJS();
  const css = readFileSync('styles.css', 'utf8');

  // 1) validate the source JS before doing anything - never ship a broken build
  validate(source);

  // Optionally minify. The minified code must still parse; validate it too.
  let app = source;
  if (MINIFY) {
    app = await minifyJS(source);
    validate(app);
    console.log(`Minified: ${(source.length/1024).toFixed(0)}KB -> ${(app.length/1024).toFixed(0)}KB`);
  }

  // 2) CSS between markers
  const cssPat = /(<!-- BUILD:CSS:START -->\s*<style>)([\s\S]*?)(<\/style>\s*<!-- BUILD:CSS:END -->)/;
  if (!cssPat.test(html)) throw new Error('CSS build markers not found');
  // NOTE: use a replacer FUNCTION (not a string) so `$` sequences in the CSS
  // are inserted literally and never interpreted as replacement patterns.
  html = html.replace(cssPat, (m, a, _b, c) => a + '\n' + css + '\n' + c);

  // 3) JS between markers - deferred, non-render-blocking pattern.
  //    The app code goes in an inert <script type="text/plain"> and a tiny
  //    launcher converts it to a deferred Blob script so it never blocks paint.
  //    Defensive: escape any literal </script that would otherwise terminate the
  //    text/plain block early; the launcher restores it before execution. This
  //    keeps the build correct even if future code embeds a literal script tag.
  const SCRIPT_SENTINEL = '<\\/scr_AMV_ipt';
  const appSafe = app.replace(/<\/script/gi, SCRIPT_SENTINEL);
  const launcher =
    "(function(){var c=document.getElementById('amv-app-code');if(!c)return;" +
    "var code=c.textContent.split('<\\\\/scr_AMV_ipt').join('</script');" +
    "function inlineRun(){var e=document.createElement('script');e.textContent=code;document.body.appendChild(e);}" +
    "try{var s=document.createElement('script');" +
    "s.src=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));" +
    "s.defer=true;s.onerror=inlineRun;document.body.appendChild(s);}" +
    "catch(e){inlineRun();}})();";

  const jsPat = /(<!-- BUILD:JS:START -->)[\s\S]*?(<!-- BUILD:JS:END -->)/;
  if (!jsPat.test(html)) throw new Error('JS build markers not found');
  const jsBlock =
    '<!-- BUILD:JS:START -->\n' +
    '<script id="amv-app-code" type="text/plain">\n' + appSafe + '\n</script>\n' +
    '<script>' + launcher + '</script>\n' +
    '<!-- BUILD:JS:END -->';
  // Replacer FUNCTION so `$` / `$'` / `$&` sequences inside the app code are
  // inserted verbatim (a replacement STRING would corrupt them).
  html = html.replace(jsPat, () => jsBlock);

  /* THE BACKEND ADDRESS THE SHIPPED ARTIFACT TALKS TO.

     Without this the app reads amv_api_base from localStorage and finds
     nothing, so every visitor who is not the owner gets the local demo: no
     engine, no server account, and no way to pay. Pass it at build time -

         AMV_API_BASE=https://amv-backend.you.workers.dev node build.mjs

     - or write it straight into the meta tag in index.html. An https origin
     only, because the token is bound to the origin that issued it and the app
     refuses to attach it to anything else. */
  const apiBase = (process.env.AMV_API_BASE || '').trim().replace(/\/+$/, '');
  if (apiBase) {
    if (!/^https:\/\/[^\s"'<>]+$/.test(apiBase)) {
      throw new Error('AMV_API_BASE must be an https:// URL - got: ' + apiBase);
    }
    const metaPat = /<meta name="amv-api-base" content="[^"]*"><!-- BUILD:APIBASE -->/;
    if (!metaPat.test(html)) throw new Error('amv-api-base meta marker not found');
    html = html.replace(metaPat,
      () => '<meta name="amv-api-base" content="' + apiBase + '"><!-- BUILD:APIBASE -->');
    console.log('Backend baked in: ' + apiBase);
  }

  // 4) validate the assembled code BEFORE writing - a broken build must never
  //    overwrite a working index.html. Extract the emitted code, un-escape the
  //    sentinel, and syntax-check it. Only write if it passes.
  const m = html.match(/<script id="amv-app-code" type="text\/plain">\n([\s\S]*?)\n<\/script>/);
  if (!m) throw new Error('assembled app code block not found - aborting write');
  validate(m[1].split(SCRIPT_SENTINEL).join('</script'));

  // Sanity: the embedded code must exactly equal what we intended to embed
  // (the source, or its minified form) - guards against replacement corruption.
  if (m[1].split(SCRIPT_SENTINEL).join('</script') !== app) {
    throw new Error('assembled code does not match intended bundle - aborting write');
  }

  writeFileSync('index.html', html);
  console.log(`Built index.html - deferred non-blocking script${MINIFY ? ', minified' : ''}, validated OK.`);
}

if (cmd === 'check') {
  validate(assembleJS());
  console.log('app.js syntax OK');
} else {
  rebuild().catch(err => { console.error('BUILD FAILED:', err.message); process.exit(1); });
}
