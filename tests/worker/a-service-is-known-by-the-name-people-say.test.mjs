/* A SERVICE IS KNOWN BY THE NAME PEOPLE SAY, AND POPULAR IS WHAT PEOPLE THERE
   USE (owner, Nov 25: "crew has this recognition, chat has this recognition
   ... all the jobs most popular, no irrelevant jobs").

   Run against the catalogue the page downloads (public/country-catalog.js,
   public/countries/, public/service-names.json), in Node, with only the
   person's country stood in for:

   - recognition: the short name a service goes by ("my Chase card", "a Renfe
     train", "BBVA") finds it, though the catalogue's name is the formal one;
     an everyday word ("my Telcel plan") is never taken for a service; two
     names said are two answers; and between two listed in the person's
     country, the one visited more from there;
   - Popular takes turns across the everyday areas, so a bank, a shop and a
     way to travel are in the first ten, and Spain's opens with its own news,
     not the BBC or the New York Times;
   - and the opening Tasks name no sports club, which the data cannot choose
     for anybody. */
import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ok, section, report, done } from '../lib/assert.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUB = path.join(ROOT, 'public');
let OWN = '';
const ctx = {
  console, Intl, setTimeout, T: s => s, escH: s => String(s), loadStr: () => '', saveStr: () => {}, load: () => null, store: () => {},
  _cwCountryGuess: () => OWN,
  localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
  navigator: { language: 'en-US', languages: ['en-US'] },
  document: { addEventListener(){}, querySelector(){ return null; }, getElementById(){ return null; } },
  fetch: async (u) => {
    const p = path.join(PUB, String(u).split('?')[0]);
    if (!p.startsWith(PUB) || !fs.existsSync(p)) return { ok: false, json: async () => null };
    const t = fs.readFileSync(p, 'utf8'); return { ok: true, json: async () => JSON.parse(t), text: async () => t };
  },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(PUB, 'country-catalog.js'), 'utf8'), ctx, { filename: 'country-catalog.js' });
const find = async (own, text) => { OWN = own; return JSON.parse(JSON.stringify(await vm.runInContext('ccFindServices', ctx)(text, 3))); };
const names = (r) => r.map(x => x.name);

section('The name people say finds the service');
{
  const chase = await find('US', 'summarize my Chase transactions');
  ok(chase[0] && chase[0].site === 'chase.com', '"my Chase transactions" is Chase, though the catalogue calls it Chase Bank', names(chase));
  const renfe = await find('ES', 'book a Renfe train to Sevilla');
  ok(renfe[0] && renfe[0].site === 'renfe.com', '"a Renfe train" is Renfe Operadora', names(renfe));
  const two = await find('ES', 'compare Santander and BBVA savings');
  ok(two.length === 2 && two.some(x => x.site === 'santander.com') && two.some(x => x.site === 'bbva.com'),
     'two names said are two answers - Spain’s Santander and Spain’s BBVA, not three Santanders or BBVA Colombia', two.map(x => x.site));
  const monzo = await find('ES', 'connect my Monzo account and tell me what I spent');
  ok(monzo[0] && monzo[0].site === 'monzo.com', 'a British bank asked for from Spain is still found', names(monzo));
  const meezan = await find('US', 'check my Meezan Bank balance every morning');
  ok(meezan[0] && /meezan/.test(meezan[0].site), 'and a Pakistani one from the United States', names(meezan));
}

section('An everyday word is never taken for a service');
{
  const plan = await find('MX', 'my Telcel plan');
  ok(plan.length === 1 && plan[0].name === 'Telcel', '"my Telcel plan" is Telcel, and "plan" is not a service', names(plan));
  const water = await find('US', 'remind me to drink water');
  ok(water.length === 0, 'a request that names nothing finds nothing', names(water));
  const pie = await find('US', 'find me an apple pie recipe and order flour');
  ok(!pie.some(x => /apple/i.test(x.site)), 'a site’s short name counts only when written as a name', names(pie));
}

const pop = async (cc) => vm.runInContext(`(async () => { const d = await ccLoad('${cc}'); const t = ccTasks(d);
  const names = ccServices(d).map(x => x.e.n).filter(n => n && n.length > 3);
  return { pop: ccTasksPopular(d, t).map(x => ({ kind: x.kind, title: x.title })), names,
           leads: ccLeads(d).map(x => ({ kind: x.kind, title: x.title, prompt: x.prompt })) }; })()`, ctx);

section('Popular takes turns across the everyday areas');
{
  const AREA = { newspaper: 'news', newssite: 'news', tv: 'news', radio: 'news', bank: 'bank', telecom: 'phone', isp: 'phone',
    supermarket: 'shop', retail: 'shop', ecommerce: 'shop', mall: 'shop', restaurant: 'food', airline: 'travel', rail: 'travel',
    bus: 'travel', airport: 'travel', hotel: 'travel', utility: 'bills', insurer: 'bills', sportsclub: 'sport', stadium: 'sport' };
  for (const cc of ['US', 'ES', 'GB', 'IN', 'BR']) {
    const r = await pop(cc);
    const first10 = new Set(r.pop.slice(0, 10).map(x => AREA[x.kind]));
    ok(r.pop.length === 50 && ['news', 'bank', 'shop', 'travel'].every(a => first10.has(a)),
       cc + ': fifty, with news, a bank, a shop and a way to travel in the first ten', { n: r.pop.length, areas: [...first10] });
    ok(new Set(r.pop.map(x => x.title)).size === r.pop.length, cc + ': and no task twice', r.pop.length);
  }
}

/* Nov 28, the owner: "remove where it's from - 'compare saving rates' does
   not have to say Wells Fargo; 'improve my CV' says adidas.com". A task is
   text put in a new chat; naming a company only ever made it wrong. */
section('No task names a company, in any country');
{
  for (const cc of ['US', 'BD', 'ES', 'JP', 'DE', 'BR']) {
    const r = await pop(cc);
    const named = r.leads.filter(x => r.names.some(n => (x.title + ' ' + x.prompt).indexOf(n) >= 0));
    ok(r.leads.length >= 60 && named.length === 0, cc + ': ' + r.leads.length + ' tasks, none naming one of the country’s services',
       named.slice(0, 3).map(x => x.title));
    ok(r.leads.every(x => !/\{[a-z]+\}/.test(x.title + x.prompt)), cc + ': and no template slot left unfilled', '');
  }
}

section('The opening Tasks name no sports club');
{
  for (const cc of ['US', 'PK', 'FR']) {
    const r = await pop(cc);
    const sport = r.leads.find(x => x.kind === 'sportsclub');
    ok(sport && sport.title === 'When my team plays next' && !/F\.?C\b|Club|United|Inter /.test(sport.prompt),
       cc + ': "When my team plays next", for the team the person follows', sport);
  }
}

report();
done();
