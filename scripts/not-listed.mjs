/* Adult sites are never listed, however visited (owner, Nov 27). One list,
   data/not-listed.json, read here by the data scripts and mirrored by the
   page (CC_NOT_LISTED in src/country/country-catalog.js), which checks every
   entry again; the-catalogue-lists-no-adult-sites holds the two equal. */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const NL = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'not-listed.json'), 'utf8'));
const HOSTS = new Set(NL.hosts), PAT = new RegExp(NL.pattern, 'i');
export const listed = (host) => { const s = String(host || '').toLowerCase().replace(/^www\./, ''); return !HOSTS.has(s) && !PAT.test(s); };
