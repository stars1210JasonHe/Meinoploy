// Create-Mod portraits — OpenAI Images API client (gpt-image-1).
// Mirrors extract/client.js conventions (retries, err.status, key hygiene,
// injectable fetch/sleep) with two deliberate departures per spec §2:
// no chat-style refusal field exists on this endpoint, and usage uses the
// Images-API names (input_tokens/output_tokens/total_tokens).

export const DEFAULT_IMAGE_MODEL = 'gpt-image-1';
const ENDPOINT = 'https://api.openai.com/v1/images/generations';
const RETRY_DELAYS = [1000, 4000, 9000]; // 3 attempts; 3rd delay slot never sleeps

const defaultSleep = ms => new Promise(r => setTimeout(r, ms));

export function createImagesClient(opts) {
  const apiKey = opts.apiKey;
  const imageModel = opts.imageModel || DEFAULT_IMAGE_MODEL;
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const sleepImpl = opts.sleepImpl || defaultSleep;
  if (!fetchImpl) throw new Error('createImagesClient: no fetch implementation available');

  async function generate(prompt, genOpts) {
    let lastErr = null;
    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
      try {
        const res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: imageModel, prompt, size: genOpts.size,
            quality: 'medium', background: 'opaque', n: 1,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          const e = new Error(`Images API ${res.status}: ${text.slice(0, 500)}`);
          e.status = res.status;
          if (res.status >= 400 && res.status < 500 && res.status !== 429) throw e; // non-retryable
          lastErr = e;
        } else {
          const body = await res.json();
          const item = body && body.data && body.data[0];
          if (!item || !item.b64_json) {
            const hint = item && (item.message || item.error || item.revised_prompt) ? ` (${item.message || item.error || item.revised_prompt})` : '';
            throw Object.assign(new Error(`Images API returned no b64_json${hint}`), { status: res.status, noRetry: true });
          }
          return { b64: item.b64_json, usage: body.usage || null };
        }
      } catch (e) {
        if (e.noRetry || (e.status >= 400 && e.status < 500 && e.status !== 429)) throw e;
        lastErr = e;
      }
      if (attempt < RETRY_DELAYS.length - 1) await sleepImpl(RETRY_DELAYS[attempt]);
    }
    throw lastErr;
  }

  return { generate };
}
