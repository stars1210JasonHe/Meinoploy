// OpenAI chat/completions client for the extractor. Injected everywhere (tests use a fake
// fetchImpl); returns PARSED data + the usage envelope. The API key never enters any error
// message, log, or cache.
const RETRY_DELAYS = [1000, 4000, 9000];
const REASONING = /^o\d|^gpt-5/;

export function createOpenAiClient(opts) {
  const {
    apiKey,
    extractModel = process.env.EXTRACT_MODEL || 'gpt-4o-mini',
    synthModel = process.env.SYNTH_MODEL || 'gpt-4o',
    temperature = 0,
    fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
    sleepImpl = ms => new Promise(r => setTimeout(r, ms)),
  } = opts;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  if (!fetchImpl) throw new Error('no fetch implementation available');

  async function call(model, prompt, imageDataUrl) {
    const userContent = imageDataUrl
      ? [{ type: 'text', text: prompt.user }, { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }]
      : prompt.user;
    const body = {
      model,
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: userContent }],
      response_format: { type: 'json_schema', json_schema: { name: prompt.name, strict: true, schema: prompt.schema } },
    };
    if (!REASONING.test(model)) body.temperature = temperature;

    let lastErr;
    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
      let res;
      try {
        res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
      } catch (e) {
        lastErr = new Error('network error calling OpenAI: ' + e.message);
        if (attempt < RETRY_DELAYS.length - 1) await sleepImpl(RETRY_DELAYS[attempt]);
        continue;
      }
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`OpenAI API ${res.status}`);
          lastErr.status = res.status;
          if (attempt < RETRY_DELAYS.length - 1) await sleepImpl(RETRY_DELAYS[attempt]);
          continue;
        }
        const text = await res.text();
        const err = new Error(`OpenAI API error ${res.status}: ${text}`);
        err.status = res.status;
        throw err;
      }
      const json = await res.json();
      const choice = json.choices && json.choices[0];
      if (!choice) throw new Error('OpenAI response has no choices');
      if (choice.message && choice.message.refusal) {
        throw new Error('OpenAI refused the request: ' + choice.message.refusal);
      }
      if (choice.finish_reason !== 'stop') {
        throw new Error(`OpenAI output truncated or filtered (finish_reason=${choice.finish_reason})`);
      }
      if (choice.message.content === null || choice.message.content === undefined) {
        throw new Error('OpenAI returned finish_reason=stop but message.content is empty (no JSON to parse)');
      }
      const usage = json.usage || {};
      return {
        data: JSON.parse(choice.message.content),
        usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0 },
      };
    }
    throw lastErr || new Error('OpenAI call failed after retries');
  }

  return {
    map: prompt => call(extractModel, prompt),
    synth: (prompt, o = {}) => call(synthModel, prompt, o.imageDataUrl),
  };
}
