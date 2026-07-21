// src/__tests__/server-persuasion-gate.test.js
// MT2-SP5 direction C2 "舌战群儒", T4: server.js is the AUTHORITATIVE
// enforcement point for "persuasion disabled online in v1" (owner decision,
// docs/superpowers/specs/2026-07-18-dialogue-c-design.md open question 4) —
// the T3 client UI gate only hides buttons; an MCP seat is an online socket
// client too and could dispatch attemptPersuasion directly. server.js forces
// RULES.persuasion.enabled = false at boot unless MEINOPOLY_PERSUASION=1.
//
// Same "requiring server.js with an env var set mutates the real singleton"
// pattern src/__tests__/log-capped-storage.test.js already pins for
// MEINOPOLY_MATCH_LOG_CAP — jest.isolateModules gives server.js (and every
// module IT requires, including mods/active-rules transitively via
// src/Game.js) a fresh, private module registry per test, so re-requiring
// '../../mods/active-rules' INSIDE the same isolateModules callback resolves
// to the exact instance server.js just mutated (a plain top-of-file `import`
// would instead resolve against jest's OUTER registry — a different object).
describe('server.js wires MEINOPOLY_PERSUASION into the live RULES singleton', () => {
  const saved = {
    MEINOPOLY_PERSUASION: process.env.MEINOPOLY_PERSUASION,
    MOD: process.env.MOD,
    MAP: process.env.MAP,
  };
  afterEach(() => {
    Object.keys(saved).forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  function requireServerAndRules() {
    let RULES;
    jest.isolateModules(() => {
      require('../../server.js');
      ({ RULES } = require('../../mods/active-rules'));
    });
    return RULES;
  }

  test('default (MEINOPOLY_PERSUASION unset): boot forces RULES.persuasion.enabled = false', () => {
    delete process.env.MEINOPOLY_PERSUASION;
    delete process.env.MOD;
    delete process.env.MAP;
    const RULES = requireServerAndRules();
    expect(RULES.persuasion.enabled).toBe(false);
  });

  test('MEINOPOLY_PERSUASION=1 opts back in: RULES.persuasion.enabled stays true', () => {
    process.env.MEINOPOLY_PERSUASION = '1';
    delete process.env.MOD;
    delete process.env.MAP;
    const RULES = requireServerAndRules();
    expect(RULES.persuasion.enabled).toBe(true);
  });

  test('any other value (e.g. "true") does NOT count as opted in — stays disabled', () => {
    process.env.MEINOPOLY_PERSUASION = 'true';
    delete process.env.MOD;
    const RULES = requireServerAndRules();
    expect(RULES.persuasion.enabled).toBe(false);
  });

  test('MOD= switch (setActiveMod reseeds RULES.persuasion from the mod default) still ends up disabled — the gate runs AFTER mod activation', () => {
    delete process.env.MEINOPOLY_PERSUASION;
    process.env.MOD = 'terra-titans';
    const RULES = requireServerAndRules();
    // terra-titans inherits dominion's persuasion block verbatim (enabled:
    // true) — proving the gate, not a mod default, is what flips this false.
    expect(RULES.persuasion.enabled).toBe(false);
  });

  test('MOD= switch + MEINOPOLY_PERSUASION=1 together stay enabled', () => {
    process.env.MEINOPOLY_PERSUASION = '1';
    process.env.MOD = 'terra-titans';
    const RULES = requireServerAndRules();
    expect(RULES.persuasion.enabled).toBe(true);
  });

  test('the engine itself now rejects attemptPersuasion when the gate is on (real enforcement, not just a flag)', () => {
    delete process.env.MEINOPOLY_PERSUASION;
    delete process.env.MOD;
    delete process.env.MAP;
    let Monopoly, RULES, INVALID_MOVE;
    jest.isolateModules(() => {
      require('../../server.js');
      ({ Monopoly } = require('../../src/Game'));
      ({ RULES } = require('../../mods/active-rules'));
      ({ INVALID_MOVE } = require('boardgame.io/core'));
    });
    expect(RULES.persuasion.enabled).toBe(false);
    const ctx = { currentPlayer: '0', numPlayers: 2, random: { Number: () => 0.5 } };
    const G = Monopoly.setup(ctx);
    G.phase = 'play';
    G.players[0].character = { stats: { charisma: 5 } };
    G.players[1].character = { stats: { charisma: 5 } };
    G.lastRentPayment = { payerSeat: '0', ownerSeat: '1', amount: 100, turn: G.totalTurns };
    expect(Monopoly.moves.attemptPersuasion(G, ctx, 'rent', '1', 'please', undefined)).toBe(INVALID_MOVE);
  });
});
