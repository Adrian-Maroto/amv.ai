
/* ══════════════════════════════════════════════════════════════════════════
   NOTIFICATIONS ON THE PERSON'S PHONE AND COMPUTER (Web Push).

   Background jobs run while nobody has AMV open. Their results waited in the
   app (or an email, for those who chose one) until somebody looked. With a
   VAPID key pair set (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, made once with
   `node tools/vapid-keys.mjs`), a device that said yes is told when a result
   is ready or a job is waiting for approval.

   The rules it keeps:
     - a device is added only by the signed-in person, from that device, after
       the browser itself asked them; at most ten per account; forgotten from
       Settings, when the push service says the device is gone, on "sign out
       everywhere" and with the account;
     - the address a notification is sent to must belong to a browser maker's
       push service - anything else is refused, so a subscription can never
       make the Worker call an address somebody chose;
     - the message is encrypted for that device (RFC 8291) and signed as AMV
       (RFC 8292) with the Worker's own crypto, no library;
     - it names the job, never the result: a notification is read on a lock
       screen, so what it says is what anybody holding the phone can see. */

const PUSH_MAX_DEVICES = 10;
const PUSH_TTL_S = 24 * 3600;
/* The push services of the browsers people use: Chrome and Edge (Google's),
   Firefox (Mozilla's), Safari (Apple's), and Windows' own. Matched on the
   host's ending, so a region or a shard of one of them is still accepted. */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com',
  'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

function _pushOn(env){
  return !!(env && /^[A-Za-z0-9_-]{80,100}$/.test(String(env.VAPID_PUBLIC_KEY || '')) && /^[A-Za-z0-9_-]{40,50}$/.test(String(env.VAPID_PRIVATE_KEY || '')));
}
function _pushEndpointOk(endpoint){
  let u; try { u = new URL(String(endpoint || '')); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return PUSH_HOSTS.some(p => h === p || h.endsWith('.' + p));
}
const _pushKey = (email) => String(email || '').toLowerCase();

async function _pushDevices(env, email){
  const rec = await DB.get(env, 'push', _pushKey(email));
  return (rec && Array.isArray(rec.devices)) ? rec.devices : [];
}

/* ── The two RFCs, with the Worker's own crypto ─────────────────────────── */
const _pEnc = (s) => new TextEncoder().encode(s);
const _pCat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
async function _pHmac(key, data){
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/* RFC 8291: the payload encrypted so only that browser can read it. */
async function _pushEncrypt(uaPublicB64, authB64, plaintext){
  const uaPublic = b64urlDecodeToBytes(uaPublicB64), auth = b64urlDecodeToBytes(authB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || auth.length !== 16) throw new Error('bad_subscription_keys');
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await _pHmac(auth, shared);
  const ikm = await _pHmac(prkKey, _pCat(_pEnc('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await _pHmac(salt, ikm);
  const cek = (await _pHmac(prk, _pCat(_pEnc('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await _pHmac(prk, _pCat(_pEnc('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, _pCat(_pEnc(plaintext), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return _pCat(salt, rs, new Uint8Array([65]), asPublic, body);
}

/* RFC 8292: a short-lived token, signed with AMV's key, for that push service. */
async function _pushVapid(env, endpoint){
  const pub = b64urlDecodeToBytes(env.VAPID_PUBLIC_KEY);
  const jwk = { kty: 'EC', crv: 'P-256', d: String(env.VAPID_PRIVATE_KEY),
    x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64urlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const sub = env.VAPID_SUBJECT ? String(env.VAPID_SUBJECT) : String(env.APP_URL || 'https://amv.homes');
  const claims = b64urlEncode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, _pEnc(head + '.' + claims)));
  return 'vapid t=' + head + '.' + claims + '.' + b64urlEncode(sig) + ', k=' + env.VAPID_PUBLIC_KEY;
}

/* Sends one notification to every device the person added. Devices the push
   service says are gone (404/410) are forgotten. Returns how many took it.
   Never throws: a notification that could not go is said on the record, and
   the result it was about is still in the app. */
async function _pushSend(env, email, note){
  if (!_pushOn(env)) return { sent: 0, off: true };
  let devices = [];
  try { devices = await _pushDevices(env, email); } catch (e) { return { sent: 0 }; }
  if (!devices.length) return { sent: 0 };
  let sent = 0; const gone = [];
  for (const d of devices) {
    if (!_pushEndpointOk(d.endpoint)) { gone.push(d.endpoint); continue; }
    try {
      const payload = JSON.stringify({ title: String(note.title || 'AMV').slice(0, 80), body: _pushWords(d.lang || 'en', note).slice(0, 180),
        url: String(note.url || '/'), tag: String(note.tag || 'amv').slice(0, 60) });
      const body = await _pushEncrypt(d.p256dh, d.auth, payload);
      const r = await fetch(d.endpoint, { method: 'POST', body, headers: {
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(PUSH_TTL_S),
        Urgency: note.urgent ? 'high' : 'normal', Authorization: await _pushVapid(env, d.endpoint) } });
      if (r.status === 404 || r.status === 410) gone.push(d.endpoint);
      else if (r.ok) sent++;
      else audit(env, 'push_refused', { email, status: r.status, host: new URL(d.endpoint).hostname });
    } catch (e) {
      audit(env, 'push_failed', { email, error: String((e && e.message) || e).slice(0, 120) });
    }
  }
  if (gone.length) {
    try { await _withKind(env, 'push', _pushKey(email), (rec) => { rec.devices = (rec.devices || []).filter(x => !gone.includes(x.endpoint)); }, { devices: [] }); } catch (e) {}
  }
  return { sent, gone: gone.length };
}
/* What one run tells the person: the job's own name when there is one
   result, a count when there are several - never the result itself. */
function _pushNoteFor(list){
  const waiting = list.filter(x => x.waiting), ready = list.filter(x => !x.waiting);
  const name = (d) => { const t = String(d || '').replace(/\s+/g, ' ').trim(); return t.length > 60 ? t.slice(0, 57) + '…' : t; };
  return { title: 'AMV', kind: 'run', ready: ready.length, waiting: waiting.length, name: list.length === 1 ? name(list[0].detail) : '',
    url: '/#/crew', tag: waiting.length ? 'amv-approval' : 'amv-result', urgent: waiting.length > 0 };
}
/* The words of a notification, in the device's language. The job's own
   name is the person's own words and goes in as they wrote it. */
const PUSH_WORDS = {
  en: ['Ready: {0}', 'Waiting for your OK: {0}', '{0} results are ready.', '{0} jobs are waiting for your OK.', 'Notifications are on. AMV will tell you here when a job has a result or needs you.'],
  es: ['Listo: {0}', 'Espera tu aprobación: {0}', 'Hay {0} resultados listos.', 'Hay {0} trabajos esperando tu aprobación.', 'Los avisos están activados. AMV te avisará aquí cuando un trabajo tenga un resultado o te necesite.'],
  zh: ['已完成：{0}', '等待你确认：{0}', '{0} 个结果已就绪。', '{0} 个任务在等待你确认。', '通知已开启。任务有结果或需要你时，AMV 会在这里告诉你。'],
  hi: ['तैयार: {0}', 'आपकी मंज़ूरी का इंतज़ार: {0}', '{0} नतीजे तैयार हैं।', '{0} काम आपकी मंज़ूरी का इंतज़ार कर रहे हैं।', 'सूचनाएँ चालू हैं। जब किसी काम का नतीजा आएगा या उसे आपकी ज़रूरत होगी, AMV यहाँ बताएगा।'],
  ar: ['جاهز: {0}', 'بانتظار موافقتك: {0}', '{0} نتائج جاهزة.', '{0} مهام بانتظار موافقتك.', 'الإشعارات مفعّلة. سيخبرك AMV هنا عندما تكون لمهمة نتيجة أو تحتاج إليك.'],
  pt: ['Pronto: {0}', 'À espera da sua aprovação: {0}', '{0} resultados estão prontos.', '{0} trabalhos aguardam a sua aprovação.', 'As notificações estão ativas. O AMV avisa aqui quando um trabalho tiver um resultado ou precisar de si.'],
  fr: ['Prêt : {0}', 'Attend votre accord : {0}', '{0} résultats sont prêts.', '{0} tâches attendent votre accord.', 'Les notifications sont activées. AMV vous préviendra ici quand une tâche aura un résultat ou aura besoin de vous.'],
  de: ['Fertig: {0}', 'Wartet auf deine Freigabe: {0}', '{0} Ergebnisse sind fertig.', '{0} Aufträge warten auf deine Freigabe.', 'Mitteilungen sind an. AMV sagt dir hier Bescheid, wenn ein Auftrag ein Ergebnis hat oder dich braucht.'],
  ja: ['完了：{0}', '承認待ち：{0}', '{0} 件の結果が出ています。', '{0} 件のジョブが承認を待っています。', '通知がオンになりました。ジョブに結果が出たり対応が必要になったりすると、ここでお知らせします。'],
  ru: ['Готово: {0}', 'Ждёт вашего одобрения: {0}', 'Готово результатов: {0}.', 'Задач ждут вашего одобрения: {0}.', 'Уведомления включены. AMV сообщит здесь, когда у задачи будет результат или ей понадобитесь вы.'],
  id: ['Siap: {0}', 'Menunggu persetujuan Anda: {0}', '{0} hasil sudah siap.', '{0} tugas menunggu persetujuan Anda.', 'Notifikasi aktif. AMV akan memberi tahu Anda di sini saat tugas punya hasil atau membutuhkan Anda.'],
  bn: ['প্রস্তুত: {0}', 'আপনার অনুমোদনের অপেক্ষায়: {0}', '{0}টি ফল প্রস্তুত।', '{0}টি কাজ আপনার অনুমোদনের অপেক্ষায়।', 'বিজ্ঞপ্তি চালু। কোনো কাজের ফল এলে বা আপনাকে দরকার হলে AMV এখানে জানাবে।'],
  ur: ['تیار: {0}', 'آپ کی منظوری کا انتظار: {0}', '{0} نتائج تیار ہیں۔', '{0} کام آپ کی منظوری کا انتظار کر رہے ہیں۔', 'اطلاعات آن ہیں۔ جب کسی کام کا نتیجہ آئے یا اسے آپ کی ضرورت ہو، AMV یہاں بتائے گا۔'],
  tr: ['Hazır: {0}', 'Onayınızı bekliyor: {0}', '{0} sonuç hazır.', '{0} iş onayınızı bekliyor.', 'Bildirimler açık. Bir işin sonucu olduğunda ya da size ihtiyaç duyduğunda AMV size burada haber verir.'],
  vi: ['Đã xong: {0}', 'Đang chờ bạn duyệt: {0}', 'Có {0} kết quả đã sẵn sàng.', 'Có {0} tác vụ đang chờ bạn duyệt.', 'Đã bật thông báo. AMV sẽ báo bạn tại đây khi một tác vụ có kết quả hoặc cần bạn.'],
  it: ['Pronto: {0}', 'Attende la tua approvazione: {0}', '{0} risultati sono pronti.', '{0} attività attendono la tua approvazione.', 'Le notifiche sono attive. AMV ti avviserà qui quando un’attività avrà un risultato o avrà bisogno di te.'],
  ko: ['완료: {0}', '승인 대기 중: {0}', '결과 {0}개가 준비되었습니다.', '작업 {0}개가 승인을 기다리고 있습니다.', '알림이 켜졌습니다. 작업에 결과가 나오거나 확인이 필요하면 AMV가 여기서 알려 드립니다.'],
  ta: ['தயார்: {0}', 'உங்கள் ஒப்புதலுக்காகக் காத்திருக்கிறது: {0}', '{0} முடிவுகள் தயாராக உள்ளன.', '{0} வேலைகள் உங்கள் ஒப்புதலுக்காகக் காத்திருக்கின்றன.', 'அறிவிப்புகள் இயக்கப்பட்டன. ஒரு வேலைக்கு முடிவு வரும்போது அல்லது உங்கள் தேவை இருக்கும்போது AMV இங்கே தெரிவிக்கும்.'],
};
function _pushWords(lang, note){
  const w = PUSH_WORDS[lang] || PUSH_WORDS.en;
  const f = (i, v) => w[i].replace('{0}', String(v));
  if (note.kind === 'test') return w[4];
  if (note.kind !== 'run') return String(note.body || '');
  if (note.ready + note.waiting === 1) return f(note.waiting ? 1 : 0, note.name);
  return [note.ready ? f(2, note.ready) : '', note.waiting ? f(3, note.waiting) : ''].filter(Boolean).join(' ');
}
async function _pushForgetAll(env, email){
  try { await DB.del(env, 'push', _pushKey(email)); } catch (e) {}
}

/* ── Routes ─────────────────────────────────────────────────────────────── */
async function _pushUser(request, env){
  const user = await requireUser(request, env);
  if (!user) return { res: json({ error: 'unauthorized' }, 401) };
  if (user.via === 'apikey') return { res: json({ error: 'Notifications are set up from AMV itself, on the device that gets them.', code: 'session_only' }, 403) };
  return { user, email: String(user.email).toLowerCase() };
}

/* GET /v1/push - whether notifications exist here, the key a browser needs,
   and how many devices this account has. */
async function pushStatus(request, env){
  const u = await _pushUser(request, env); if (u.res) return u.res;
  if (!_pushOn(env)) return json({ on: false, devices: 0 });
  const devices = await _pushDevices(env, u.email);
  return json({ on: true, key: env.VAPID_PUBLIC_KEY, devices: devices.length,
    endpoints: devices.map(d => ({ host: new URL(d.endpoint).hostname, added: d.added, label: d.label || '' })) });
}

/* POST /v1/push/subscribe { subscription: { endpoint, keys: { p256dh, auth } }, label? } */
async function pushSubscribe(request, env){
  const u = await _pushUser(request, env); if (u.res) return u.res;
  if (!_pushOn(env)) return json({ error: 'Notifications are not switched on for this deployment yet.', code: 'needs_service' }, 503);
  const limited = await guardAction(env, 'push:' + u.email, 20, 200, 'notification changes');
  if (limited) return limited;
  const b = await request.json().catch(() => ({}));
  const s = (b && b.subscription) || {};
  const endpoint = String(s.endpoint || '');
  const p256dh = String((s.keys && s.keys.p256dh) || ''), auth = String((s.keys && s.keys.auth) || '');
  if (!_pushEndpointOk(endpoint) || endpoint.length > 1000)
    return json({ error: 'That is not a browser’s notification address AMV can send to.', code: 'push_endpoint' }, 400);
  let keysOk = false;
  try { keysOk = b64urlDecodeToBytes(p256dh).length === 65 && b64urlDecodeToBytes(auth).length === 16; } catch (e) { keysOk = false; }
  if (!keysOk) return json({ error: 'The browser did not send the keys a notification needs.', code: 'push_keys' }, 400);
  let count = 0;
  await _withKind(env, 'push', u.email, (rec) => {
    rec.devices = (Array.isArray(rec.devices) ? rec.devices : []).filter(d => d.endpoint !== endpoint);
    rec.devices.push({ endpoint, p256dh, auth, added: Date.now(), label: String(b.label || '').slice(0, 60),
      /* The language the page was in when this device said yes: what its
         notifications are written in (_pushWords). */
      lang: EMAIL_LANGS.has(String(b.lang || '').toLowerCase()) ? String(b.lang).toLowerCase() : 'en' });
    /* The oldest goes first: a phone replaced long ago, not the one in hand. */
    if (rec.devices.length > PUSH_MAX_DEVICES) rec.devices = rec.devices.slice(-PUSH_MAX_DEVICES);
    count = rec.devices.length;
  }, { devices: [] });
  audit(env, 'push_device_added', { email: u.email, host: new URL(endpoint).hostname });
  return json({ ok: true, devices: count });
}

/* POST /v1/push/unsubscribe { endpoint } - one device; { all: true } - every one. */
async function pushUnsubscribe(request, env){
  const u = await _pushUser(request, env); if (u.res) return u.res;
  const b = await request.json().catch(() => ({}));
  let count = 0;
  await _withKind(env, 'push', u.email, (rec) => {
    rec.devices = b.all ? [] : (Array.isArray(rec.devices) ? rec.devices : []).filter(d => d.endpoint !== String(b.endpoint || ''));
    count = rec.devices.length;
  }, { devices: [] });
  audit(env, 'push_device_removed', { email: u.email, all: !!b.all });
  return json({ ok: true, devices: count });
}

/* POST /v1/push/test - one notification to this account's devices, so the
   person sees it work before they rely on it. */
async function pushTest(request, env){
  const u = await _pushUser(request, env); if (u.res) return u.res;
  if (!_pushOn(env)) return json({ error: 'Notifications are not switched on for this deployment yet.', code: 'needs_service' }, 503);
  const limited = await guardAction(env, 'pushtest:' + u.email, 5, 30, 'test notifications');
  if (limited) return limited;
  const r = await _pushSend(env, u.email, { title: 'AMV', kind: 'test', tag: 'amv-test' });
  return json({ ok: r.sent > 0, sent: r.sent, gone: r.gone || 0 });
}
