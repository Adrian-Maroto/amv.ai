/* THE CHAT HOME IS A GREETING AND ONE BOX (Nov 17, the owner, with a picture
   of the reference: "Textbox needs to look like this in main chat, same with
   the font - the good to see you, welcome back etc. - and on the bottom it
   randomises based on recent chats").

   Measured, not read off the stylesheet:
     · the greeting is one of the plain sentences, with the person's name, in
       the body face at a regular weight, and it does not change under somebody
       while they read it;
     · "Welcome back" only to somebody who has chats to come back to;
     · the box is one pill: "+" on the left, the text, the engine, the mic, and
       a round button on the right - voice while it is empty, send once there
       is anything to send, stop while AMV answers;
     · text that needs two lines gets the whole width, and the buttons stay;
     · the "+" opens files AND Research, and Research still switches on;
     · under the box, suggestions made from the person's own recent chats, and
       a different pick for a different new chat - never a sentence that turns
       a command into a subject ("What is new on Fix the login bug");
     · carrying on opens THAT chat; the others put their words in the box;
     · nobody with no chats is offered suggestions made from nothing. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

for (const [vw, vh, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  const app = await bootApp({ tab: 'chat', viewport: { width: vw, height: vh }, user: { name: 'Olga Petrova', email: 'o@x.com', ini: 'O' } });
  const { page, errors } = app;
  const seed = (titles) => page.evaluate((titles) => {
    const mk = (t) => Object.assign(newConvObj(t), { msgs: [{ r: 'u', c: 'hi' }, { r: 'a', c: 'hello' }] });
    S.convs = [newConvObj()].concat(titles.map(mk)); S.cur = S.convs[0].id; setTab('chat'); renderChatView();
  }, titles);
  const visible = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none' ? { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } : null; }, sel);

  section(label + ': nobody with no chats is offered suggestions made from nothing');
  {
    await seed([]);
    const h = await page.evaluate(() => ({ g: document.querySelector('.chome-greet').textContent.trim(), sug: document.querySelectorAll('.chome-sug').length, chips: document.querySelectorAll('#chome-chips .chome-chip').length }));
    ok(!/Welcome back/.test(h.g) && /Olga/.test(h.g), 'a first visit is not welcomed back', h.g);
    ok(h.sug === 0 && h.chips > 0, 'and gets the starting points instead', h);
  }

  section(label + ': the greeting');
  {
    await seed(['Biochemistry digestion test practice', 'Kyoto trip in April', 'Fix the login bug in my app', 'How do I renew my passport?', 'Viaje a Kioto en abril']);
    const g = await page.evaluate(() => { const el = document.querySelector('.chome-greet'); const c = getComputedStyle(el.closest('.chome-title')); return { t: el.textContent.trim(), w: +c.fontWeight, f: c.fontFamily, size: parseFloat(c.fontSize) }; });
    ok(/^(Good (morning|afternoon|evening), Olga|Good to see you, Olga\.|Welcome back, Olga\.)$/.test(g.t), 'it is one of the plain sentences, with their first name', g.t);
    ok(g.w <= 450 && /Inter/i.test(g.f), 'in the body face at a regular weight, like the reference', g);
    ok(g.size >= 18 && g.size <= 22, 'at a quiet heading size, not a banner (the owner: "a bit less big")', g.size);
    await page.evaluate(() => renderChatMsgs());
    const again = await page.evaluate(() => document.querySelector('.chome-greet').textContent.trim());
    ok(again === g.t, 'and a redraw does not swap it under somebody reading it', [g.t, again]);
    const seen = new Set();
    for (let i = 0; i < 24; i++) { seen.add(await page.evaluate(() => { const c = newConvObj(); S.convs.unshift(c); S.cur = c.id; renderChatMsgs(); return document.querySelector('.chome-greet').textContent.trim(); })); }
    ok(seen.size >= 2 && [...seen].some(t => /Welcome back/.test(t)), 'new chats are greeted in different ways, welcome back among them', [...seen]);
  }

  if (label === 'desktop') {
    section('Centered in the space beside the sidebar, open or folded to icons');
    /* The owner, Nov 17: "make sure this is centered both when I click the
       three lines and when I don't". Measured, both ways. */
    const at = () => page.evaluate(() => {
      const mid = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return r.left + r.width / 2; };
      const sb = document.getElementById('sb').getBoundingClientRect();
      const area = (Math.max(0, sb.right) + innerWidth) / 2;
      return { rail: document.body.classList.contains('sb-rail'), off: ['.chome-greet', '#cib', '.chome-sugs'].map(s => Math.round(Math.abs(mid(s) - area))) };
    });
    await seed(['Kyoto trip in April', 'Biochemistry digestion test practice']);
    const open = await at();
    await page.evaluate(() => toggleSb()); await page.waitForTimeout(600);
    const folded = await at();
    await page.evaluate(() => toggleSb()); await page.waitForTimeout(600);
    ok(!open.rail && open.off.every(x => x <= 2), 'with the sidebar open, greeting, box and suggestions are centered', open);
    ok(folded.rail && folded.off.every(x => x <= 2), 'and folded to icons, still centered', folded);

    section('A name typed in small letters is greeted with its capital');
    const nm = await page.evaluate(() => { const was = S.user.name; S.user.name = 'adrian maroto'; const c = newConvObj(); S.convs.unshift(c); S.cur = c.id; renderChatMsgs();
      const t = document.querySelector('.chome-greet').textContent; S.user.name = 'McKenzie Lee'; const c2 = newConvObj(); S.convs.unshift(c2); S.cur = c2.id; renderChatMsgs();
      const t2 = document.querySelector('.chome-greet').textContent; S.user.name = was; return [t, t2]; });
    ok(/Adrian/.test(nm[0]) && !/adrian/.test(nm[0]), '"adrian" is greeted as Adrian', nm[0]);
    ok(/McKenzie/.test(nm[1]), 'and a name written with its own capitals is left as written', nm[1]);
  }

  section(label + ': a long name, after the sweep, reaches past nothing');
  {
    /* CI's fallback font is wider than this machine's, and the sweep's band
       rests past the end of the greeting: at 390px it reached 17px off the
       screen there and nowhere here. Measured on a long name, which reaches
       it in any font, and on the band's own box - what the layout helper
       sees - not on whether the page scrolls. */
    const r = await page.evaluate(async () => {
      S.user.name = 'Maximiliana Konstantinopoulou';
      const out = [];
      for (const g of ['time', 'see', 'back']) {
        _homePick = { conv: S.cur, greet: g, seed: 0.3 }; renderChatMsgs();
        document.getAnimations().filter(a => /amvShine/.test(a.animationName || '')).forEach(a => a.finish());
        await new Promise(r => requestAnimationFrame(r));
        const w = window.innerWidth;
        const far = [...document.querySelectorAll('.chome-title, .chome-title *')].map(e => e.getBoundingClientRect()).filter(b => b.width > 0).map(b => Math.round(b.right - w));
        out.push(Math.max(...far));
      }
      S.user.name = 'Olga Petrova';
      return out;
    });
    ok(r.every(x => x <= 2), 'no part of the greeting reaches past the screen', r);
  }

  section(label + ': one pill - plus, the text, the engine, the mic, a round button');
  {
    await seed(['Kyoto trip in April']);
    const p = await page.evaluate(() => {
      const b = (id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return { x: r.left, cy: r.top + r.height / 2, w: r.width, h: r.height, on: r.width > 0 && getComputedStyle(e).display !== 'none' }; };
      const cib = document.getElementById('cib').getBoundingClientRect();
      return { cib: { h: cib.height, r: parseFloat(getComputedStyle(document.getElementById('cib')).borderTopLeftRadius) }, plus: b('att-btn'), ta: b('mta'), mdl: b('inp-mdl-btn'), mic: b('voice-btn'), voice: b('voicemode-btn'), snd: b('snd'), ph: document.getElementById('mta').placeholder, sw: document.documentElement.scrollWidth };
    });
    ok(p.cib.h <= 72 && p.cib.r >= p.cib.h / 2 - 2, 'the box is one line high, with round ends', p.cib);
    ok(p.plus.on && p.ta.on && p.mdl.on && p.mic.on, 'plus, text, engine and mic are all there', p);
    ok(p.plus.x < p.ta.x && p.ta.x < p.mdl.x && p.mdl.x < p.mic.x && p.mic.x < p.voice.x, 'in that order, left to right', [p.plus.x, p.ta.x, p.mdl.x, p.mic.x, p.voice.x].map(Math.round));
    ok([p.plus, p.mdl, p.mic, p.voice].every(x => Math.abs(x.cy - p.ta.cy) < 6), 'on one line', [p.plus, p.ta, p.mdl, p.mic, p.voice].map(x => Math.round(x.cy)));
    ok(p.voice.on && !p.snd.on, 'empty: the round button is voice', { voice: p.voice.on, send: p.snd.on });
    ok(p.ph === 'Ask anything', 'the box says Ask anything', p.ph);
    const min = label === 'phone' ? 44 : 36;
    ok([p.plus, p.mic, p.voice].every(x => x.w >= min - 0.5 && x.h >= min - 0.5), 'every button is big enough to hit here (' + min + 'px)', [p.plus, p.mic, p.voice].map(x => [Math.round(x.w), Math.round(x.h)]));
    ok(p.sw <= vw, 'nothing runs off the side', p.sw);

    await page.fill('#mta', 'hello');
    const t = { voice: await visible('#voicemode-btn'), snd: await visible('#snd') };
    ok(t.snd && !t.voice, 'something typed: the same place is send', t);
    await page.fill('#mta', 'Write a long message that will certainly need more than one line of text in this box so we can see how it grows when it wraps around');
    await page.waitForTimeout(100);
    const tall = await page.evaluate(() => { const ta = document.getElementById('mta').getBoundingClientRect(), cib = document.getElementById('cib').getBoundingClientRect(), s = document.getElementById('snd').getBoundingClientRect(), pl = document.getElementById('att-btn').getBoundingClientRect();
      return { tall: document.getElementById('cib').classList.contains('cib-tall'), taW: ta.width / cib.width, below: s.top >= ta.bottom - 2 && pl.top >= ta.bottom - 2 }; });
    ok(tall.tall && tall.taW > 0.85, 'two lines: the text gets the whole width', tall);
    ok(tall.below, 'and the buttons sit in a row under it', tall);
    await page.fill('#mta', '');
    await page.evaluate(() => fitChatComposer(document.getElementById('mta')));
    ok(await page.evaluate(() => !document.getElementById('cib').classList.contains('cib-tall')), 'emptied: back to one line');
    await page.evaluate(() => { S.busy = true; document.getElementById('snd').classList.add('stop'); });
    ok(!!(await visible('#snd')) && !(await visible('#voicemode-btn')), 'while AMV answers, the round button is stop');
    await page.evaluate(() => { S.busy = false; document.getElementById('snd').classList.remove('stop'); });
  }

  section(label + ': the "+" opens upload and Research');
  {
    await page.click('#att-btn');
    const items = await page.evaluate(() => [...document.querySelectorAll('.ctxm [data-att]')].map(b => b.dataset.att));
    /* Upload and Research only (Nov 24); Your files is in the profile menu. */
    ok(items.length === 2 && items[0] === 'upload' && items[1] === 'research', 'upload and Research, nothing else', items);
    await page.click('.ctxm [data-att="research"]');
    await page.waitForSelector('.research-menu [data-tier]', { timeout: 3000 });
    const m = await page.evaluate(() => { const r = document.querySelector('.research-menu').getBoundingClientRect(); return { top: r.top, left: r.left, w: r.width }; });
    ok(m.top >= 0 && m.left >= 0 && m.left + m.w <= vw + 1, 'Research’s choices open on screen', m);
    await page.click('.research-menu [data-tier]');
    const rb = await visible('#research-btn');
    ok(rb && await page.evaluate(() => !!S._researchDepth), 'and choosing one switches Research on, shown in the box', rb);
    await page.click('#research-btn');
    ok(!(await visible('#research-btn')) && await page.evaluate(() => !S._researchDepth), 'pressing it again switches it off and it leaves the box');
  }

  section(label + ': two suggestions from different places, new each time');
  {
    /* The owner, Nov 17: "one could be about Crew, one about recent chats,
       and every refresh it's something new". Junk titles from their history
       ("f", "j", "ffnf" - real titles in the owner's own account) are never
       offered back. */
    const titles = ['Biochemistry digestion test practice', 'Kyoto trip in April', 'Fix the login bug in my app', 'How do I renew my passport?', 'Viaje a Kioto en abril', 'AI startup funding conditions', 'f', 'j', 'ffnf'];
    await seed(titles);
    const picks = new Set(), kinds = new Set(); let bad = [], junk = [], same = 0, pairs = 0;
    for (let i = 0; i < 30; i++) {
      const s = await page.evaluate(() => { const c = newConvObj(); S.convs.unshift(c); S.cur = c.id; renderChatMsgs();
        return [...document.querySelectorAll('.chome-sug')].map(b => ({ kind: b.dataset.kind, t: b.textContent.trim(), conv: b.dataset.conv || '' })); });
      if (i === 0) ok(s.length === 2, 'two suggestions under the box', s);
      pairs++; if (s.length === 2 && (s[0].kind === s[1].kind || (['continue','research','automate'].includes(s[0].kind) && ['continue','research','automate'].includes(s[1].kind)))) same++;
      s.forEach(x => { picks.add(x.t); kinds.add(['continue','research','automate'].includes(x.kind) ? 'recent' : x.kind); });
      bad = bad.concat(s.filter(x => x.kind !== 'continue' && /Fix the login|renew my passport|Viaje a/.test(x.t)));
      junk = junk.concat(s.filter(x => /(^|: |on )(f|j|ffnf)( |$|\?)/.test(x.t)));
    }
    ok(same === 0, 'the two always come from different places', same + ' of ' + pairs);
    ok(['recent', 'crew', 'build'].every(k => kinds.has(k)), 'a recent chat, a Crew job and something to build all turn up', [...kinds]);
    ok(picks.size >= 8, 'a new chat gets a different pick', picks.size);
    ok(junk.length === 0, 'a title that is not words is never offered back', junk.slice(0, 3));
    ok(bad.length === 0, 'a command, a question or another language is only ever offered to carry on', bad.slice(0, 3));

    const r = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.chome-sug')];
      return { cont: (c.find(b => b.dataset.kind === 'continue') || {}).dataset, other: (c.find(b => b.dataset.kind !== 'continue') || {}).dataset };
    });
    if (r.other) {
      await page.click('.chome-sug:not([data-kind="continue"])');
      const v = await page.inputValue('#mta');
      ok(v === r.other.sug, 'a suggestion puts its words in the box, to send or change', v);
      await page.fill('#mta', '');
    }
    if (r.cont) {
      const want = r.cont.conv;
      await page.evaluate(() => renderChatMsgs());
      await page.click('.chome-sug[data-kind="continue"]');
      await page.waitForTimeout(200);
      ok(await page.evaluate((w) => S.cur === w, want), 'carrying on opens that chat', want);
    }
    const sb = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sb <= vw, 'nothing runs off the side', sb);
  }

  ok(errors.length === 0, label + ': no page errors', errors.slice(0, 3));
  await app.close();
}
report();
done();
