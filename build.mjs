/*
 * AMV build script.
 * Inlines app.js (JS) and styles.css (CSS) into index.html.
 *
 * Usage:
 *   node build.mjs          # rebuild index.html from app.js + styles.css
 *   node build.mjs check    # syntax-check app.js and the inlined JS
 *
 * Your app is a single self-contained index.html. Edit app.js and/or
 * styles.css, then run this to regenerate index.html.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const cmd = process.argv[2] || 'build';

function rebuild() {
  let html = readFileSync('index.html', 'utf8');
  const app = readFileSync('app.js', 'utf8');
  const css = readFileSync('styles.css', 'utf8');

  // 1) Replace the largest <script>...</script> block with current app.js
  const scriptRe = /<script>([\s\S]*?)<\/script>/g;
  let m, biggest = null;
  while ((m = scriptRe.exec(html)) !== null) {
    if (!biggest || m[1].length > biggest[1].length) biggest = m;
  }
  if (!biggest) throw new Error('No inline <script> block found in index.html');
  html = html.slice(0, biggest.index) + '<script>\n' + app + '\n</script>' + html.slice(biggest.index + biggest[0].length);

  // 2) Replace the LAST <style>...</style> block's contents with styles.css
  //    (the last style block is the authoritative one)
  const styleRe = /<style>([\s\S]*?)<\/style>/g;
  let s, lastStyle = null;
  while ((s = styleRe.exec(html)) !== null) lastStyle = s;
  if (lastStyle) {
    html = html.slice(0, lastStyle.index) + '<style>\n' + css + '\n</style>' + html.slice(lastStyle.index + lastStyle[0].length);
  }

  writeFileSync('index.html', html);
  console.log('Rebuilt index.html (' + (html.length / 1024 | 0) + ' KB)');
}

function check() {
  execSync('node --check app.js', { stdio: 'inherit' });
  console.log('app.js: syntax OK');
}

async function startDevServer() {
  rebuild();
  const http = await import('http');
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  
  const PORT = 5050;
  const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    };
    
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  
  server.listen(PORT, () => {
    console.log(`▶ AMV dev server: http://localhost:${PORT}  (serving ${__dirname})`);
  });
}

if (cmd === 'check') check();
else if (cmd === 'dev') startDevServer();
else { rebuild(); }
