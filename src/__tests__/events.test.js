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
  test('contains the 36 spec types and is frozen', () => {
    expect(Object.keys(ENGINE_EVENTS)).toHaveLength(36);
    expect(ENGINE_EVENTS.dice_rolled).toBe('dice_rolled');
    expect(Object.isFrozen(ENGINE_EVENTS)).toBe(true);
  });
});
