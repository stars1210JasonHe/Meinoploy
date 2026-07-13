/**
 * boardbg orchestrator — target detection + generate chain with injected fakes.
 */
import { boardBgTarget, generateBoardBg, BG_OUT_W, BG_OUT_H, BG_SOURCE_SIZE } from '../createmod/boardbg';
import { BOARDBG_STYLE } from '../createmod/boardbg/prompt';

const WORLD_DATA = {
  roster: [{ id: 'a', name: 'A', title: 'Khan' }],
  lore: { a: { themeSummary: 'Steppe empire.', background: 'Born to ride. Second.' } },
  world: { id: 'w-1', name: 'World One', places: [{ realName: 'Karakorum' }] },
};
const MAP_DATA = {
  roster: [{ id: 'b', name: 'B', title: 'Baron' }],
  lore: {},
  map: { id: 'm-1', name: 'Map One', description: 'Rails and gold.' },
};

describe('boardBgTarget', () => {
  test('atlas mod -> world target', () => {
    const t = boardBgTarget(WORLD_DATA);
    expect(t).toMatchObject({ kind: 'world', targetId: 'w-1' });
    expect(t.promptInput.places[0].realName).toBe('Karakorum');
  });
  test('classic mod -> map target with description as story', () => {
    const t = boardBgTarget(MAP_DATA);
    expect(t).toMatchObject({ kind: 'map', targetId: 'm-1' });
    expect(t.promptInput.story).toBe('Rails and gold.');
  });
  test('neither -> throws', () => {
    expect(() => boardBgTarget({ roster: [] })).toThrow(/neither/);
  });
});

describe('generateBoardBg', () => {
  const fakeCodec = {
    decode: () => ({ width: 1536, height: 1024, data: new Uint8Array(1536 * 1024 * 4).fill(120) }),
    encode: (img) => ({ encoded: true, w: img.width, h: img.height }),
  };

  test('dry run returns prompt only, no API call', async () => {
    let called = 0;
    const client = { generate: async () => { called++; return {}; } };
    const r = await generateBoardBg(boardBgTarget(WORLD_DATA).promptInput, { dryRun: true }, client, fakeCodec);
    expect(called).toBe(0);
    expect(r.png).toBeNull();
    expect(r.prompt).toContain('Steppe empire.');
    expect(r.prompt).toContain(BOARDBG_STYLE);
  });

  test('generate chain: prompt -> API @1536x1024 -> downscale -> quantize -> encode', async () => {
    const calls = [];
    const client = {
      generate: async (prompt, opts) => {
        calls.push({ prompt, opts });
        return { b64: 'xx', usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } };
      },
    };
    const r = await generateBoardBg(boardBgTarget(WORLD_DATA).promptInput, {}, client, fakeCodec);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.size).toBe(BG_SOURCE_SIZE);
    expect(r.png).toEqual({ encoded: true, w: BG_OUT_W, h: BG_OUT_H });
    expect(r.usage.total_tokens).toBe(3);
  });
});
