#!/usr/bin/env node
/* Makes the key pair AMV signs its notifications with (Web Push, RFC 8292),
   once, on the owner's own machine. Nothing is sent anywhere.

     node tools/vapid-keys.mjs

   Then, in the Worker's settings:
     npx wrangler secret put VAPID_PRIVATE_KEY     (paste the private value)
   and set VAPID_PUBLIC_KEY, which is not secret, as a plain variable. Keep the
   pair: making a new one means every device has to turn notifications on
   again. */
import { webcrypto as c } from 'crypto';
const k = await c.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await c.subtle.exportKey('jwk', k.privateKey);
const raw = new Uint8Array(await c.subtle.exportKey('raw', k.publicKey));
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
console.log('VAPID_PUBLIC_KEY=' + b64u(raw));
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
console.error('\nThe private value is a secret: put it only into `npx wrangler secret put VAPID_PRIVATE_KEY`.');
