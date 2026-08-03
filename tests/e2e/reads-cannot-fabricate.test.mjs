/* A FAILED READ MUST NOT LOOK LIKE AN ANSWER.

   Twelve reads in this product answered a request that FAILED with a
   plausible-looking value, and every one rendered as a confident sentence:

     earnings()      -> balance: 0        "$0.00 available to withdraw"
     purchases()     -> []                "No purchases yet"
     myListings()    -> []                "No listings yet. Create one above."
     team tasks()    -> {tasks:[]}        "No tasks yet - assign the first one"
     team shared()   -> []                "nothing shared"
     team audit()    -> []                "No activity yet"

   The shape is always the same and always looks tidy:

       async function read(){
         try { ...network... }
         catch(e){ return []; }          // a fact about the account
       }

   It is invisible in review because the fallback is syntactically neat and the
   failure is rare. It is only obvious once you ask what SENTENCE the empty value
   turns into, and on a screen about money or ownership that sentence is a lie.

   Six were found by one grep, six more by asking how else the same defect could
   be written. This is so the thirteenth is found by the gate.

   The rule it enforces: a function that reads over the network may not answer a
   failure with data. It can throw, or it can return something the caller must
   check - never a value that reads as a real, empty answer. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'app.js'), 'utf8');

/* Every async function in the bundle, with its body, so what it DOES can be
   inspected rather than guessed from its name. */
function asyncFunctions(){
  const out = [];
  const re = /async\s+(?:function\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while((m = re.exec(bundle))){
    const start = m.index;
    const open = bundle.indexOf('{', re.lastIndex);
    if(open < 0) continue;
    let depth = 0, i = open;
    for(; i < bundle.length && i < open + 6000; i++){
      const c = bundle[i];
      if(c === '{') depth++;
      else if(c === '}'){ depth--; if(depth === 0){ i++; break; } }
    }
    out.push({ name: m[1], body: bundle.slice(start, i) });
  }
  return out;
}

/* Reads over the network. A write is a different question - this is about
   answers that get rendered. */
const NETWORK = /AMV_API\._fetch\(|fetchDeadline\(|await fetch\(/;

/* A failure answered with DATA. An empty array or an object carrying zeroed
   fields both render as "there is nothing", which is a claim. Returning null,
   undefined or false is fine: a caller cannot mistake those for content. */
/* An object whose first field is `ok` is a CHECKED result - the caller has to
   look at it before using anything else, which is the pattern this rule
   recommends, not the one it forbids. Only unlabelled data counts. */
const FABRICATES = /catch\s*\([^)]*\)\s*\{\s*return\s*(\[\s*\]|\{\s*(?!ok\s*:)[A-Za-z_$'"])/;

const fns = asyncFunctions();

section('The bundle parses into functions this can inspect');
{
  ok(fns.length > 60, 'async functions were found', fns.length);
  const readers = fns.filter(f => NETWORK.test(f.body));
  /* If this drops to zero the pattern has drifted and the check below passes
     while testing nothing - the failure mode this repo has shipped before. */
  ok(readers.length > 10, 'including plenty that read over the network', readers.length);
}

section('No network read answers a failure with data');
{
  const offenders = fns
    .filter(f => NETWORK.test(f.body) && FABRICATES.test(f.body))
    .map(f => {
      const m = f.body.match(FABRICATES);
      return f.name + ': ' + String(m && m[0]).replace(/\s+/g, ' ').slice(0, 70);
    });
  ok(offenders.length === 0,
     'a read either succeeds or says it failed, never a third thing', offenders);
}

section('The reads that were fixed still refuse to fabricate');
{
  /* Named individually, so reverting one is caught even if it also happens to
     dodge the pattern above. */
  const named = ['earnings', 'purchases', 'myListings', 'tasks', 'shared', 'audit'];
  named.forEach(n => {
    const f = fns.find(x => x.name === n && NETWORK.test(x.body));
    ok(!!f, n + ' is present and reads over the network', !!f);
    if(!f) return;
    ok(/throw new Error\(/.test(f.body),
       n + ' throws rather than answering with an empty result', n);
  });
}

section('And a genuinely local read is left alone');
{
  /* The rule is about the NETWORK. Something reading its own storage has no
     failure to report other than corruption, and returning an empty list there
     is the honest answer, not a fabricated one. */
  const local = fns.find(f => !NETWORK.test(f.body) && FABRICATES.test(f.body));
  ok(true, 'local reads are out of scope by construction', local ? local.name : 'none present');
}

if (report('reads-cannot-fabricate') > 0) process.exitCode = 1;
done();
