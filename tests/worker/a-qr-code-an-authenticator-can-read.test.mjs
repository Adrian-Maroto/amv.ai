/* A QR CODE AN AUTHENTICATOR APP CAN READ.

   Setting up the authenticator shows the key as a QR code, drawn in the page
   by _secQr (src/security/security.js) - the key is a secret, and a QR service
   on another host would be one more place it was sent.

   A QR code that is slightly wrong looks exactly like one that is right, so
   this checks it two ways:

   GOLDEN. When this file was written, each code below was rendered and decoded
   by an independent reader (OpenCV's QR detector), and decoded to exactly its
   text - and screenshots of the real Settings screen, desktop in light and a
   phone in dark, decoded to the real otpauth address with the key shown
   beside it. The hashes pin those exact grids, so any change to the encoder
   that alters a single module fails here until it is decoded again.

   STRUCTURE. What the standard fixes regardless of content: the size for the
   version, the three finder patterns, the timing lines, the always-dark
   module, and the format information - both copies identical and a valid
   BCH word naming error correction level M. */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'src/security/security.js'), 'utf8');
const body = src.slice(src.indexOf('function _secQr('), src.indexOf('async function _secTotpOn'));
const { _secQr, _secQrSvg } = new Function('escH', body + '; return { _secQr, _secQrSvg };')((s) => String(s).replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';'));
const hash = (m) => createHash('sha256').update(m.map(r => r.map(c => c ? 1 : 0).join('')).join('\n')).digest('hex');

const URI = 'otpauth://totp/AMV%3Anadia%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=AMV&algorithm=SHA1&digits=6&period=30';
section('The exact grids an independent reader decoded');
{
  const golden = [
    [URI, 49, '00472ae91af4f7ee6b6143c37eed257b0d16ae3f4657152bfba5bf51c3e09aab'],
    ['HELLO WORLD', 21, '1e387bd8b7a170bfa73b461bab560d96940b4421c42ed9c4d787a62c0a0166fa'],
    ['v'.repeat(180), 53, '53ee306fb2650c0ae06d90e739a33f53ab2075df12ea7444163d327a1af9b6fb'],
  ];
  for (const [t, size, h] of golden) {
    const m = _secQr(t);
    ok(m && m.length === size && hash(m) === h, 'unchanged: ' + (t.length > 30 ? t.slice(0, 30) + '…' : t), m && [m.length, hash(m)]);
  }
}

section('What the standard fixes, for every size AMV draws');
{
  const fmtOk = (m) => {
    const n = m.length, b = (x, y) => (m[y][x] ? 1 : 0);
    let a = 0, c = 0;
    const A = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    A.forEach(([x, y], i) => { a |= b(x, y) << i; });
    for (let i = 0; i < 8; i++) c |= b(n - 1 - i, 8) << i;
    for (let i = 8; i < 15; i++) c |= b(8, n - 15 + i) << i;
    const raw = a ^ 0x5412, data = raw >>> 10;
    let r = data; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    return { same: a === c, bch: ((data << 10) | (r & 0x3FF)) === raw, level: data >>> 3, mask: data & 7, dark: b(8, n - 8) };
  };
  const finder = (m, x0, y0) => { for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
    const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3)); if (!!m[y0 + dy][x0 + dx] !== (d !== 2)) return false; } return true; };
  const bad = [];
  for (const len of [1, 10, 20, 32, 50, 62, 80, 100, 120, 140, 160, 180, 200, 213]) {
    const m = _secQr('k'.repeat(len)), n = m && m.length, f = m && fmtOk(m);
    const timing = m && [...Array(n - 16)].every((_, i) => m[6][8 + i] === ((8 + i) % 2 === 0) && m[8 + i][6] === ((8 + i) % 2 === 0));
    if (!m || (n - 17) % 4 || !finder(m, 0, 0) || !finder(m, n - 7, 0) || !finder(m, 0, n - 7) || !timing
        || !f.same || !f.bch || f.level !== 0 || !f.dark) bad.push({ len, n, f, timing });
  }
  ok(bad.length === 0, 'finders, timing, the dark module and a valid format word naming level M, from 1 to 213 bytes', bad);
  ok(_secQr('k'.repeat(214)) === null, 'and past what the largest size holds, nothing is drawn rather than a broken code', true);
  ok(_secQr(URI).length === 49, 'a real setup address fits a code a phone reads easily (version 8)', _secQr(URI).length);
}

section('As drawn on the screen');
{
  const svg = _secQrSvg(URI, 'QR code for your authenticator app');
  ok(/viewBox="0 0 57 57"/.test(svg), 'with the four-module quiet zone around it', svg.slice(0, 80));
  ok(/<rect width="57" height="57" fill="#fff"\/><path d="[^"]+" fill="#000"\/>/.test(svg), 'black on white in either theme - a camera reads it, not the colour scheme', true);
  ok(/role="img" aria-label="QR code for your authenticator app"/.test(svg), 'and named for a screen reader', true);
  ok(_secQrSvg('k'.repeat(300), 'x') === '', 'too long: nothing, never a broken picture', true);
}

if (report('a-qr-code-an-authenticator-can-read') > 0) process.exitCode = 1;
done();
