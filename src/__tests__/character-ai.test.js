const {
  CharacterAI, EVENT_TYPES, VERBOSITY, mapEngineEventToAi, consumeNewEvents,
  formatAttitudeTable, formatTurnDigest, formatDiaryLines, localeInstruction,
  resolveBanterPair, findAuctionRival, banterSituationText,
} = require('../character-ai');
const { createLedgerState, applyEvent, buildTurnDigest, DEFAULT_DIALOGUE_RULES } = require('../dialogue/memory');
const { setLocale, getLocale } = require('../i18n');

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

    // T4 fix wave (whole-branch review): constructor captures dialogueRules
    // BY VALUE (resolveDialogueRules deep-merges into a fresh object), so
    // the live RULES singleton being re-pointed on a mod switch does NOT
    // propagate on its own — App.js's selectMod/loadGame mod-switch seams
    // must call setDialogueRules(RULES.dialogue) explicitly. This is the
    // pure half of that seam: setDialogueRules actually refreshes live
    // behavior (the cost caps read from this.dialogueRules on every check).
    test('setDialogueRules refreshes mod config live (mod-switch seam): budget caps change after the call', () => {
      const ai = new CharacterAI('sk-test'); // boot-time defaults: budget 3.0 / 400 calls
      expect(ai.getCostEstimate()).toMatchObject({ budgetUSD: 3.0, maxCalls: 400, capped: false });
      // Simulate switching to a mod whose rules.js overrides the caps.
      ai.setDialogueRules({ costBudgetUSD: 0, maxCallsPerSession: 7 });
      // Partial override resolves through resolveDialogueRules (other fields
      // fall back to defaults) AND takes effect immediately — budget 0 means
      // the cap is already exhausted with zero spend.
      expect(ai.getCostEstimate()).toMatchObject({ budgetUSD: 0, maxCalls: 7, capped: true });
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
      expect(ai.shouldRespond(EVENT_TYPES.DUEL)).toBe(true);
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

    // --- MT2-SP4 T2: memory-aware dialogue extras ---

    test('always appends a reply-language instruction, even with no dialogueContext', () => {
      setLocale('en');
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, null);
      expect(prompt).toContain('Reply in English');
    });

    test('reply-language instruction follows the live i18n locale', () => {
      setLocale('zh');
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, null);
      expect(prompt).toContain('Reply in Simplified Chinese');
      setLocale('en');
    });

    test('cites real attitude numbers, opponent name, and digest amounts/counts when dialogueContext is supplied', () => {
      let ledger = createLedgerState();
      // albert-victor loses a duel to lia-frost twice, then pays a big rent.
      ledger = applyEvent(ledger, { type: 'duel_resolved', actor: 'albert-victor', data: { propertyId: 1, ownerId: 'lia-frost', winnerId: 'lia-frost' } });
      ledger = applyEvent(ledger, { type: 'duel_resolved', actor: 'albert-victor', data: { propertyId: 2, ownerId: 'lia-frost', winnerId: 'lia-frost' } });
      const events = [
        { seq: 0, turn: 1, type: 'duel_resolved', actor: 'albert-victor', data: { propertyId: 1, ownerId: 'lia-frost', winnerId: 'lia-frost' } },
        { seq: 1, turn: 2, type: 'duel_resolved', actor: 'albert-victor', data: { propertyId: 2, ownerId: 'lia-frost', winnerId: 'lia-frost' } },
        { seq: 2, turn: 3, type: 'rent_paid', actor: 'albert-victor', data: { propertyId: 5, ownerId: 'lia-frost', amount: 310 } },
      ];
      const digest = buildTurnDigest(events, 'albert-victor', DEFAULT_DIALOGUE_RULES.digestWindow);
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, null, {
        ledgerState: ledger,
        opponents: [{ id: 'lia-frost', name: 'Lia Frost' }],
        digest,
      });
      // Attitude table: opponent name + real grudge number (2 duel losses x
      // duelLostGrudge weight 2 each = 4).
      expect(prompt).toContain('Lia Frost');
      expect(prompt).toContain('grudge 4');
      // Turn digest: count + real dollar amount.
      expect(prompt).toContain('Lost 2 duel(s)');
      expect(prompt).toContain('$310');
    });

    // T3 review fix (seat-id keying): the LIVE ledger is keyed by seat ids
    // ('0','1' — engine event actors), not character ids. When the context
    // bundle carries seatId (App.js's _buildDialogueContext always sets it),
    // the attitude lookup must use IT — character.id matches no ledger key
    // and would silently produce an empty attitude block.
    test('attitude table keys by ctx.seatId (seat-keyed live ledger), not character.id', () => {
      let ledger = createLedgerState();
      // Seat '0' (playing albert-victor) loses two duels to seat '1'.
      ledger = applyEvent(ledger, { type: 'duel_resolved', actor: '0', data: { propertyId: 1, ownerId: '1', winnerId: '1' } });
      ledger = applyEvent(ledger, { type: 'duel_resolved', actor: '0', data: { propertyId: 2, ownerId: '1', winnerId: '1' } });
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, null, {
        seatId: '0',
        ledgerState: ledger,
        opponents: [{ id: '1', name: 'Lia Frost' }],
      });
      expect(prompt).toContain('Lia Frost');
      expect(prompt).toContain('grudge 4');
      // Sanity inversion: WITHOUT seatId the charId fallback ('albert-victor')
      // matches no seat-keyed ledger entry -> block omitted entirely.
      const promptNoSeat = ai.buildSystemPrompt(mockCharacter, null, {
        ledgerState: ledger,
        opponents: [{ id: '1', name: 'Lia Frost' }],
      });
      expect(promptNoSeat).not.toContain('grudge');
    });

    test('cites past diary lines verbatim when supplied', () => {
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, null, {
        diaryLines: [{ turn: 5, seasonName: 'Summer', text: '陈留连失两城，袁本初欺人太甚——记下了。' }],
      });
      expect(prompt).toContain('陈留连失两城');
    });

    test('omits the attitude/digest/diary blocks (but keeps the locale line) when no history exists yet', () => {
      const ai = new CharacterAI('');
      const prompt = ai.buildSystemPrompt(mockCharacter, null, {
        ledgerState: createLedgerState(),
        opponents: [{ id: 'lia-frost', name: 'Lia Frost' }],
        digest: buildTurnDigest([], 'albert-victor', DEFAULT_DIALOGUE_RULES.digestWindow),
        diaryLines: [],
      });
      expect(prompt).not.toContain('standing with other council members');
      expect(prompt).not.toContain('Recent history');
      expect(prompt).not.toContain('past diary entries');
      expect(prompt).toContain('Reply in');
    });
  });

  describe('_formatEventContext', () => {
    test('DUEL case renders with all five fields (names + outcome wording)', () => {
      const ai = new CharacterAI('sk-test');
      const context = ai._formatEventContext(EVENT_TYPES.DUEL, {
        challengerName: 'Albert Victor',
        defenderName: 'Lia Frost',
        winnerName: 'Albert Victor',
        outcome: 'waived',
        propertyName: 'Reading Railroad',
      }, { turnNumber: 5, season: 'Summer' });
      expect(context).toContain('Reading Railroad');
      expect(context).toContain('Albert Victor');
      expect(context).toContain('Lia Frost');
      expect(context).toContain('rent waived');
    });

    test('DUEL case renders double rent outcome', () => {
      const ai = new CharacterAI('sk-test');
      const context = ai._formatEventContext(EVENT_TYPES.DUEL, {
        challengerName: 'Ophelia Nightveil',
        defenderName: 'Marcus Kodak',
        winnerName: 'Marcus Kodak',
        outcome: 'double',
        propertyName: 'Boardwalk',
      }, {});
      expect(context).toContain('Boardwalk');
      expect(context).toContain('Ophelia Nightveil');
      expect(context).toContain('Marcus Kodak');
      expect(context).toContain('double rent');
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

    test('the API-bound system prompt includes the dialogueContext memory blocks (6th param)', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      });
      let ledger = createLedgerState();
      ledger = applyEvent(ledger, { type: 'bankruptcy', actor: 'albert-victor', data: { creditorId: 'lia-frost' } });

      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.MAJOR });
      await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, { spaceName: 'Park Place', price: 350 }, {}, {
        ledgerState: ledger,
        opponents: [{ id: 'lia-frost', name: 'Lia Frost' }],
      });

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      const systemPrompt = body.messages[0].content;
      expect(systemPrompt).toContain('Lia Frost');
      expect(systemPrompt).toContain('grudge 3'); // bankruptedByGrudge default weight
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

    test('includes dialogueContext memory blocks (6th param) in the system prompt', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Response.' } }] }),
      });
      const digest = buildTurnDigest(
        [{ seq: 0, turn: 1, type: 'trade_accepted', actor: 'albert-victor', data: { proposerId: 'lia-frost' } }],
        'albert-victor',
        DEFAULT_DIALOGUE_RULES.digestWindow
      );

      const ai = new CharacterAI('sk-test');
      await ai.chat(mockCharacter, mockLore, 'Hi', [], {}, { digest, opponents: [{ id: 'lia-frost', name: 'Lia Frost' }] });

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      const systemPrompt = body.messages[0].content;
      expect(systemPrompt).toContain('Completed 1 trade(s)');
      expect(systemPrompt).toContain('Lia Frost');
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

  describe('writeDiaryEntry (T2 season diary)', () => {
    test('returns null when no API key', async () => {
      const ai = new CharacterAI('');
      const result = await ai.writeDiaryEntry(mockCharacter, mockLore, {});
      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('returns null and never calls the API when diaryEnabled is false', async () => {
      const ai = new CharacterAI('sk-test', { dialogueRules: { diaryEnabled: false } });
      const result = await ai.writeDiaryEntry(mockCharacter, mockLore, {});
      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('calls the mini model and returns the diary sentence, prompt carries the memory blocks', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '陈留连失两城，记下了。' } }] }),
      });
      const ai = new CharacterAI('sk-test');
      const result = await ai.writeDiaryEntry(mockCharacter, mockLore, {
        diaryLines: [{ turn: 1, text: 'past entry' }],
      });
      expect(result).toBe('陈留连失两城，记下了。');
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.messages[0].content).toContain('past entry');
      expect(body.messages[1].content).toContain('diary sentence');
    });
  });

  describe('banterLine (T2 duel/auction/trade banter)', () => {
    test('returns null when no API key', async () => {
      const ai = new CharacterAI('');
      const result = await ai.banterLine(mockCharacter, mockLore, {}, 'You just won a duel.');
      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('returns null and never calls the API when banterEnabled is false', async () => {
      const ai = new CharacterAI('sk-test', { dialogueRules: { banterEnabled: false } });
      const result = await ai.banterLine(mockCharacter, mockLore, {}, 'You just won a duel.');
      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('calls the mini model with the situation text as the user turn', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Third time. I remember.' } }] }),
      });
      const ai = new CharacterAI('sk-test');
      const result = await ai.banterLine(mockCharacter, mockLore, {}, 'You just won a duel over a property against Lia Frost.');
      expect(result).toBe('Third time. I remember.');
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.messages[1].content).toContain('You just won a duel over a property against Lia Frost.');
    });
  });

  describe('judgeCall (MT2-SP5 direction C2, T2, persuasion judge seam)', () => {
    test('returns null when no API key, never calls fetch', async () => {
      const ai = new CharacterAI('');
      const result = await ai.judgeCall('judge this: <player_words>please</player_words>');
      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('calls the mini model with the prompt as the sole user message, tiny max_tokens, temperature 0', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"score": 7}' } }] }),
      });
      const ai = new CharacterAI('sk-test');
      const prompt = 'JUDGE PROMPT <player_words>have mercy</player_words> output JSON';
      const result = await ai.judgeCall(prompt);
      expect(result).toBe('{"score": 7}');
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.max_tokens).toBe(20);
      expect(body.temperature).toBe(0);
      expect(body.messages).toEqual([{ role: 'user', content: prompt }]);
    });

    test('never uses the chat model, even when chatModel is configured differently', async () => {
      fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"score": 5}' } }] }) });
      const ai = new CharacterAI('sk-test', { model: 'gpt-4o-mini', chatModel: 'gpt-4o' });
      await ai.judgeCall('x');
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');
    });

    test('a thrown/rejected fetch resolves to null, never throws', async () => {
      fetch.mockRejectedValueOnce(new Error('network down'));
      const ai = new CharacterAI('sk-test');
      await expect(ai.judgeCall('x')).resolves.toBeNull();
    });

    test('other public methods (max_tokens 150, temperature 0.8) are UNAFFECTED by judgeCall existing', async () => {
      fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) });
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.ALL });
      await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(150);
      expect(body.temperature).toBe(0.8);
    });
  });

  describe('$3 session cost hard-cap (T2, owner decision item 0)', () => {
    test('getCostEstimate reflects RULES.dialogue defaults with zero spend at construction', () => {
      const ai = new CharacterAI('sk-test');
      const est = ai.getCostEstimate();
      expect(est).toEqual({ spentUSD: 0, callCount: 0, budgetUSD: DEFAULT_DIALOGUE_RULES.costBudgetUSD, maxCalls: DEFAULT_DIALOGUE_RULES.maxCallsPerSession, capped: false });
    });

    test('poison-pill: once the budget is exhausted, fetch is NEVER called again', async () => {
      fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.ALL, dialogueRules: { costBudgetUSD: 0 } });
      // costBudgetUSD: 0 means _budgetExhausted() is true from the very first call.
      const result = await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('poison-pill: an injected client that throws if called is never invoked once capped', async () => {
      const poisonFetch = jest.fn(() => { throw new Error('should never be called — budget already exhausted'); });
      global.fetch = poisonFetch;
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.ALL, dialogueRules: { costBudgetUSD: 0 } });
      await expect(ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {})).resolves.toBeNull();
      await expect(ai.chat(mockCharacter, mockLore, 'hi', [], {})).resolves.toBeNull();
      await expect(ai.introduce(mockCharacter, mockLore)).resolves.toBeNull();
      await expect(ai.writeDiaryEntry(mockCharacter, mockLore, {})).resolves.toBeNull();
      await expect(ai.banterLine(mockCharacter, mockLore, {}, 'hi')).resolves.toBeNull();
      await expect(ai.judgeCall('judge this')).resolves.toBeNull();
      expect(poisonFetch).not.toHaveBeenCalled();
      global.fetch = fetch; // restore the jest.fn() mock for subsequent tests
    });

    // T2 (MT2-SP5 direction C2) — judgeCall routes through the SAME _callApi
    // choke point, so it must be budget-charged exactly like every other
    // call type, at its OWN (cheaper) price from callPriceUSD.judge — no
    // separate budget logic exists for it to duplicate/diverge from.
    test('judgeCall is budget-charged at callPriceUSD.judge and trips the SAME fuse', async () => {
      fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"score": 5}' } }] }) });
      const ai = new CharacterAI('sk-test', { dialogueRules: { costBudgetUSD: DEFAULT_DIALOGUE_RULES.callPriceUSD.judge } });
      expect(ai.getCostEstimate()).toMatchObject({ spentUSD: 0, callCount: 0 });
      const r1 = await ai.judgeCall('x');
      expect(r1).toBe('{"score": 5}');
      expect(ai.getCostEstimate()).toMatchObject({ spentUSD: DEFAULT_DIALOGUE_RULES.callPriceUSD.judge, callCount: 1 });
      // Budget now exactly exhausted -> the very next call (any type) is capped.
      const r2 = await ai.judgeCall('y');
      expect(r2).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(ai.getCostEstimate().capped).toBe(true);
    });

    test('judgeCall counts toward maxCallsPerSession alongside every other call type', async () => {
      fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
      const ai = new CharacterAI('sk-test', {
        verbosity: VERBOSITY.ALL,
        dialogueRules: { maxCallsPerSession: 2 },
      });
      await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      await ai.judgeCall('x');
      expect(ai.getCostEstimate().callCount).toBe(2);
      const blocked = await ai.judgeCall('y');
      expect(blocked).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('spend estimate is monotonic non-decreasing across successive successful calls', async () => {
      fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.ALL });
      let prev = ai.getCostEstimate().spentUSD;
      for (let i = 0; i < 5; i++) {
        await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
        const next = ai.getCostEstimate().spentUSD;
        expect(next).toBeGreaterThanOrEqual(prev);
        prev = next;
      }
      expect(prev).toBeGreaterThan(0);
    });

    test('trips the budget fuse once cumulative spend reaches costBudgetUSD, blocking further calls', async () => {
      fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
      // 2 reactions at the default reaction price (0.001) = 0.002 exactly at budget.
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.ALL, dialogueRules: { costBudgetUSD: 0.002 } });
      const r1 = await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      const r2 = await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(fetch).toHaveBeenCalledTimes(2);
      const r3 = await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      expect(r3).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(2); // no 3rd network call
      expect(ai.getCostEstimate().capped).toBe(true);
    });

    test('count fuse trips independently of the price table — even with price 0, the Nth+1 call is blocked', async () => {
      fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
      const ai = new CharacterAI('sk-test', {
        verbosity: VERBOSITY.ALL,
        dialogueRules: { costBudgetUSD: 1000000, maxCallsPerSession: 2, callPriceUSD: { reaction: 0 } },
      });
      await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(ai.getCostEstimate().spentUSD).toBe(0); // price table zeroed — budget fuse alone would never trip
      const blocked = await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      expect(blocked).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(2); // still 2 — the count fuse alone stopped the 3rd call
      expect(ai.getCostEstimate().capped).toBe(true);
    });

    test('resetCostEstimate zeroes both counters', async () => {
      fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.ALL });
      await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      expect(ai.getCostEstimate().callCount).toBe(1);
      ai.resetCostEstimate();
      expect(ai.getCostEstimate()).toMatchObject({ spentUSD: 0, callCount: 0 });
    });

    test('setCostEstimate restores a persisted value (save-envelope load path)', () => {
      const ai = new CharacterAI('sk-test');
      ai.setCostEstimate({ spentUSD: 1.23, callCount: 45 });
      expect(ai.getCostEstimate()).toMatchObject({ spentUSD: 1.23, callCount: 45 });
    });

    // T2-review Fix 2: session-scoped monotonicity — loading an EARLIER
    // save must never roll the in-session spend counter backward, or
    // checkpoint-cycling (spend → load older save → spend again) could
    // bill real dollars far past the $3 cap while the counter kept
    // resetting.
    test('loading a save with LOWER stored spend never rolls the session counter backward', async () => {
      fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.ALL });
      // Spend to X = 0.003 / 3 calls in this session.
      for (let i = 0; i < 3; i++) {
        await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      }
      expect(ai.getCostEstimate()).toMatchObject({ spentUSD: 0.003, callCount: 3 });
      // "Load an earlier checkpoint" carrying a lower stored spend.
      ai.setCostEstimate({ spentUSD: 0.001, callCount: 1 });
      // Counter stays at X — the session already made those real calls.
      expect(ai.getCostEstimate()).toMatchObject({ spentUSD: 0.003, callCount: 3 });
    });

    test('after loading a lower-spend save, the cap still triggers at the true session total (poison-pill)', async () => {
      fetch.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
      // Budget allows exactly 4 reaction calls (4 x 0.001).
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.ALL, dialogueRules: { costBudgetUSD: 0.004 } });
      for (let i = 0; i < 3; i++) {
        await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      }
      // Checkpoint-cycle attempt: load an old save claiming only 1 call spent.
      ai.setCostEstimate({ spentUSD: 0.001, callCount: 1 });
      // 4th call still allowed (true total 0.003 < 0.004)...
      const r4 = await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      expect(r4).not.toBeNull();
      expect(fetch).toHaveBeenCalledTimes(4);
      // ...and the 5th is blocked at the TRUE session total, not the rolled-back one.
      const poisonFetch = jest.fn(() => { throw new Error('cap bypassed — should never be called'); });
      global.fetch = poisonFetch;
      const r5 = await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      expect(r5).toBeNull();
      expect(poisonFetch).not.toHaveBeenCalled();
      expect(ai.getCostEstimate().capped).toBe(true);
      global.fetch = fetch; // restore the jest.fn() mock for subsequent tests
    });

    test('after resetCostEstimate (genuinely new game), setCostEstimate can seed any value again', () => {
      const ai = new CharacterAI('sk-test');
      ai.setCostEstimate({ spentUSD: 2.5, callCount: 200 });
      ai.resetCostEstimate(); // exitToMenu — a true reset, new budget
      expect(ai.getCostEstimate()).toMatchObject({ spentUSD: 0, callCount: 0 });
      ai.setCostEstimate({ spentUSD: 0.5, callCount: 10 }); // load a different game's save
      expect(ai.getCostEstimate()).toMatchObject({ spentUSD: 0.5, callCount: 10 });
    });

    test('setCostEstimate tolerates missing/malformed input (old-save forward-compat) -> 0/0', () => {
      const ai = new CharacterAI('sk-test');
      ai.setCostEstimate({ spentUSD: 'oops', callCount: null });
      expect(ai.getCostEstimate()).toMatchObject({ spentUSD: 0, callCount: 0 });
      ai.setCostEstimate(undefined);
      expect(ai.getCostEstimate()).toMatchObject({ spentUSD: 0, callCount: 0 });
    });

    test('an unrecognized callType falls back to the most expensive known tier, never 0 (fail-closed pricing)', () => {
      const ai = new CharacterAI('sk-test');
      const knownMax = Math.max(...Object.values(DEFAULT_DIALOGUE_RULES.callPriceUSD));
      expect(ai._priceFor('some-future-call-type')).toBe(knownMax);
    });

    test('a concurrency-rejected call is NOT pre-charged (no real spend risk)', async () => {
      let resolveFirst;
      fetch.mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }));
      const ai = new CharacterAI('sk-test', { verbosity: VERBOSITY.ALL });
      ai.maxConcurrent = 1;
      const p1 = ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.BUY_PROPERTY, {}, {});
      const rejected = await ai.respondToEvent(mockCharacter, mockLore, EVENT_TYPES.GO_TO_JAIL, {}, {});
      expect(rejected).toBeNull();
      expect(ai.getCostEstimate().callCount).toBe(1); // only the first (in-flight) call was charged
      resolveFirst({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });
      await p1;
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

// --- Task 8: mapEngineEventToAi + consumeNewEvents (event-driven AI reactions) ---

// Minimal G fixture: only what mapEngineEventToAi reads (G.board.spaces by
// numeric id, G.players by string id, each with .money/.character.name).
function makeG() {
  const spaces = [];
  spaces[0] = { id: 0, name: 'GO' };
  spaces[3] = { id: 3, name: 'Reading Railroad' };
  spaces[5] = { id: 5, name: 'Park Place' };
  spaces[10] = { id: 10, name: 'Boardwalk' };
  return {
    board: { spaces },
    players: [
      { id: '0', money: 1000, character: { name: 'Albert Victor' } },
      { id: '1', money: 500, character: { name: 'Lia Frost' } },
    ],
  };
}

describe('mapEngineEventToAi', () => {
  const G = makeG();

  test('dice_rolled -> ROLL_DICE with real dice values (isDoubles renamed from data.doubles)', () => {
    const result = mapEngineEventToAi({ seq: 1, type: 'dice_rolled', actor: '0', data: { d1: 3, d2: 4, total: 7, doubles: false } }, G);
    expect(result).toEqual({ eventType: EVENT_TYPES.ROLL_DICE, eventData: { d1: 3, d2: 4, total: 7, isDoubles: false } });
  });

  test('landing_notice note:available -> LAND_PROPERTY_BUY with real spaceName/price/money', () => {
    const result = mapEngineEventToAi(
      { seq: 2, type: 'landing_notice', actor: '0', data: { note: 'available', propertyId: 5, listPrice: 350, effectivePrice: 315 } },
      G
    );
    expect(result).toEqual({ eventType: EVENT_TYPES.LAND_PROPERTY_BUY, eventData: { spaceName: 'Park Place', price: 315, money: 1000 } });
  });

  test.each(['unaffordable', 'owned', 'visiting_jail', 'parking_relax'])(
    'landing_notice note:%s -> null (not a buy prompt)',
    (note) => {
      const result = mapEngineEventToAi({ seq: 2, type: 'landing_notice', actor: '0', data: { note, propertyId: 5 } }, G);
      expect(result).toBeNull();
    }
  );

  test('rent_paid -> LAND_PROPERTY_RENT with ownerName resolved from G, not the placeholder \'\'', () => {
    const result = mapEngineEventToAi({ seq: 3, type: 'rent_paid', actor: '0', data: { propertyId: 5, ownerId: '1', amount: 42 } }, G);
    expect(result).toEqual({ eventType: EVENT_TYPES.LAND_PROPERTY_RENT, eventData: { spaceName: 'Park Place', ownerName: 'Lia Frost', rent: 42 } });
  });

  test('tax_paid -> PAY_TAX with the real amount, not 0', () => {
    const result = mapEngineEventToAi({ seq: 4, type: 'tax_paid', actor: '0', data: { amount: 200, spaceId: 4 } }, G);
    expect(result).toEqual({ eventType: EVENT_TYPES.PAY_TAX, eventData: { amount: 200 } });
  });

  test('card_drawn -> DRAW_CARD with the real card text', () => {
    const result = mapEngineEventToAi({ seq: 5, type: 'card_drawn', actor: '0', data: { deck: 'chance', cardIndex: 2, text: 'Advance to GO', empty: false } }, G);
    expect(result).toEqual({ eventType: EVENT_TYPES.DRAW_CARD, eventData: { cardText: 'Advance to GO' } });
  });

  test('card_drawn (empty deck) -> null (no AI reaction — sniffing parity)', () => {
    const result = mapEngineEventToAi({ seq: 5, type: 'card_drawn', actor: '0', data: { deck: 'chance', cardIndex: null, text: null, empty: true } }, G);
    expect(result).toBeNull();
  });

  test.each([
    ['space', 'Go To Jail space'],
    ['triples', 'Triple doubles'],
    ['card', 'a Chance/Community Chest card'],
  ])('went_to_jail reason:%s -> GO_TO_JAIL with a readable reason', (reason, expected) => {
    const result = mapEngineEventToAi({ seq: 6, type: 'went_to_jail', actor: '0', data: { reason } }, G);
    expect(result).toEqual({ eventType: EVENT_TYPES.GO_TO_JAIL, eventData: { reason: expected } });
  });

  test('salary_collected source:go -> PASS_GO with the real amount', () => {
    const result = mapEngineEventToAi({ seq: 7, type: 'salary_collected', actor: '0', data: { source: 'go', amount: 200 } }, G);
    expect(result).toEqual({ eventType: EVENT_TYPES.PASS_GO, eventData: { amount: 200 } });
  });

  test.each(['hub', 'parking', 'card'])('salary_collected source:%s -> null (only a GO crossing is "passed GO")', (source) => {
    const result = mapEngineEventToAi({ seq: 7, type: 'salary_collected', actor: '0', data: { source, amount: 200 } }, G);
    expect(result).toBeNull();
  });

  test('property_bought -> BUY_PROPERTY with real spaceName/price', () => {
    const result = mapEngineEventToAi({ seq: 8, type: 'property_bought', actor: '0', data: { propertyId: 10, listPrice: 400, paidPrice: 400 } }, G);
    expect(result).toEqual({ eventType: EVENT_TYPES.BUY_PROPERTY, eventData: { spaceName: 'Boardwalk', price: 400 } });
  });

  test('property_upgraded -> UPGRADE_PROPERTY with real spaceName/levelName/cost', () => {
    const result = mapEngineEventToAi(
      { seq: 9, type: 'property_upgraded', actor: '0', data: { propertyId: 5, newLevel: 2, newLevelName: 'Hotel', cost: 150 } },
      G
    );
    expect(result).toEqual({ eventType: EVENT_TYPES.UPGRADE_PROPERTY, eventData: { spaceName: 'Park Place', levelName: 'Hotel', cost: 150 } });
  });

  test('auction_started -> AUCTION_START with real spaceName', () => {
    const result = mapEngineEventToAi({ seq: 10, type: 'auction_started', actor: null, data: { propertyId: 10, bidders: ['0', '1'] } }, G);
    expect(result).toEqual({ eventType: EVENT_TYPES.AUCTION_START, eventData: { spaceName: 'Boardwalk' } });
  });

  test('trade_proposed -> TRADE_PROPOSED with targetName resolved from G', () => {
    const result = mapEngineEventToAi(
      { seq: 11, type: 'trade_proposed', actor: '0', data: { targetPlayerId: '1', offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0 } },
      G
    );
    expect(result).toEqual({ eventType: EVENT_TYPES.TRADE_PROPOSED, eventData: { targetName: 'Lia Frost' } });
  });

  test('bankruptcy -> BANKRUPTCY with playerName resolved from the actor (the bankrupt player)', () => {
    const result = mapEngineEventToAi({ seq: 12, type: 'bankruptcy', actor: '1', data: { creditorId: '0' } }, G);
    expect(result).toEqual({ eventType: EVENT_TYPES.BANKRUPTCY, eventData: { playerName: 'Lia Frost' } });
  });

  test('season_changed -> SEASON_CHANGE with the real season name (from the payload, no lookup needed)', () => {
    const result = mapEngineEventToAi({ seq: 13, type: 'season_changed', actor: null, data: { seasonIndex: 1, seasonName: 'Autumn' } }, G);
    expect(result).toEqual({ eventType: EVENT_TYPES.SEASON_CHANGE, eventData: { newSeason: 'Autumn' } });
  });

  test('game_over -> GAME_OVER with winnerName resolved from data.result.winner', () => {
    const result = mapEngineEventToAi(
      { seq: 14, type: 'game_over', actor: null, data: { result: { winner: '0', reason: 'survival', standings: [] } } },
      G
    );
    expect(result).toEqual({ eventType: EVENT_TYPES.GAME_OVER, eventData: { winnerName: 'Albert Victor' } });
  });

  test('duel_resolved -> DUEL with all five eventData fields (challengerName, defenderName, winnerName, outcome, propertyName)', () => {
    const result = mapEngineEventToAi(
      {
        seq: 15,
        type: 'duel_resolved',
        actor: '0',
        data: {
          propertyId: 3,
          ownerId: '1',
          winnerId: '0',
          outcome: 'waived',
          challengerRoll: { dice: [6, 6], stamina: 10, luckBonus: 0, total: 22 },
          defenderRoll: { dice: [1, 1], stamina: 2, luckBonus: 0, total: 4 },
        },
      },
      G
    );
    expect(result).toEqual({
      eventType: EVENT_TYPES.DUEL,
      eventData: {
        challengerName: 'Albert Victor',
        defenderName: 'Lia Frost',
        winnerName: 'Albert Victor',
        outcome: 'waived',
        propertyName: 'Reading Railroad',
      },
    });
  });

  test.each(['duel_offered', 'duel_initiated', 'duel_declined'])(
    'unmapped duel type %s -> null (no AI reaction)',
    (type) => {
      const result = mapEngineEventToAi({ seq: 99, type, actor: '0', data: {} }, G);
      expect(result).toBeNull();
    }
  );

  test.each([
    'route_committed', 'moved', 'passive_triggered', 'property_passed', 'card_prompt',
    'card_applied', 'card_redrawn', 'jail_fine_paid', 'left_jail', 'jail_wait',
    'building_sold', 'property_mortgaged', 'property_unmortgaged', 'property_regulated',
    'reroll_used', 'trade_accepted', 'trade_rejected', 'trade_cancelled', 'auction_turn',
    'bid_placed', 'auction_passed', 'auction_ended', 'character_selected', 'jail_reminder',
  ])('unmapped engine type %s -> null (no AI reaction)', (type) => {
    const result = mapEngineEventToAi({ seq: 99, type, actor: '0', data: {} }, G);
    expect(result).toBeNull();
  });

  test('null event -> null', () => {
    expect(mapEngineEventToAi(null, G)).toBeNull();
  });
});

describe('consumeNewEvents', () => {
  function ev(seq) { return { seq, type: 'dice_rolled', actor: '0', data: { d1: 1, d2: 1, total: 2, doubles: true } }; }

  test('lazy-init (lastSeq undefined) on a 50-event burst fires nothing and sets the cursor to the max seq', () => {
    const events = Array.from({ length: 50 }, (_, i) => ev(i));
    const { newEvents, nextSeq } = consumeNewEvents(events, undefined);
    expect(newEvents).toEqual([]);
    expect(nextSeq).toBe(49);
  });

  test('lazy-init on an empty G.events sets the cursor to -1 so seq 0 is still "new" next call', () => {
    const { newEvents, nextSeq } = consumeNewEvents([], undefined);
    expect(newEvents).toEqual([]);
    expect(nextSeq).toBe(-1);
  });

  test('incremental: returns only events after lastSeq, in order, and advances the cursor', () => {
    const events = [ev(0), ev(1), ev(2), ev(3)];
    const { newEvents, nextSeq } = consumeNewEvents(events, 1);
    expect(newEvents.map(e => e.seq)).toEqual([2, 3]);
    expect(nextSeq).toBe(3);
  });

  test('incremental with nothing new since lastSeq: empty result, cursor unchanged', () => {
    const events = [ev(0), ev(1)];
    const { newEvents, nextSeq } = consumeNewEvents(events, 1);
    expect(newEvents).toEqual([]);
    expect(nextSeq).toBe(1);
  });

  test('trim-gap: cursor older than the oldest remaining seq consumes everything available, no error', () => {
    // Simulates the eventLogCap having trimmed every seq below 100 from the
    // front while the cursor was still sitting at 5 (a stale/very-behind
    // cursor) — there is nothing to skip past, so all of it counts as new.
    const events = [ev(100), ev(101), ev(102)];
    const { newEvents, nextSeq } = consumeNewEvents(events, 5);
    expect(newEvents.map(e => e.seq)).toEqual([100, 101, 102]);
    expect(nextSeq).toBe(102);
  });

  // T2-review Fix 1 (AI off→on mid-game): detectAndTriggerAI (App.js) now
  // consumes/advances the cursor UNCONDITIONALLY, before its isEnabled()
  // gate — same treatment _updateDialogueLedger already had. Previously the
  // gate sat first, so the cursor froze while AI was off and flipping it
  // back ON mid-game replayed every missed event as one burst (a diary call
  // per missed season + all historical banter in a single tick). This test
  // walks the exact post-fix caller contract through consumeNewEvents: the
  // "disabled" renders consume-and-discard, the re-enable render sees ZERO
  // new events, and only events logged AFTER the flip fire.
  test('disable→enable cycle: events absorbed while disabled leave zero to fire on re-enable', () => {
    // Enabled phase: lazy-init at 3 events, then nothing new.
    let events = [ev(0), ev(1), ev(2)];
    let cursor = consumeNewEvents(events, undefined).nextSeq;
    expect(cursor).toBe(2);

    // AI turned OFF; play continues — two renders arrive while disabled.
    // The caller STILL consumes each render (post-fix contract) and simply
    // fires nothing with the result.
    events = [...events, ev(3), ev(4)]; // e.g. a season_changed + a duel_resolved
    let r = consumeNewEvents(events, cursor);
    expect(r.newEvents.length).toBe(2); // caller discards these (disabled)
    cursor = r.nextSeq;
    events = [...events, ev(5), ev(6)]; // another season boundary while still off
    r = consumeNewEvents(events, cursor);
    expect(r.newEvents.length).toBe(2); // discarded again
    cursor = r.nextSeq;
    expect(cursor).toBe(6);

    // AI turned back ON: the very next render must see NOTHING to replay —
    // no reaction/diary/banter burst.
    r = consumeNewEvents(events, cursor);
    expect(r.newEvents).toEqual([]);
    expect(r.nextSeq).toBe(6);

    // Only events logged AFTER the re-enable fire.
    events = [...events, ev(7)];
    r = consumeNewEvents(events, cursor);
    expect(r.newEvents.map(e => e.seq)).toEqual([7]);
  });
});

// --- MT2-SP4 T2: dialogue-memory prompt-assembly pure formatters ---

describe('formatAttitudeTable', () => {
  const opponents = [{ id: 'lia-frost', name: 'Lia Frost' }, { id: 'marcus-kodak', name: 'Marcus Kodak' }];

  test('empty ledger / no history -> \'\'', () => {
    expect(formatAttitudeTable('albert-victor', createLedgerState(), opponents, DEFAULT_DIALOGUE_RULES)).toBe('');
  });

  test('omits neutral (0/0) pairs but includes non-neutral ones with real numbers', () => {
    let ledger = createLedgerState();
    ledger = applyEvent(ledger, { type: 'duel_resolved', actor: 'albert-victor', data: { propertyId: 1, ownerId: 'lia-frost', winnerId: 'lia-frost' } });
    const table = formatAttitudeTable('albert-victor', ledger, opponents, DEFAULT_DIALOGUE_RULES);
    expect(table).toContain('Lia Frost');
    expect(table).toContain('grudge 2');
    expect(table).not.toContain('Marcus Kodak'); // still 0/0, omitted
  });

  test('tier glyphs scale with configured thresholds', () => {
    let ledger = createLedgerState();
    // 3 duel losses -> grudge 6, crosses tiers[0]=3 and tiers[1]=6 -> two ▲.
    for (let i = 0; i < 3; i++) {
      ledger = applyEvent(ledger, { type: 'duel_resolved', actor: 'albert-victor', data: { propertyId: i, ownerId: 'lia-frost', winnerId: 'lia-frost' } });
    }
    const table = formatAttitudeTable('albert-victor', ledger, opponents, DEFAULT_DIALOGUE_RULES);
    expect(table).toContain('grudge 6 ▲▲');
  });

  test('null/undefined charId or empty opponents -> \'\'', () => {
    expect(formatAttitudeTable(null, createLedgerState(), opponents, DEFAULT_DIALOGUE_RULES)).toBe('');
    expect(formatAttitudeTable('albert-victor', createLedgerState(), [], DEFAULT_DIALOGUE_RULES)).toBe('');
    expect(formatAttitudeTable('albert-victor', createLedgerState(), null, DEFAULT_DIALOGUE_RULES)).toBe('');
  });
});

describe('formatTurnDigest', () => {
  test('empty digest -> \'\'', () => {
    const digest = buildTurnDigest([], 'albert-victor', DEFAULT_DIALOGUE_RULES.digestWindow);
    expect(formatTurnDigest(digest, {})).toBe('');
  });

  test('null digest -> \'\'', () => {
    expect(formatTurnDigest(null, {})).toBe('');
  });

  test('resolves opponent ids to names and includes real dollar amounts + counts', () => {
    const events = [
      { seq: 0, turn: 1, type: 'rent_paid', actor: 'albert-victor', data: { propertyId: 1, ownerId: 'lia-frost', amount: 150 } },
      { seq: 1, turn: 2, type: 'rent_paid', actor: 'albert-victor', data: { propertyId: 2, ownerId: 'lia-frost', amount: 90 } },
    ];
    const digest = buildTurnDigest(events, 'albert-victor', DEFAULT_DIALOGUE_RULES.digestWindow);
    const text = formatTurnDigest(digest, { 'lia-frost': 'Lia Frost' });
    expect(text).toContain('Paid 2 rent payment(s) totaling $240');
    expect(text).toContain('Lia Frost');
  });

  test('unresolvable opponent id falls back to "someone" rather than "undefined"', () => {
    const events = [{ seq: 0, turn: 1, type: 'rent_paid', actor: 'albert-victor', data: { propertyId: 1, ownerId: 'ghost', amount: 50 } }];
    const digest = buildTurnDigest(events, 'albert-victor', DEFAULT_DIALOGUE_RULES.digestWindow);
    const text = formatTurnDigest(digest, {});
    expect(text).toContain('someone');
    expect(text).not.toContain('undefined');
  });
});

describe('formatDiaryLines', () => {
  test('empty/undefined -> \'\'', () => {
    expect(formatDiaryLines([])).toBe('');
    expect(formatDiaryLines(undefined)).toBe('');
    expect(formatDiaryLines(null)).toBe('');
  });

  test('includes each entry\'s text verbatim, oldest first', () => {
    const text = formatDiaryLines([
      { turn: 5, seasonName: 'Summer', text: 'First entry.' },
      { turn: 15, seasonName: 'Autumn', text: 'Second entry.' },
    ]);
    expect(text.indexOf('First entry.')).toBeLessThan(text.indexOf('Second entry.'));
  });
});

describe('localeInstruction', () => {
  afterEach(() => setLocale('en'));

  test('zh override -> Chinese instruction', () => {
    expect(localeInstruction('zh')).toContain('Simplified Chinese');
  });

  test('en override -> English instruction', () => {
    expect(localeInstruction('en')).toContain('English');
  });

  test('no override -> follows the live i18n locale', () => {
    setLocale('zh');
    expect(localeInstruction()).toContain('Simplified Chinese');
    setLocale('en');
    expect(localeInstruction()).toContain('English');
  });

  test('invalid override falls back to the live locale rather than throwing', () => {
    setLocale('en');
    expect(localeInstruction('fr')).toContain('English');
  });
});

// --- MT2-SP4 T2: banter pair resolution (pure, event-shape driven) ---

describe('findAuctionRival', () => {
  function auctionEv(seq, type, actor, data) { return { seq, type, actor, data }; }

  test('returns the CLOSEST (most recent) losing bidder walking backward from auction_ended', () => {
    const events = [
      auctionEv(0, 'auction_started', null, { propertyId: 5, bidders: ['0', '1', '2'] }),
      auctionEv(1, 'bid_placed', '0', { propertyId: 5, amount: 10 }),
      auctionEv(2, 'bid_placed', '1', { propertyId: 5, amount: 20 }),
      auctionEv(3, 'bid_placed', '0', { propertyId: 5, amount: 30 }),
      auctionEv(4, 'auction_ended', null, { propertyId: 5, winnerId: '0', amount: 30 }),
    ];
    // Walking backward from seq 4: last bid_placed with actor != winner is seq 2 (actor '1').
    expect(findAuctionRival(events, events[4])).toBe('1');
  });

  test('stops at this auction\'s own auction_started boundary (does not reach into an earlier auction)', () => {
    const events = [
      auctionEv(0, 'auction_started', null, { propertyId: 9, bidders: ['9'] }),
      auctionEv(1, 'bid_placed', '9', { propertyId: 9, amount: 5 }),
      auctionEv(2, 'auction_ended', null, { propertyId: 9, winnerId: '9', amount: 5 }),
      auctionEv(3, 'auction_started', null, { propertyId: 5, bidders: ['0', '1'] }),
      auctionEv(4, 'bid_placed', '0', { propertyId: 5, amount: 10 }),
      auctionEv(5, 'auction_ended', null, { propertyId: 5, winnerId: '0', amount: 10 }),
    ];
    // Only bidder on property 5 IS the winner -> no rival, must not fall through to property 9's bidder.
    expect(findAuctionRival(events, events[5])).toBeNull();
  });

  test('sole bidder (no rival) -> null', () => {
    const events = [
      auctionEv(0, 'auction_started', null, { propertyId: 5, bidders: ['0'] }),
      auctionEv(1, 'bid_placed', '0', { propertyId: 5, amount: 10 }),
      auctionEv(2, 'auction_ended', null, { propertyId: 5, winnerId: '0', amount: 10 }),
    ];
    expect(findAuctionRival(events, events[2])).toBeNull();
  });

  test('no-bid auction (winnerId null) -> null', () => {
    const events = [
      auctionEv(0, 'auction_started', null, { propertyId: 5, bidders: ['0'] }),
      auctionEv(1, 'auction_ended', null, { propertyId: 5, winnerId: null, amount: null }),
    ];
    expect(findAuctionRival(events, events[1])).toBeNull();
  });

  test('non-auction_ended event or missing event -> null', () => {
    expect(findAuctionRival([], null)).toBeNull();
    expect(findAuctionRival([], { type: 'bid_placed', data: {} })).toBeNull();
  });
});

describe('resolveBanterPair', () => {
  test('duel_resolved: winner speaks first, loser second, regardless of who was the actor', () => {
    // Actor is always the challenger (T1 report quirk) — winner here is the owner, not the actor.
    const event = { type: 'duel_resolved', actor: '0', data: { ownerId: '1', winnerId: '1' } };
    expect(resolveBanterPair(event, [])).toEqual({ firstId: '1', secondId: '0', situation: 'duel' });
  });

  test('duel_resolved with missing fields -> null', () => {
    expect(resolveBanterPair({ type: 'duel_resolved', actor: null, data: { ownerId: '1', winnerId: '1' } }, [])).toBeNull();
    expect(resolveBanterPair({ type: 'duel_resolved', actor: '0', data: { ownerId: null, winnerId: '1' } }, [])).toBeNull();
  });

  test('trade_accepted: proposer speaks first, acceptor (actor) second', () => {
    const event = { type: 'trade_accepted', actor: '1', data: { proposerId: '0' } };
    expect(resolveBanterPair(event, [])).toEqual({ firstId: '0', secondId: '1', situation: 'trade' });
  });

  test('trade_accepted with proposerId === actor (degenerate) -> null', () => {
    expect(resolveBanterPair({ type: 'trade_accepted', actor: '0', data: { proposerId: '0' } }, [])).toBeNull();
  });

  test('auction_ended: winner speaks first, the closest losing bidder second', () => {
    const events = [
      { seq: 0, type: 'auction_started', actor: null, data: { propertyId: 5, bidders: ['0', '1'] } },
      { seq: 1, type: 'bid_placed', actor: '1', data: { propertyId: 5, amount: 20 } },
      { seq: 2, type: 'auction_ended', actor: null, data: { propertyId: 5, winnerId: '0', amount: 30 } },
    ];
    expect(resolveBanterPair(events[2], events)).toEqual({ firstId: '0', secondId: '1', situation: 'auction' });
  });

  test('auction_ended with no identifiable rival -> null', () => {
    const events = [
      { seq: 0, type: 'auction_started', actor: null, data: { propertyId: 5, bidders: ['0'] } },
      { seq: 1, type: 'bid_placed', actor: '0', data: { propertyId: 5, amount: 10 } },
      { seq: 2, type: 'auction_ended', actor: null, data: { propertyId: 5, winnerId: '0', amount: 10 } },
    ];
    expect(resolveBanterPair(events[2], events)).toBeNull();
  });

  test('unrelated event type -> null', () => {
    expect(resolveBanterPair({ type: 'dice_rolled', actor: '0', data: {} }, [])).toBeNull();
  });

  test('null event -> null', () => {
    expect(resolveBanterPair(null, [])).toBeNull();
  });
});

describe('banterSituationText', () => {
  test('duel: distinct first/second lines naming the OTHER party', () => {
    const { first, second } = banterSituationText('duel', 'Albert Victor', 'Lia Frost', {});
    expect(first).toContain('Lia Frost');
    expect(first).toContain('won');
    expect(second).toContain('Albert Victor');
    expect(second).toContain('lost');
  });

  test('trade: both sides reference completing a trade with the other', () => {
    const { first, second } = banterSituationText('trade', 'Albert Victor', 'Lia Frost', {});
    expect(first).toContain('Lia Frost');
    expect(second).toContain('Albert Victor');
  });

  test('auction: includes the real final bid amount from the event when present', () => {
    const event = { data: { amount: 275 } };
    const { first, second } = banterSituationText('auction', 'Albert Victor', 'Lia Frost', event);
    expect(first).toContain('$275');
    expect(second).toContain('$275');
  });

  test('auction: omits the amount clause gracefully when absent', () => {
    const { first } = banterSituationText('auction', 'Albert Victor', 'Lia Frost', {});
    expect(first).not.toContain('undefined');
    expect(first).not.toContain('null');
  });

  test('unknown situation -> empty strings, no throw', () => {
    expect(banterSituationText('mystery', 'A', 'B', {})).toEqual({ first: '', second: '' });
  });
});
