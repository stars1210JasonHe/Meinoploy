import { createOpenAiClient } from '../createmod/extract/client';

const PROMPT = { name: 't', system: 'sys', user: 'usr', schema: { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } } };
const okResponse = (content, usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage }),
});
const noSleep = () => Promise.resolve();

describe('createOpenAiClient', () => {
  test('sends strict response_format + temperature 0 and returns {data, usage}', async () => {
    let captured;
    const client = createOpenAiClient({
      apiKey: 'sk-SECRET', fetchImpl: async (url, init) => { captured = JSON.parse(init.body); return okResponse({ a: 'x' }); }, sleepImpl: noSleep,
    });
    const r = await client.map(PROMPT);
    expect(captured.response_format).toEqual({ type: 'json_schema', json_schema: { name: 't', strict: true, schema: PROMPT.schema } });
    expect(captured.temperature).toBe(0);
    expect(captured.model).toBe('gpt-4o-mini');
    expect(r.data).toEqual({ a: 'x' });
    expect(r.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
  });
  test('temperature omitted for reasoning families', async () => {
    let captured;
    const client = createOpenAiClient({
      apiKey: 'k', synthModel: 'gpt-5-turbo', fetchImpl: async (u, i) => { captured = JSON.parse(i.body); return okResponse({ a: 'x' }); }, sleepImpl: noSleep,
    });
    await client.synth(PROMPT);
    expect('temperature' in captured).toBe(false);
  });
  test('retries on 429 then succeeds', async () => {
    let n = 0;
    const client = createOpenAiClient({
      apiKey: 'k', fetchImpl: async () => (++n < 3 ? { ok: false, status: 429, text: async () => 'rate' } : okResponse({ a: 'y' })), sleepImpl: noSleep,
    });
    const r = await client.map(PROMPT);
    expect(n).toBe(3);
    expect(r.data.a).toBe('y');
  });
  test('non-retryable 4xx throws WITHOUT the key in the message', async () => {
    const client = createOpenAiClient({
      apiKey: 'sk-SECRET', fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'bad request' }), sleepImpl: noSleep,
    });
    await expect(client.map(PROMPT)).rejects.toThrow(/400/);
    await expect(client.map(PROMPT)).rejects.not.toThrow(/sk-SECRET/);
  });
  test('refusal and truncation throw', async () => {
    const refuse = { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { refusal: 'no', content: null } }], usage: {} }) };
    const trunc = { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{' } }], usage: {} }) };
    const c1 = createOpenAiClient({ apiKey: 'k', fetchImpl: async () => refuse, sleepImpl: noSleep });
    await expect(c1.map(PROMPT)).rejects.toThrow(/refus/i);
    const c2 = createOpenAiClient({ apiKey: 'k', fetchImpl: async () => trunc, sleepImpl: noSleep });
    await expect(c2.map(PROMPT)).rejects.toThrow(/truncat|length/i);
  });
  test('vision payload carries the data URL with detail high', async () => {
    let captured;
    const client = createOpenAiClient({ apiKey: 'k', fetchImpl: async (u, i) => { captured = JSON.parse(i.body); return okResponse({ a: 'x' }); }, sleepImpl: noSleep });
    await client.synth(PROMPT, { imageDataUrl: 'data:image/jpeg;base64,AAA' });
    const userMsg = captured.messages.find(m => m.role === 'user');
    expect(userMsg.content).toEqual([
      { type: 'text', text: 'usr' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA', detail: 'high' } },
    ]);
  });
  test('retries on 500 and network error, recording backoff delays', async () => {
    const delays = [];
    let n = 0;
    const client = createOpenAiClient({
      apiKey: 'k',
      fetchImpl: async () => {
        n++;
        if (n === 1) throw new Error('socket hangup');
        if (n === 2) return { ok: false, status: 500, text: async () => 'oops' };
        return okResponse({ a: 'z' });
      },
      sleepImpl: async ms => { delays.push(ms); },
    });
    const r = await client.map(PROMPT);
    expect(r.data.a).toBe('z');
    expect(delays).toEqual([1000, 4000]); // slept only between attempts
  });
  test('terminal exhaustion: exactly 3 fetches, throws, and never sleeps after the last attempt', async () => {
    const delays = [];
    let n = 0;
    const client = createOpenAiClient({
      apiKey: 'k',
      fetchImpl: async () => { n++; return { ok: false, status: 429, text: async () => 'rate' }; },
      sleepImpl: async ms => { delays.push(ms); },
    });
    await expect(client.map(PROMPT)).rejects.toThrow(/429/);
    expect(n).toBe(3);
    expect(delays).toEqual([1000, 4000]); // no 9000 tail sleep
  });
});
