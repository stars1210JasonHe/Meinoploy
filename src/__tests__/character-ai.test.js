const { CharacterAI, EVENT_TYPES, VERBOSITY } = require('../character-ai');

// Mock character and lore data
const mockCharacter = {
  id: 'albert-victor',
  name: 'Albert Victor',
  title: 'Council Financier',
  stats: { capital: 9, luck: 4, negotiation: 7, charisma: 6, tech: 5, stamina: 5 },
  passive: { id: 'financier', name: 'Prudent Financier', description: '10% discount on property purchases' },
  color: '#3498db',
};

const mockLore = {
  nameZh: '阿尔伯特·维克托',
  titleZh: '议会金融家',
  identity: '维度议会 · 经济委员会前主席',
  alignment: '秩序 / 稳定 / 资本理性',
  background: 'Albert Victor was born into a family of bankers.\n\nHe rose through the ranks quickly.',
  style: ['**稳定优先** — 他相信秩序', '**理性投资** — 不做冲动决定', '**长线思维** — 着眼未来'],
  styleIntro: 'His approach to business:',
  styleOutro: 'These beliefs shape his gameplay.',
  relationships: [
    { target: '先锋者 Lia', description: '既是竞争对手也是合作伙伴' },
    { target: '执法者 Knox', description: '法律同盟' },
  ],
  themeSummary: '稳定就是最大的力量',
};

// Mock fetch globally
global.fetch = jest.fn();

beforeEach(() => {
  fetch.mockClear();
});

describe('CharacterAI', () => {
  describe('constructor and settings', () => {
    test('creates with default settings', () => {
      const ai = new CharacterAI('');
      expect(ai.apiKey).toBe('');
      expect(ai.model).toBe('gpt-4o-mini');
      expect(ai.chatModel).toBe('gpt-4o');
      expect(ai.verbosity).toBe(VERBOSITY.MAJOR);
    });

    test('creates with custom settings', () => {
      const ai = new CharacterAI('sk-test', { model: 'gpt-4o', verbosity: VERBOSITY.ALL });
      expect(ai.apiKey).toBe('sk-test');
      expect(ai.model).toBe('gpt-4o');
      expect(ai.verbosity).toBe(VERBOSITY.ALL);
    });

    test('setApiKey updates the key', () => {
      const ai = new CharacterAI('');
      ai.setApiKey('sk-new');
      expect(ai.apiKey).toBe('sk-new');
    });

    test('setVerbosity updates the mode', () => {
      const ai = new CharacterAI('');
      ai.setVerbosity(VERBOSITY.OFF);
      expect(ai.verbosity).toBe(VERBOSITY.OFF);
    });

    test('setVerbosity ignores invalid modes', () => {
      const ai = new CharacterAI('', { verbosity: VERBOSITY.MAJOR });
      ai.setVerbosity('invalid');
      expect(ai.verbosity).toBe(VERBOSITY.MAJOR);
    });
  });

  describe('isEnabled', () => {
    test('returns false when no API key', () => {
      const ai = new CharacterAI('');
      expect(ai.isEnabled()).toBeFalsy();
    });

    test('returns false when verbosity is off', () => {
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.OFF });
      expect(ai.isEnabled()).toBe(false);
    });

    test('returns true when API key set and verbosity not off', () => {
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.MAJOR });
      expect(ai.isEnabled()).toBe(true);
    });
  });

  describe('shouldRespond', () => {
    test('returns false when disabled', () => {
      const ai = new CharacterAI('');
      expect(ai.shouldRespond(EVENT_TYPES.BUY_PROPERTY)).toBe(false);
    });

    test('returns true for major events in MAJOR mode', () => {
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.MAJOR });
      expect(ai.shouldRespond(EVENT_TYPES.BUY_PROPERTY)).toBe(true);
      expect(ai.shouldRespond(EVENT_TYPES.GO_TO_JAIL)).toBe(true);
      expect(ai.shouldRespond(EVENT_TYPES.BANKRUPTCY)).toBe(true);
      expect(ai.shouldRespond(EVENT_TYPES.GAME_OVER)).toBe(true);
    });

    test('returns false for minor events in MAJOR mode', () => {
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.MAJOR });
      expect(ai.shouldRespond(EVENT_TYPES.ROLL_DICE)).toBe(false);
      expect(ai.shouldRespond(EVENT_TYPES.PASS_GO)).toBe(false);
      expect(ai.shouldRespond(EVENT_TYPES.PAY_TAX)).toBe(false);
    });

    test('returns true for all events in ALL mode', () => {
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.ALL });
      expect(ai.shouldRespond(EVENT_TYPES.ROLL_DICE)).toBe(true);
      expect(ai.shouldRespond(EVENT_TYPES.PASS_GO)).toBe(true);
      expect(ai.shouldRespond(EVENT_TYPES.PAY_TAX)).toBe(true);
      expect(ai.shouldRespond(EVENT_TYPES.BANKRUPTCY)).toBe(true);
    });
  });

  describe('buildSystemPrompt', () => {
    test('includes character name and title', () => {
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, null);
      expect(prompt).toContain('Albert Victor');
      expect(prompt).toContain('Council Financier');
    });

    test('includes stats', () => {
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, null);
      expect(prompt).toContain('Capital 9');
      expect(prompt).toContain('Luck 4');
      expect(prompt).toContain('Negotiation 7');
    });

    test('includes passive ability', () => {
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, null);
      expect(prompt).toContain('Prudent Financier');
      expect(prompt).toContain('10% discount');
    });

    test('includes lore data when provided', () => {
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, mockLore);
      expect(prompt).toContain('议会金融家');
      expect(prompt).toContain('秩序 / 稳定 / 资本理性');
      expect(prompt).toContain('born into a family of bankers');
    });

    test('includes relationships from lore', () => {
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, mockLore);
      expect(prompt).toContain('先锋者 Lia');
      expect(prompt).toContain('执法者 Knox');
    });

    test('includes style/philosophy from lore', () => {
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, mockLore);
      expect(prompt).toContain('稳定优先');
      expect(prompt).toContain('理性投资');
    });

    test('includes response rules', () => {
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, null);
      expect(prompt).toContain('1-2 sentences');
      expect(prompt).toContain('Stay in character');
    });

    test('handles null lore gracefully', () => {
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, null);
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('Albert Victor');
    });
  });

  describe('respondToEvent', () => {
    test('returns null when disabled', async () => {
      const ai = new CharacterAI('');
      const result = await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      expect(result).toBeNull();
    });

    test('returns null for minor events in MAJOR mode', async () => {
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.MAJOR });
      const result = await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.ROLL_DICE, {}, {});
      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('calls OpenAI API for major events', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'A wise investment indeed.' } }],
        }),
      });

      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.MAJOR });
      const result = await ai.respondToEvent(
        mockCharacter, mockLore,
        EVENT_TYPES.BUY_PROPERTY,
        { spaceName: 'Park Place', price: 350 },
        { turnNumber: 5, season: 'Summer', money: 1200, propertyCount: 3 }
      );

      expect(result).toBe('A wise investment indeed.');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-test',
          }),
        })
      );

      // Verify the model used is gpt-4o-mini (fast model for events)
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');
    });

    test('returns null on API error', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const ai = new CharacterAI('sk-bad', { verbosity: VERBOSITY.MAJOR });
      const result = await ai.respondToEvent(
        mockCharacter, mockLore,
        EVENT_TYPES.BUY_PROPERTY, {}, {}
      );
      expect(result).toBeNull();
    });
  });

  describe('chat', () => {
    test('returns null when no API key', async () => {
      const ai = new CharacterAI('');
      const result = await ai.chat(mockCharacter, mockLore, 'Hello', [], {});
      expect(result).toBeNull();
    });

    test('calls API with chat model and history', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Greetings, fellow council member.' } }],
        }),
      });

      const ai = new CharacterAI('sk-test');
      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];
      const result = await ai.chat(mockCharacter, mockLore, 'What strategy do you recommend?', history, {
        turnNumber: 10,
        season: 'Winter',
        money: 800,
      });

      expect(result).toBe('Greetings, fellow council member.');
      expect(fetch).toHaveBeenCalledTimes(1);

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o'); // Chat uses better model
      // System + 2 history + 1 new message = 4 messages
      expect(body.messages.length).toBe(4);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[3].content).toBe('What strategy do you recommend?');
    });

    test('includes game state context in system prompt', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response.' } }],
        }),
      });

      const ai = new CharacterAI('sk-test');
      await ai.chat(mockCharacter, mockLore, 'Hi', [], {
        turnNumber: 15,
        season: 'Autumn',
        money: 500,
        propertyCount: 4,
      });

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      const systemPrompt = body.messages[0].content;
      expect(systemPrompt).toContain('Turn 15');
      expect(systemPrompt).toContain('Autumn');
      expect(systemPrompt).toContain('$500');
    });
  });

  describe('introduce', () => {
    test('returns null when no API key', async () => {
      const ai = new CharacterAI('');
      const result = await ai.introduce(mockCharacter, mockLore);
      expect(result).toBeNull();
    });

    test('calls API for introduction', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'I am Albert Victor, the Financier.' } }],
        }),
      });

      const ai = new CharacterAI('sk-test');
      const result = await ai.introduce(mockCharacter, mockLore);
      expect(result).toBe('I am Albert Victor, the Financier.');
    });
  });

  describe('concurrency guard', () => {
    test('returns null when max concurrent requests exceeded', async () => {
      // Create two slow requests that don't resolve
      let resolveFirst, resolveSecond;
      fetch.mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }));
      fetch.mockImplementationOnce(() => new Promise(r => { resolveSecond = r; }));
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'response' } }] }),
      });

      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.ALL });
      ai.maxConcurrent = 2;

      // Start 2 requests
      const p1 = ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      const p2 = ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.GO_TO_JAIL, {}, {});

      // Third request should return null
      const result = await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.ROLL_DICE, {}, {});
      expect(result).toBeNull();

      // Clean up
      resolveFirst({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });
      resolveSecond({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });
      await Promise.all([p1, p2]);
    });
  });
});

describe('EVENT_TYPES', () => {
  test('contains all expected event types', () => {
    expect(EVENT_TYPES.ROLL_DICE).toBe('roll_dice');
    expect(EVENT_TYPES.BUY_PROPERTY).toBe('buy_property');
    expect(EVENT_TYPES.GO_TO_JAIL).toBe('go_to_jail');
    expect(EVENT_TYPES.BANKRUPTCY).toBe('bankruptcy');
    expect(EVENT_TYPES.GAME_OVER).toBe('game_over');
    expect(EVENT_TYPES.SEASON_CHANGE).toBe('season_change');
  });
});

describe('VERBOSITY', () => {
  test('contains all expected modes', () => {
    expect(VERBOSITY.OFF).toBe('off');
    expect(VERBOSITY.MAJOR).toBe('major');
    expect(VERBOSITY.ALL).toBe('all');
  });
});
