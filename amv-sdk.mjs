/* AMV FROM YOUR OWN CODE.

   One file, no dependencies: Node 18 or newer, Deno, Bun, or a server-side
   worker. Downloaded from Settings -> API keys, where AMV writes this
   deployment's address into it, so there is nothing to configure but the key.

     import { AMV } from './amv-sdk.mjs';
     const amv = new AMV();                       // key from AMV_API_KEY

     const msg = await amv.messages.create({ messages: [{ role: 'user', content: 'Hello' }] });
     console.log(AMV.text(msg));

     for await (const ev of amv.messages.stream({ messages })) { ... }

     const run = await amv.runAgent({
       messages: [{ role: 'user', content: 'What is the weather in Lisbon?' }],
       tools: [{ name: 'weather', description: 'Current weather for a city',
                 input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
                 run: async ({ city }) => lookUp(city) }],
     });

   THE KEY STAYS OFF THE PAGE. It is read from the constructor or from
   AMV_API_KEY, travels only over https (or to this machine, for tests), and
   is never put in an error message. In a web page anybody can read it, so
   the SDK refuses to start in one unless told the page is the person's own
   (dangerouslyAllowBrowser) - a key on a public site is a key given away.

   Every answer streams from the server (the API requires it); create() reads
   the stream and returns the whole message, so callers that do not want
   events never see them. Usage counts against the key's account's plan. */

const DEFAULT_API = '__AMV_API__';
export const VERSION = '1';

export class AMVError extends Error {
  constructor(message, { status = 0, code = '', retryAfter = 0 } = {}) {
    super(message);
    this.name = 'AMVError';
    this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}

function envKey() { try { return (globalThis.process && globalThis.process.env && globalThis.process.env.AMV_API_KEY) || (globalThis.Deno && globalThis.Deno.env.get('AMV_API_KEY')) || ''; } catch (e) { return ''; } }
function envUrl() { try { return (globalThis.process && globalThis.process.env && globalThis.process.env.AMV_API_URL) || ''; } catch (e) { return ''; } }
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new AMVError('stopped', { code: 'aborted' })); }, { once: true });
});

/* Server-sent events, as objects. Lines are split on any newline; an event
   that is not JSON is skipped, and an error event ends the stream as one. */
async function* readEvents(res, signal) {
  const dec = new TextDecoder();
  const reader = res.body.getReader();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let ev; try { ev = JSON.parse(data); } catch (e) { continue; }
        if (ev.type === 'error') throw new AMVError((ev.error && ev.error.message) || 'the answer stopped with an error', { code: (ev.error && ev.error.type) || 'stream_error' });
        yield ev;
      }
    }
  } catch (e) {
    if (signal && signal.aborted) throw new AMVError('stopped', { code: 'aborted' });
    throw e;
  } finally {
    try { reader.releaseLock(); } catch (e) {}
  }
}

/* The events, folded into the message they describe: the shape create()
   returns. A tool call's input that does not parse is kept as `_unreadable`
   rather than guessed at, so runAgent can say so instead of running it. */
function foldEvents() {
  const msg = { model: '', content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } };
  const raw = [];
  return {
    msg,
    add(ev) {
      if (ev.type === 'message_start' && ev.message) {
        msg.model = ev.message.model || msg.model;
        if (ev.message.id) msg.id = ev.message.id;
        if (ev.message.usage) msg.usage.input_tokens = ev.message.usage.input_tokens || 0;
      } else if (ev.type === 'content_block_start') {
        const b = ev.content_block || {};
        raw[ev.index] = b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, _json: '' } : { type: 'text', text: b.text || '' };
      } else if (ev.type === 'content_block_delta') {
        const b = raw[ev.index] || (raw[ev.index] = { type: 'text', text: '' });
        const d = ev.delta || {};
        if (d.type === 'text_delta' && b.type === 'text') b.text += d.text || '';
        else if (d.type === 'input_json_delta' && b.type === 'tool_use') b._json += d.partial_json || '';
      } else if (ev.type === 'message_delta') {
        if (ev.delta && ev.delta.stop_reason) msg.stop_reason = ev.delta.stop_reason;
        if (ev.usage && ev.usage.output_tokens != null) msg.usage.output_tokens = ev.usage.output_tokens;
      }
    },
    done() {
      msg.content = raw.filter(Boolean).map(b => {
        if (b.type !== 'tool_use') return b;
        let input; try { input = b._json ? JSON.parse(b._json) : {}; } catch (e) { input = { _unreadable: b._json.slice(0, 2000) }; }
        return { type: 'tool_use', id: b.id, name: b.name, input };
      });
      return msg;
    },
  };
}

export class AMV {
  constructor({ apiKey, baseURL, maxRetries = 2, dangerouslyAllowBrowser = false, fetch: f } = {}) {
    if (typeof window !== 'undefined' && typeof document !== 'undefined' && !dangerouslyAllowBrowser)
      throw new AMVError('This is running in a web page, where anybody can read the API key. Call AMV from your server instead - or, for a page only you use, pass dangerouslyAllowBrowser: true.', { code: 'browser' });
    this.key = String(apiKey || envKey() || '');
    if (!this.key) throw new AMVError('No API key. Set AMV_API_KEY, or pass { apiKey }. Create one in AMV under Settings -> API keys.', { code: 'no_key' });
    const raw = baseURL || envUrl() || (DEFAULT_API.startsWith('__') ? '' : DEFAULT_API);
    if (!raw) throw new AMVError('No AMV server is set. Download this file again from Settings -> API keys, or pass { baseURL }.', { code: 'no_server' });
    let u; try { u = new URL(raw); } catch (e) { throw new AMVError('"' + raw + '" is not a web address.', { code: 'bad_server' }); }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))
      throw new AMVError('The AMV server must be an https:// address, so the key is never sent unencrypted.', { code: 'bad_server' });
    this.base = u.origin;
    this.maxRetries = Math.max(0, Math.min(5, maxRetries | 0));
    this._fetch = f || globalThis.fetch.bind(globalThis);
    const self = this;
    this.messages = {
      create: (params, opts) => self._create(params, opts),
      stream: (params, opts) => self._stream(params, opts),
      countTokens: (params, opts) => self._json('/v1/messages/count_tokens', { model: params.model || 'auto', system: params.system, messages: params.messages, tools: params.tools }, opts),
    };
    this.batches = {
      create: (requests, opts) => self._json('/v1/messages/batches', { requests: Array.isArray(requests) ? requests : (requests && requests.requests) }, opts),
      list: (opts) => self._json('/v1/messages/batches/list', {}, opts),
      retrieve: (id, opts) => self._json('/v1/messages/batches/get', { id }, opts),
      cancel: (id, opts) => self._json('/v1/messages/batches/cancel', { id }, opts),
      /* One object per line of the results file, in the order the server gave. */
      results: async (id, opts) => {
        const res = await self._post('/v1/messages/batches/results', { id }, opts);
        return (await res.text()).split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch (e) { return { _unreadable: l }; } });
      },
    };
  }

  /* The text of a message, joined. */
  static text(msg) { return ((msg && msg.content) || []).filter(b => b.type === 'text').map(b => b.text).join(''); }

  /* One POST, retried only when the server says to wait - a refusal before
     anything was reserved, so a retry cannot be charged twice. */
  async _post(path, body, { signal } = {}) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this._fetch(this.base + path, { method: 'POST', signal,
          headers: { 'Authorization': 'Bearer ' + this.key, 'Content-Type': 'application/json', 'User-Agent': 'amv-sdk/' + VERSION },
          body: JSON.stringify(body) });
      } catch (e) {
        if (signal && signal.aborted) throw new AMVError('stopped', { code: 'aborted' });
        throw new AMVError('Could not reach ' + this.base + ' (' + ((e.cause && e.cause.code) || e.message) + ').', { code: 'unreachable' });
      }
      if (res.ok) return res;
      let d = {}; try { d = await res.json(); } catch (e) {}
      const wait = Number(res.headers.get('Retry-After') || d.retryAfter || 0);
      if ((res.status === 429 || res.status === 503) && wait > 0 && wait <= 60 && attempt < this.maxRetries) { await sleep(wait * 1000, signal); continue; }
      const said = res.status === 401 ? 'AMV did not accept this key. It may have been revoked - check Settings -> API keys.'
        : (d.error || ('The server answered ' + res.status + '.'));
      throw new AMVError(said, { status: res.status, code: d.code || '', retryAfter: wait });
    }
  }
  async _json(path, body, opts) { return (await this._post(path, body, opts)).json(); }

  _body(params) {
    if (!params || !Array.isArray(params.messages) || !params.messages.length) throw new AMVError('messages is required: at least one { role, content }.', { code: 'bad_request' });
    const b = { model: params.model || 'auto', max_tokens: params.max_tokens || 4096, stream: true, messages: params.messages };
    if (params.system) b.system = params.system;
    if (Array.isArray(params.tools) && params.tools.length)
      b.tools = params.tools.map(t => ({ name: t.name, description: t.description || '', input_schema: t.input_schema || { type: 'object', properties: {} } }));
    for (const k of ['temperature', 'stop_sequences', 'metadata']) if (params[k] != null) b[k] = params[k];
    return b;
  }

  /* Events as they arrive. The returned object is also awaitable for the
     whole message: `const s = amv.messages.stream(p); for await (const ev of s) ...; const msg = await s.finalMessage();` */
  _stream(params, opts = {}) {
    const self = this, fold = foldEvents();
    let finished = null;
    const gen = (async function* () {
      const res = await self._post('/v1/messages', self._body(params), opts);
      for await (const ev of readEvents(res, opts.signal)) { fold.add(ev); yield ev; }
      finished = fold.done();
    })();
    return {
      [Symbol.asyncIterator]() { return gen; },
      async finalMessage() { if (!finished) for await (const _ of gen) {} return finished || fold.done(); },
      async text() { return AMV.text(await this.finalMessage()); },
    };
  }
  async _create(params, opts = {}) {
    const s = this._stream(params, opts);
    if (opts.onText) { for await (const ev of s) if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') opts.onText(ev.delta.text); }
    return s.finalMessage();
  }

  /* AN AGENT: the model, your tools, turns until it is done.

     Each tool is { name, description, input_schema, run(input, { signal }) }
     and runs HERE, in your process - AMV never runs your code. Every call is
     reported back to the model as its result, or as an error it can read: a
     tool it named that does not exist, input that did not parse, a tool that
     threw, or one you declined in `approve`. Nothing is guessed.

     Stops when the model finishes, at maxTurns, or when `signal` aborts - and
     says which in `stoppedBy`, so a run cut short is never mistaken for an
     answer. */
  async runAgent({ messages, tools = [], system, model, max_tokens, maxTurns = 10, signal, approve, onText, onToolCall } = {}) {
    const byName = new Map(tools.map(t => [t.name, t]));
    for (const t of tools) if (!t || typeof t.name !== 'string' || typeof t.run !== 'function') throw new AMVError('Every tool needs a name and a run(input) function.', { code: 'bad_tool' });
    const convo = (messages || []).slice();
    let last = null, turns = 0;
    while (turns < Math.max(1, maxTurns)) {
      if (signal && signal.aborted) return { message: last, messages: convo, turns, stoppedBy: 'aborted' };
      turns++;
      last = await this._create({ model, system, max_tokens, messages: convo, tools }, { signal, onText });
      convo.push({ role: 'assistant', content: last.content });
      const calls = last.content.filter(b => b.type === 'tool_use');
      if (last.stop_reason !== 'tool_use' || !calls.length) return { message: last, messages: convo, turns, stoppedBy: 'done' };
      const results = [];
      for (const c of calls) {
        const err = (text) => ({ type: 'tool_result', tool_use_id: c.id, content: text, is_error: true });
        const tool = byName.get(c.name);
        if (!tool) { results.push(err('There is no tool called "' + c.name + '". Available: ' + [...byName.keys()].join(', ') + '.')); continue; }
        if (c.input && c.input._unreadable !== undefined) { results.push(err('The input for "' + c.name + '" could not be read as JSON, so the tool was not run.')); continue; }
        if (signal && signal.aborted) return { message: last, messages: convo, turns, stoppedBy: 'aborted' };
        if (approve && !(await approve({ name: c.name, input: c.input }))) { results.push(err('The person declined to run "' + c.name + '". Do not try it again unless they ask.')); continue; }
        if (onToolCall) { try { onToolCall({ name: c.name, input: c.input }); } catch (e) {} }
        try {
          const out = await tool.run(c.input, { signal });
          results.push({ type: 'tool_result', tool_use_id: c.id, content: typeof out === 'string' ? out : JSON.stringify(out === undefined ? null : out) });
        } catch (e) {
          results.push(err('"' + c.name + '" failed: ' + String((e && e.message) || e).slice(0, 2000)));
        }
      }
      convo.push({ role: 'user', content: results });
    }
    return { message: last, messages: convo, turns, stoppedBy: 'max_turns' };
  }
}

export default AMV;
