const { CharacterAI, EVENT_TYPES, VERBOSITY, mapEngineEventToAi, consumeNewEvents } = require('../character-ai');

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
});
