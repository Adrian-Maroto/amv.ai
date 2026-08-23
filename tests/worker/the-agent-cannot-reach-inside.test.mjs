/* THE CLOUD METADATA SERVICE WAS REACHABLE THROUGH IPv6.

   The web agent fetches pages a user names, which makes it the product's SSRF
   surface: aim it at 169.254.169.254 and you are asking the server to hand you
   its own cloud credentials. `_webHostAllowed` exists to stop that, and it does
   stop the obvious forms.

   It did not stop this one:

       http://[::ffff:169.254.169.254]/   ->  hostname [::ffff:a9fe:a9fe]

   The IPv4-mapped IPv6 form of the metadata address. Not ::1, not starting fc,
   fd or fe80, not a dotted quad - so it fell through every branch and returned
   ok. So did [::], which routes to the local host, and 64:ff9b::, the NAT64
   prefix that exists precisely to carry v4 addresses over v6.

   Worth recording what was NOT wrong, because the first guess was: decimal
   (2130706433), octal (0177.0.0.1), hex and short form (127.1) all get
   canonicalised to 127.0.0.1 by `new URL` before the gate ever sees them. The
   theory was wrong and measuring it was what said so - and it narrowed the real
   bug to the one family the URL parser does not flatten.

   The fix pulls the last 32 bits out of any address that embeds an IPv4 one and
   runs the same table. Both directions are checked below, because a gate that
   blocks a public IPv6 resolver is its own outage. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');

/* The real function, lifted out of the worker rather than reimplemented - a
   reimplementation would be testing the copy. */
const m = src.match(/function _webHostAllowed\(raw\)\{[\s\S]*?\n\}/);
const webHostAllowed = eval('(' + m[0].replace('function _webHostAllowed', 'function') + ')');

section('Nothing inside the network is reachable, in any spelling of it');
{
  const MUST_BLOCK = [
    ['http://127.0.0.1/', 'loopback'],
    ['http://169.254.169.254/', 'cloud metadata, the one that matters'],
    ['http://2130706433/', 'loopback as a decimal integer'],
    ['http://0177.0.0.1/', 'loopback in octal'],
    ['http://127.1/', 'loopback in short form'],
    ['http://10.0.0.5/', 'private range'],
    ['http://192.168.1.1/', 'private range'],
    ['http://172.16.0.1/', 'private range'],
    ['http://100.64.0.1/', 'carrier-grade NAT'],
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[::]/', 'IPv6 unspecified, which routes to the local host'],
    ['http://[fd00::1]/', 'unique local'],
    ['http://[fe80::1]/', 'link local'],
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped loopback'],
    ['http://[::ffff:169.254.169.254]/', 'IPv4-mapped METADATA - the hole this closed'],
    ['http://[::ffff:a9fe:a9fe]/', 'the same address written in hex'],
    ['http://[::ffff:10.0.0.1]/', 'IPv4-mapped private range'],
    ['http://[64:ff9b::127.0.0.1]/', 'NAT64 prefix carrying loopback'],
    ['http://[::127.0.0.1]/', 'deprecated IPv4-compatible form'],
    ['http://localhost/', 'by name'],
    ['http://foo.internal/', 'internal suffix'],
    ['http://metadata.google.internal/', 'metadata by name'],
    ['ftp://example.com/', 'a scheme that is not http'],
    ['file:///etc/passwd', 'the local filesystem'],
  ];
  const leaks = MUST_BLOCK.filter(([u]) => webHostAllowed(u).ok)
    .map(([u, why]) => u + '  (' + why + ')');
  ok(MUST_BLOCK.length >= 20, 'the spellings are actually enumerated', MUST_BLOCK.length);
  ok(leaks.length === 0, 'not one of them is reachable from the agent', leaks);
}

section('And the public internet still is');
{
  /* The failure mode of an over-eager gate is an agent that cannot browse. */
  const MUST_ALLOW = [
    'https://example.com/',
    'https://api.github.com/',
    'https://8.8.8.8/',
    'https://93.184.216.34/',
    'http://[2606:4700:4700::1111]/',
    'http://[2001:4860:4860::8888]/',
    'http://[2001:db8::7f00:1]/',
    'https://[2a00:1450:4009:80f::200e]/',
  ];
  const blocked = MUST_ALLOW.filter(u => !webHostAllowed(u).ok)
    .map(u => u + ' :: ' + webHostAllowed(u).why);
  ok(blocked.length === 0, 'a public address is not mistaken for an internal one', blocked);
}

section('The gate is re-run on every hop, not just the first');
{
  /* A server answering 302 -> http://169.254.169.254/ walks past a gate that
     only checks what was typed. The register says redirects are followed by hand
     with the gate re-run at each hop; this is that claim, checked. */
  ok(/fetchGuarded/.test(src), 'there is a guarded fetch rather than a bare one');
  const fn = src.match(/async function fetchGuarded[\s\S]{0,2600}/);
  ok(!!fn, 'and it can be found to read');
  if (fn) {
    ok(/redirect:\s*'manual'/.test(fn[0]),
       'it follows redirects by hand instead of letting fetch do it silently');
    ok(/_webHostAllowed/.test(fn[0]),
       'and re-runs the host gate on what it was redirected TO');
  }
}

report();
done();
