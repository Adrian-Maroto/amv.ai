/* VIDEO, from the user's side.
   The old version faked a progress bar and produced nothing. These tests assert
   the fake is gone for good, and that a real video actually plays. */
import { bootApp } from '../lib/harness.mjs';
import { ok, section, report, done } from '../lib/assert.mjs';

const app = await bootApp({ tab: 'video' });
const { page, errors } = app;

section('The fake progress bar is gone for good');

const noFake = await page.evaluate(() => {
  const src = String(window.genVid || '');
  // NOTE: do NOT scan document.body.innerHTML — app.js is inlined into a <script>
  // tag, so the source (including comments that DESCRIBE the old bug) is in there.
  // Check the live function and what the user actually sees.
  const visible = document.getElementById('vgrid')?.textContent || '';
  return {
    hasInterval: /setInterval/.test(src),
    hasFakeStages: /Rendering motion|Compositing|Generating keyframes/.test(src + visible),
    callsApi: /_vidApi|\/v1\/video\/generate/.test(src)
  };
});
ok(!noFake.hasInterval, 'genVid no longer runs a setInterval progress fake');
ok(!noFake.hasFakeStages, 'the invented stage names are gone');
ok(noFake.callsApi, 'and it calls the real video API');

section('Not connected: it says so, it does not pretend');

const notConnected = await page.evaluate(async () => {
  AMV_API.base = '';                       // no engine
  document.getElementById('vp').value = 'a cat surfing';
  await genVid();
  await new Promise(r => setTimeout(r, 300));
  const v = S.vids[0] || {};
  return {
    status: v.status,
    error: v.error || '',
    noFakeBar: !document.querySelector('.vpf'),
    grid: document.getElementById('vgrid')?.textContent || ''
  };
});
ok(notConnected.noFakeBar, 'no fake percentage bar is drawn');
ok(/engine|connect/i.test(notConnected.error + notConnected.grid),
   'it says the engine is not connected', notConnected.error);

section('Configured: a REAL video is generated and PLAYS');

const real = await page.evaluate(async () => {
  S.vids.length = 0;
  AMV_API.base = 'https://api.test';
  AMV_API.token = 'tok';

  let polls = 0;
  window.fetch = async (u, o) => {
    const url = String(u);
    const R = (obj) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => obj });
    if (url.includes('/v1/video/generate')) return R({ ok: true, id: 'vid_abc', status: 'starting' });
    if (url.includes('/v1/video/status')) {
      polls++;
      // still working for the first couple of polls, then done
      if (polls < 2) return R({ ok: true, status: 'processing' });
      return R({ ok: true, status: 'succeeded', url: 'https://cdn.test/real.mp4' });
    }
    return R({ ok: true });
  };

  document.getElementById('vp').value = 'a cat surfing';
  await genVid();
  await new Promise(r => setTimeout(r, 400));

  const working = {
    status: S.vids[0].status,
    showsStage: !!document.querySelector('.vstage'),
    indeterminate: !!document.querySelector('.vbar-run'),   // no fake %
    hasPercent: /\d+%/.test(document.getElementById('vgrid').textContent)
  };

  // let the polling finish
  await new Promise(r => setTimeout(r, 6000));

  const vid = document.querySelector('video.vvid');
  return {
    working,
    finalStatus: S.vids[0].status,
    url: S.vids[0].url,
    hasVideoElement: !!vid,
    videoSrc: vid ? vid.getAttribute('src') : null,
    hasControls: vid ? vid.hasAttribute('controls') : false,
    hasDownload: !!document.querySelector('.vdl')
  };
});

ok(real.working.status === 'processing', 'while generating, status is processing', real.working.status);
ok(real.working.showsStage, 'it shows what is actually happening');
ok(real.working.indeterminate, 'with an indeterminate bar (the provider gives no %)');
ok(!real.working.hasPercent, 'and NO invented percentage is shown');

ok(real.finalStatus === 'succeeded', 'the job completes', real.finalStatus);
ok(real.hasVideoElement, 'a REAL <video> element is rendered');
ok(real.videoSrc === 'https://cdn.test/real.mp4', 'pointing at the REAL file', real.videoSrc);
ok(real.hasControls, 'with playback controls');
ok(real.hasDownload, 'and a download link');

section('Failures are reported honestly, with a way forward');

const failed = await page.evaluate(async () => {
  S.vids.length = 0;
  window.fetch = async (u) => {
    const url = String(u);
    const R = (obj, ok = true, status = 200) => ({ ok, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => obj });
    if (url.includes('/v1/video/generate')) return R({ ok: true, id: 'vid_x', status: 'starting' });
    if (url.includes('/v1/video/status')) return R({ ok: true, status: 'failed', error: 'The model could not render this scene.' });
    return R({ ok: true });
  };
  document.getElementById('vp').value = 'something impossible';
  await genVid();
  await new Promise(r => setTimeout(r, 6000));   // first poll fires at ~2.5s
  return {
    status: S.vids[0].status,
    error: S.vids[0].error,
    showsError: !!document.querySelector('.vfail'),
    canRetry: !!document.querySelector('[data-retry]')
  };
});
ok(failed.status === 'failed', 'a failed render is marked failed');
ok(/could not render/i.test(failed.error || ''), 'it shows the REAL reason from the provider', failed.error);
ok(failed.showsError, 'the failure is visible in the UI');
ok(failed.canRetry, 'and you can try again');

section('Plan limits are surfaced, not hidden');

const quota = await page.evaluate(async () => {
  S.vids.length = 0;
  window.fetch = async (u) => {
    const url = String(u);
    if (url.includes('/v1/video/generate'))
      return { ok: false, status: 429, headers: new Headers({ 'content-type': 'application/json' }),
               json: async () => ({ error: 'You\u2019ve used all the video in your plan this month.', code: 'video_quota' }) };
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true }) };
  };
  document.getElementById('vp').value = 'x';
  await genVid();
  await new Promise(r => setTimeout(r, 300));
  return { status: S.vids[0].status, error: S.vids[0].error };
});
ok(/used all the video|plan/i.test(quota.error || ''),
   'hitting the plan cap is explained plainly', quota.error);

/* Chat must be able to MAKE a video, not just talk about one. Every other
   engine in AMV is a tool the model can call; video is no exception. */
section('Chat can generate a video (agentic)');

const agentic = await page.evaluate(async () => {
  AMV_API.base = 'https://api.test';
  AMV_API.token = 'tok';
  let polls = 0;
  window.fetch = async (u) => {
    const url = String(u);
    const R = (o) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => o });
    if (url.includes('/v1/video/generate')) return R({ ok: true, id: 'vid_tool' });
    if (url.includes('/v1/video/status')) {
      polls++;
      return polls < 2 ? R({ ok: true, status: 'processing' })
                       : R({ ok: true, status: 'succeeded', url: 'https://cdn.test/tool.mp4' });
    }
    return R({ ok: true });
  };

  const hasTool = _toolsFor('chat').some(t => t.name === 'generate_video');
  const out = await _amvRunTool('generate_video', { prompt: 'a rocket launch', seconds: 5 }, () => {});
  return {
    hasTool,
    text: out.text,
    render: out.render || '',
    landedInVideoTab: (S.vids || []).some(v => v.url === 'https://cdn.test/tool.mp4')
  };
});

ok(agentic.hasTool, 'chat exposes a generate_video tool');
ok(/generated/i.test(agentic.text), 'the tool reports success', agentic.text);
ok(agentic.render.includes('<video'), 'and returns a REAL <video> element', agentic.render.slice(0, 60));
ok(agentic.render.includes('cdn.test/tool.mp4'), 'pointing at the real file');
ok(agentic.landedInVideoTab, 'the clip also lands in the Video tab (not stranded in chat)');

section('Chat is honest when video is unavailable');

const honest = await page.evaluate(async () => {
  window.fetch = async (u) => ({
    ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ configured: false })
  });
  const out = await _amvRunTool('generate_video', { prompt: 'x' }, () => {});
  return { text: out.text, render: out.render };
});
ok(/no video engine|not connected/i.test(honest.text),
   'it tells the model to say so plainly', honest.text);
ok(!honest.render, 'and renders NOTHING — no fake clip', honest.render);

section('No JavaScript errors');
ok(errors.length === 0, 'zero uncaught page errors', errors.slice(0, 3));

await app.close();
report();
done();
