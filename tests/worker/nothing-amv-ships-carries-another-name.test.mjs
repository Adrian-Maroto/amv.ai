/* AMV IS THE ONLY BRAND IN ANYTHING AMV SHIPS.

   That is a standing rule, and until now it was enforced by remembering it. It
   held in the visible places - no screen, no message and no document names
   another AI company - and it had quietly stopped holding in the one place
   nobody reads as "output": a secret name.

   `_modelKey` accepted the provider's own name as a fallback "so an existing
   deployment does not stop answering the moment this ships". There is no
   existing deployment; preflight still reports the KV namespace id as a
   placeholder. So the alias protected a customer who does not exist, appeared
   in the preflight secrets list the owner reads, and would have appeared in the
   Cloudflare dashboard next to the real one. Two documents called it required,
   which was wrong twice - it was a fallback, and the supported name is
   AMV_MODEL_KEY.

   The rule is mechanical now. Every mention in every shipped file has to be on
   the list below WITH a reason, so a fourth one cannot arrive quietly.

   Three things stay, and it matters why:

     MODEL_API_DEFAULT and the version header are the UPSTREAM WIRE PROTOCOL.
     The provider requires that exact header name and the endpoint has to be
     reachable. Renaming either does not rebrand anything - it stops every
     model call working, and a rule applied until the product breaks is not
     being followed, it is being obeyed past the point of sense. Setting
     MODEL_API_URL to a proxy removes the hostname from a deployment that wants
     it gone; that is a deployment choice, not a code change.

     The marketplace block lists name the brands in order to REFUSE them. They
     are the rule being enforced, not broken. */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');

/* Everything a visitor downloads, plus the sources they are built from, plus
   the files the owner reads while deploying. */
const SHIPPED = [
  'index.html', 'app.js', 'sw.js', 'styles.css', 'amv-backend.js',
  'build.mjs', 'preflight.mjs', 'check.mjs', 'wrangler.toml',
];

const NAMES = /(anthropic|openai|chatgpt|gpt-[0-9]|gemini|copilot|\bgrok\b|llama|mistral|perplexity|\bclaude\b)/gi;

/* Each allowed mention, and why it is allowed. A mention that is not on this
   list fails; a list entry that no longer matches anything also fails, so the
   allowlist cannot rot into a blanket exemption. */
const ALLOWED = [
  { name: 'the upstream endpoint',
    test: (c) => /MODEL_API_DEFAULT\s*=/.test(c) },
  { name: 'the upstream protocol version header',
    test: (c) => /['"]anthropic-version['"]/.test(c) },
  /* The provider's own identifier for each engine. Server-side only: the
     browser sends `amv-*` or a short key, the response header reports the AMV
     name, and nothing echoes these back. Renaming them does not rebrand
     anything, it stops the model being reachable. */
  { name: 'the ENGINES table, which holds the provider s id for each AMV tier',
    test: (c) => /'amv-[a-z]+':\s*\{\s*model:/.test(c) },
  { name: 'RAW_TO_KEY, which maps a provider id onto the AMV name',
    test: (c) => /:\s*'amv-[a-z]+'/.test(c) },
  { name: 'the marketplace block list, which names them in order to refuse them',
    test: (c) => /banned\s*=\s*\[/.test(c) || /\[\s*["']claude["']\s*,/.test(c)
              || /Listings must be AMV-only/.test(c) },
];

/* One entry per MATCH with the text around it, not per line.

   The line-based version reported the built bundle as an unexplained mention
   and showed `"use strict";const $=e=>...` as the evidence: index.html is
   minified onto one line, so "the line" is the whole file and the excerpt was
   its first 160 characters. The allowlist could never match, and the failure
   pointed at nothing.

   A window around the hit reads the same whether the file is minified or not,
   which is the point - the shipped artifact is the one that matters most and
   it is the one that is minified. */
function mentions(file) {
  const p = join(ROOT, file);
  if (!existsSync(p)) return [];
  const src = readFileSync(p, 'utf8');
  const out = [];
  for (const m of src.matchAll(NAMES)) {
    const a = Math.max(0, m.index - 160);
    const b = Math.min(src.length, m.index + m[0].length + 160);
    out.push({ file, at: m.index, hit: m[0], context: src.slice(a, b) });
  }
  return out;
}

section('Every mention in a shipped file is one somebody decided on');
{
  const all = SHIPPED.flatMap(mentions);
  ok(all.length > 0, 'the scan reads the files at all', all.length);
  const unexplained = all.filter(m => !ALLOWED.some(a => a.test(m.context)));
  ok(unexplained.length === 0,
     'no shipped file names another AI company outside the cases with a reason',
     unexplained.slice(0, 6).map(m => m.file + '@' + m.at + '  ...' +
       m.context.slice(120, 260).replace(/\s+/g, ' ') + '...'));

  /* The allowlist may not outlive what it excuses. An entry matching nothing is
     an exemption nobody is watching, and the next mention would slide under it. */
  ALLOWED.forEach(a => {
    ok(all.some(m => a.test(m.context)),
       'the exemption for ' + a.name + ' still matches something real', a.name);
  });
}

section('The artifact every visitor downloads carries nothing it should not');
{
  /* Stated separately because it is the file that actually leaves the building.
     The only mentions in it are the block list, which is there to refuse those
     names - and one of them used to be a CSS comment naming the project's own
     instructions file, shipped to everybody who opened the page. */
  const built = mentions('index.html');
  const notTheBlockList = built.filter(m => !/banned|Listings must be AMV-only|\[\s*["']claude["']\s*,/.test(m.context));
  ok(notTheBlockList.length === 0,
     'index.html mentions them only where it is refusing them',
     notTheBlockList.slice(0, 4).map(m => '...' + m.context.slice(120, 250).replace(/\s+/g, ' ') + '...'));
}

section('The model key has one name');
{
  const src = readFileSync(join(ROOT, 'amv-backend.js'), 'utf8');
  ok(!/env\.ANTHROPIC_API_KEY/.test(src),
     'the Worker no longer accepts the provider s own name as a key', true);
  ok(/env\s*&&\s*env\.AMV_MODEL_KEY/.test(src),
     'and reads the AMV one', true);

  /* The claim the old comment made and the code did not keep: every place that
     asks for the key, alerts about it, or checks for it names AMV_MODEL_KEY. */
  const asks = [...src.matchAll(/wrangler secret put ([A-Z_]+)/g)].map(m => m[1]);
  ok(asks.length > 0, 'the Worker tells the operator what to set', asks.length);
  ok(!asks.includes('ANTHROPIC_API_KEY'), 'and never asks for the old name', asks.join(','));
}

section('Nothing tells the operator to set a name that no longer works');
{
  /* A document naming a secret the code stopped reading is worse than a
     branding slip: somebody follows it, sets that secret, and the engine stays
     dark with everything apparently configured. */
  for (const f of ['CONTEXT.md', 'wrangler.saved.toml', 'preflight.mjs', 'DEPLOY.md', 'GO-LIVE.md']) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    ok(!/ANTHROPIC_API_KEY/.test(readFileSync(p, 'utf8')),
       f + ' does not name a key the Worker ignores', f);
  }
}

report();
done();
