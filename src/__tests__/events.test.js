import { ENGINE_EVENTS, logEvent, resetMessages, formatEventMessage } from '../events';

// players: minimal stub so real formatter branches (added by the migration
// tasks) can resolve `G.players[actor]` for playerName lookups without
// throwing — this fixture predates any real branch (Task 1 wrote it when
// formatEventMessage always returned null).
const freshG = () => ({ events: [], eventSeq: 0, messages: [], totalTurns: 3, players: [{ id: '0' }, { id: '1' }] });

describe('logEvent', () => {
  test('appends event with seq/turn and (when formatter knows the type) a message', () => {
    const G = freshG();
    logEvent(G, 'dice_rolled', '0', { d1: 2, d2: 5, total: 7, doubles: false });
    expect(G.events).toHaveLength(1);
    expect(G.events[0]).toMatchObject({ seq: 0, turn: 3, type: 'dice_rolled', actor: '0' });
    expect(G.eventSeq).toBe(1);
  });
  test('event-only types (formatter null) add no message line', () => {
    const G = freshG();
    logEvent(G, 'game_over', null, { result: { winner: '1' } });
    expect(G.events).toHaveLength(1);
    expect(G.messages).toHaveLength(0);
  });
  test('cap trims from the front, seq keeps climbing', () => {
    const G = freshG();
    for (let i = 0; i < 250; i++) logEvent(G, 'reroll_used', '0', {});
    expect(G.events.length).toBe(200);
    expect(G.events[0].seq).toBe(50);
    expect(G.events[199].seq).toBe(249);
    expect(G.eventSeq).toBe(250);
  });
  test('unknown type throws (registry is closed)', () => {
    expect(() => logEvent(freshG(), 'nonsense_type', '0', {})).toThrow(/nonsense_type/);
  });

  // Final-review Fix 3: a bracket read (ENGINE_EVENTS[type]) resolves
  // prototype-name types like 'toString' to an inherited, truthy
  // Object.prototype function, which would silently skip the throw. The
  // registry check must use hasOwnProperty so these still throw.
  test("'toString' throws (prototype-name types are not silently accepted)", () => {
    expect(() => logEvent(freshG(), 'toString', '0', {})).toThrow(/toString/);
  });
});

describe('resetMessages', () => {
  test('clears messages, leaves events/eventSeq untouched', () => {
    const G = freshG();
    logEvent(G, 'reroll_used', '0', {});
    G.messages.push('old line');
    resetMessages(G);
    expect(G.messages).toEqual([]);
    expect(G.events).toHaveLength(1);
    expect(G.eventSeq).toBe(1);
  });
});

describe('ENGINE_EVENTS registry', () => {
  test('contains the 44 spec types and is frozen', () => {
    expect(Object.keys(ENGINE_EVENTS)).toHaveLength(44);
    expect(ENGINE_EVENTS.dice_rolled).toBe('dice_rolled');
    expect(ENGINE_EVENTS.jail_reminder).toBe('jail_reminder');
    expect(ENGINE_EVENTS.duel_offered).toBe('duel_offered');
    expect(ENGINE_EVENTS.duel_initiated).toBe('duel_initiated');
    expect(ENGINE_EVENTS.duel_declined).toBe('duel_declined');
    expect(ENGINE_EVENTS.duel_resolved).toBe('duel_resolved');
    // MT2-SP5 direction C2, T1 (persuasion engine move).
    expect(ENGINE_EVENTS.persuasion_attempted).toBe('persuasion_attempted');
    expect(ENGINE_EVENTS.persuasion_resolved).toBe('persuasion_resolved');
    expect(Object.isFrozen(ENGINE_EVENTS)).toBe(true);
  });
});

describe('formatEventMessage for duel events', () => {
  const duelG = () => ({
    events: [],
    eventSeq: 0,
    messages: [],
    totalTurns: 3,
    players: [
      { id: '0', character: { name: 'Character A' } },
      { id: '1', character: { name: 'Character B' } },
    ],
    board: {
      spaces: [
        { id: 0, name: 'Space 0' },
        { id: 1, name: 'Property 1' },
      ],
    },
  });

  test('duel_offered returns null (UI prompt, not logged)', () => {
    const G = duelG();
    const msg = formatEventMessage('duel_offered', '0', {}, G);
    expect(msg).toBeNull();
  });

  test('duel_initiated formats challenger vs owner for property', () => {
    const G = duelG();
    const msg = formatEventMessage('duel_initiated', '0', { ownerId: '1', propertyId: 1 }, G);
    expect(msg).toBe('Character A challenges Character B to a duel for Property 1!');
  });

  test('duel_declined formats owner declining', () => {
    const G = duelG();
    const msg = formatEventMessage('duel_declined', '1', {}, G);
    expect(msg).toBe('Character B declines the duel.');
  });

  test('duel_resolved formats challenger vs owner with winner and rolls', () => {
    const G = duelG();
    const msg = formatEventMessage('duel_resolved', '0', {
      ownerId: '1',
      winnerId: '0',
      challengerRoll: { total: 8 },
      defenderRoll: { total: 5 },
    }, G);
    expect(msg).toBe('Duel! Character A 8 vs Character B 5 — Character A wins!');
  });

  test('duel_resolved formats when defender wins', () => {
    const G = duelG();
    const msg = formatEventMessage('duel_resolved', '0', {
      ownerId: '1',
      winnerId: '1',
      challengerRoll: { total: 3 },
      defenderRoll: { total: 9 },
    }, G);
    expect(msg).toBe('Duel! Character A 3 vs Character B 9 — Character B wins!');
  });
});
