import { createImagesClient, DEFAULT_IMAGE_MODEL } from '../createmod/portraits/client';

const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const err = (status, text) => ({ ok: false, status, json: async () => ({}), text: async () => text });
const B64 = Buffer.from('fakepng').toString('base64');
const GOOD = { data: [{ b64_json: B64 }], usage: { input_tokens: 100, output_tokens: 4000, total_tokens: 4100 } };

function client(responses, calls = []) {
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return responses.shift(); };
  return createImagesClient({ apiKey: 'sk-TESTKEY', imageModel: DEFAULT_IMAGE_MODEL, fetchImpl, sleepImpl: async () => {} });
}

describe('createImagesClient', () => {
  test('success: request shape + {b64, usage} envelope', async () => {
    const calls = [];
    const c = client([ok(GOOD)], calls);
    const r = await c.generate('a grid', { size: '1024x1024' });
    expect(r.b64).toBe(B64);
    expect(r.usage).toEqual(GOOD.usage);
    expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
    const body = JSON.parse(calls[0].init.body);
    expect(body).toEqual({ model: 'gpt-image-1', prompt: 'a grid', size: '1024x1024', quality: 'medium', background: 'opaque', n: 1 });
    expect(calls[0].init.headers.Authorization).toBe('Bearer sk-TESTKEY');
    expect(body.response_format).toBeUndefined();
  });
  test('5xx retries then succeeds (2 attempts max sleep count)', async () => {
    const sleeps = [];
    const responses = [err(500, 'boom'), ok(GOOD)];
    const fetchImpl = async () => responses.shift();
    const c = createImagesClient({ apiKey: 'k', fetchImpl, sleepImpl: async ms => { sleeps.push(ms); } });
    const r = await c.generate('p', { size: '1024x1024' });
    expect(r.b64).toBe(B64);
    expect(sleeps).toEqual([1000]);
  });
  test('exhausted retries throw with status, key-free message', async () => {
    const fetchImpl = async () => err(503, 'sk-LEAKY server exploded');
    const sleeps = [];
    const c = createImagesClient({ apiKey: 'sk-SECRET', fetchImpl, sleepImpl: async ms => { sleeps.push(ms); } });
    await expect(c.generate('p', { size: '1024x1024' })).rejects.toMatchObject({ status: 503 });
    expect(sleeps).toEqual([1000, 4000]); // no sleep after the final attempt
    await c.generate('p', { size: '1024x1024' }).catch(e => expect(e.message).not.toContain('sk-SECRET'));
  });
  test('non-retryable 400 throws immediately with the moderation message', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return err(400, 'blocked by moderation: depiction refused'); };
    const c = createImagesClient({ apiKey: 'k', fetchImpl, sleepImpl: async () => {} });
    await expect(c.generate('p', { size: '1024x1024' })).rejects.toMatchObject({ status: 400 });
    await c.generate('p', { size: '1024x1024' }).catch(e => expect(e.message).toContain('moderation'));
    expect(calls).toBe(2); // one per generate() call — never retried
  });
  test('200 with missing b64_json throws a clear error including any message field', async () => {
    const c = client([ok({ data: [{ revised_prompt: 'x', message: 'content filtered' }] })]);
    await expect(c.generate('p', { size: '1024x1024' })).rejects.toThrow(/b64_json.*content filtered|content filtered.*b64_json/s);
  });
});
