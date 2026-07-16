// src/__tests__/i18n-log.test.js — Task 4: event-driven, locale-aware log.
//
// Three groups of tests:
//   1. EN PARITY (TDD-first, per task-4-brief.md): replaying every golden
//      scenario's script and, at EVERY step, reconstructing that step's
//      G.messages window from the (never-reset) G.events accumulated so far
//      — rendered via formatLogLine(..., 'en', ...) — must reproduce that
//      step's actual G.messages snapshot exactly
//      (src/__tests__/fixtures/golden-messages.json). This is the proof
//      that swapping the drawer's render SOURCE from G.messages to G.events
//      is lossless before zh even enters the picture. See
//      runScenario/expectedWindow below for why this is a per-STEP
//      reconstruction rather than a flattened full-history diff.
//   2. zh COVERAGE + INTERPOLATION + NULL-PARITY: every one of events.js's
//      42 registered event types has a zh formatter (or is a documented
//      always-null type); a handful of representative zh lines are asserted
//      verbatim; every EN-null case (event-only types, conditional nulls)
//      stays null in zh too; an unknown/future type falls back to the EN
//      formatter rather than blanking.
//   3. logLineKind (visual classification) sanity: spot-checks against the
//      legacy TEXT-regex classification for every line the golden fixtures
//      actually produce (the thing App.js used to compute from rendered
//      text — now computed from event type+data instead).
//
// SCENARIOS below is a deliberate, verbatim duplication of the scenario
// scripts in golden-messages.test.js (not imported — that file is untouched
// per the task brief's "golden fixtures: DO NOT TOUCH", and doesn't export
// them anyway). Duplication is intentional: it's the only way to get the
// REAL G.events for a REAL replay of each golden scenario without touching
// the protected test/fixture. makeClient/playScript/ifCanBuy/ifPendingCard
// are imported unmodified from helpers/drive.js (already exported, not
// protected) — this file adds zero exports there.
import fixture from './fixtures/golden-messages.json';
import {
  makeClient, ifCanBuy, ifPendingCard,
} from './helpers/drive';
import { ENGINE_EVENTS, formatEventMessage } from '../events';
import {
  formatLogLine, renderLogLines, logLineKind, _ZH_FORMATTERS,
} from '../i18n-log';

// --- Scenario-specific dynamic steps (verbatim copy — see file header) ----

function proposeForProperty(pid) {
  return (client) => {
    const owner = client.getState().G.ownership[pid];
    if (owner !== '0' && owner !== null && owner !== undefined) {
      client.moves.proposeTrade({
        targetPlayerId: owner, offeredProperties: [], requestedProperties: [pid],
        offeredMoney: 100, requestedMoney: 0,
      });
    }
  };
}
function acceptIfTrade(client) {
  if (client.getState().G.trade) client.moves.acceptTrade();
}

function drainToOneDollar(client) {
  const m = client.getState().G.players[0].money;
  client.moves.proposeTrade({
    targetPlayerId: '1', offeredProperties: [], requestedProperties: [],
    offeredMoney: m - 1, requestedMoney: 0,
  });
}

function round() {
  return [['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn']];
}

function propose(targetPlayerId, offeredMoney) {
  return (client) => client.moves.proposeTrade({
    targetPlayerId, offeredProperties: [], requestedProperties: [],
    offeredMoney, requestedMoney: 0,
  });
}

const SCENARIOS = {
  'two-turn-roll-buy': {
    seed: 1,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ['buyProperty'],
      ['endTurn'],
      ['rollDice'],
    ],
  },

  'rent-and-tax': {
    seed: 96,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ['buyProperty'],
      ['endTurn'],
      ['rollDice'],
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      ['endTurn'],
      ...round(), ...round(), ...round(), ...round(), ...round(), ...round(),
      ['rollDice'],
    ],
  },

  'card-draw-accept': {
    seed: 14,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'lia-startrace'],
      ['selectCharacter', 'renn-chainbreaker'],
      ['rollDice'],
      ['acceptCard'],
      ['endTurn'],
      ['rollDice'],
    ],
  },

  'card-redraw': {
    seed: 14,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'lia-startrace'],
      ['selectCharacter', 'renn-chainbreaker'],
      ['rollDice'],
      ['redrawCard'],
      ['endTurn'],
      ['rollDice'],
    ],
  },

  'jail-cycle': {
    seed: 34,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'knox-ironlaw'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ifPendingCard('acceptCard'),
      ['endTurn'],
      ['rollDice'],
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      ['endTurn'],
      ['payJailFine'],
      ['rollDice'],
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      ['endTurn'],
    ],
  },

  'build-mortgage': {
    seed: 72,
    numPlayers: 3,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['selectCharacter', 'knox-ironlaw'],
      ['rollDice'], ifCanBuy('buyProperty'), ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'),
      proposeForProperty(6), acceptIfTrade,
      proposeForProperty(8), acceptIfTrade,
      proposeForProperty(9), acceptIfTrade,
      ['mortgageProperty', 9],
      ['unmortgageProperty', 9],
      ['upgradeProperty', 6],
      ['sellBuilding', 6],
    ],
  },

  'auction-lifecycle': {
    seed: 1,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ['passProperty'],
      ['placeBid', 2],
      ['passAuction'],
      ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn'],
      ['rollDice'],
      ['passProperty'],
      ['passAuction'],
      ['passAuction'],
    ],
  },

  bankruptcy: {
    seed: 25,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      drainToOneDollar,
      ['acceptTrade'],
      ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn'],
      ['rollDice'],
    ],
  },

  'season-change': {
    seed: 1,
    numPlayers: 2,
    script: (() => {
      const steps = [['selectCharacter', 'marcus-grayline'], ['selectCharacter', 'sophia-ember']];
      for (let i = 0; i < 9; i++) steps.push(...round());
      return steps;
    })(),
  },

  'trade-lifecycle': {
    seed: 1,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      propose('1', 50),
      ['rejectTrade'],
      propose('1', 50),
      ['acceptTrade'],
      propose('1', 50),
      ['cancelTrade'],
    ],
  },
};

// --- Per-step G.events -> G.messages window reconstruction ----------------
//
// G.messages is a PER-TURN RESET BUFFER (events.js): resetMessages() clears
// it at specific points (start of every roll, payJailFine, the last
// character_selected's all-selected transition), and only what's logged
// AFTER the most recent reset survives into the next snapshot. G.events is
// append-only and never resets, so it is a strict SUPERSET of what any
// G.messages snapshot ever showed — one concrete case: the LAST player's own
// "joins the game" line is logged as an event, then immediately wiped by the
// same-move resetMessages() call before the all-selected transition line is
// logged (see events.js's character_selected case comment), so it never
// survives into any G.messages snapshot at all, even though the event
// itself is permanently in G.events.
//
// So "byte parity" is proven per SNAPSHOT STEP, not via a flattened
// full-history diff: at step i, render ALL events accumulated so far
// (events[0 .. eventCounts[i])) through formatLogLine and filter nulls, then
// take the trailing K lines where K = that step's G.messages length — this
// reconstructs exactly what G.messages held at that instant, because every
// reset boundary in Game.js is immediately followed by the logEvent call(s)
// that repopulate the buffer, so "current buffer contents" is always
// exactly "the last K message-producing events so far".
//
// One documented, permanent exception: setup() seeds G.messages with a
// single static line, 'Select your characters!' (src/Game.js), directly —
// NOT via logEvent/formatEventMessage — so it has no event equivalent.
// expectedWindow() strips it before comparing. It's also never actually
// visible in the real drawer (App.js only calls renderMessages once
// G.phase leaves 'characterSelect' — by then this seed line has long since
// been reset away), so excluding it here costs nothing real.
function expectedWindow(snapshot) {
  return snapshot[0] === 'Select your characters!' ? snapshot.slice(1) : snapshot;
}

// Drives `script` against a fresh client, capturing G.messages (for the
// golden-fixture sanity check) AND the cumulative G.events COUNT after every
// step (the boundary needed to reconstruct that step's message window from
// the final G.events array). Deliberately NOT importing playScript for the
// events half — messages capture is duplicated (2 lines) so both snapshot
// arrays come from the exact same dispatch loop, in lockstep, guaranteed.
function runScenario(def) {
  const client = makeClient(def.numPlayers, def.seed);
  const snapshots = [];
  const eventCounts = [];
  for (const step of def.script) {
    if (typeof step === 'function') {
      step(client);
    } else {
      const [name, ...args] = step;
      client.moves[name](...args);
    }
    const G = client.getState().G;
    snapshots.push(JSON.parse(JSON.stringify(G.messages)));
    eventCounts.push(G.events.length);
  }
  return { client, snapshots, eventCounts };
}

describe('i18n-log — EN parity against the golden fixtures', () => {
  test.each(Object.keys(SCENARIOS))('%s: event-rendered EN lines match G.messages at every step', (name) => {
    const def = SCENARIOS[name];
    const golden = fixture[name];
    expect(golden).toBeDefined();
    expect(def.seed).toBe(golden.seed);

    const { client, snapshots, eventCounts } = runScenario(def);
    // Sanity check: this file's duplicated script really does reproduce the
    // frozen golden-messages.json snapshots (i.e. the duplication above is
    // faithful) before trusting any per-step reconstruction built from it.
    expect(snapshots).toEqual(golden.snapshots);

    const G = client.getState().G; // final G — stable player/board data for rendering any historical event
    const finalEvents = G.events;
    snapshots.forEach((snapshot, i) => {
      const expected = expectedWindow(snapshot);
      const renderedSoFar = renderLogLines(finalEvents.slice(0, eventCounts[i]), 'en', G).map((l) => l.text);
      const actual = expected.length === 0 ? [] : renderedSoFar.slice(-expected.length);
      expect(actual).toEqual(expected);
    });
  });

  test('en formatLogLine delegates to the imported formatEventMessage (identity, not reimplementation)', () => {
    const { client } = runScenario(SCENARIOS['two-turn-roll-buy']);
    const G = client.getState().G;
    for (const ev of G.events) {
      expect(formatLogLine(ev, 'en', G)).toBe(formatEventMessage(ev.type, ev.actor, ev.data, G));
    }
  });
});

describe('i18n-log — zh coverage', () => {
  test('ZH_FORMATTERS has an entry for every one of the 42 registered engine event types', () => {
    const types = Object.keys(ENGINE_EVENTS);
    expect(types.length).toBe(42);
    types.forEach((type) => {
      expect(_ZH_FORMATTERS).toHaveProperty(type);
      expect(typeof _ZH_FORMATTERS[type]).toBe('function');
    });
  });

  test('an event type absent from ZH_FORMATTERS falls back to the EN formatter (forward-compat)', () => {
    const saved = _ZH_FORMATTERS.dice_rolled;
    delete _ZH_FORMATTERS.dice_rolled;
    try {
      const G = { players: [{ character: { name: 'Test Player' } }] };
      const ev = { type: 'dice_rolled', actor: '0', data: { d1: 3, d2: 4, total: 7 } };
      const zhResult = formatLogLine(ev, 'zh', G);
      const enResult = formatEventMessage('dice_rolled', '0', ev.data, G);
      expect(zhResult).toBe(enResult);
      expect(zhResult).toBe('Test Player rolled 3 + 4 = 7');
    } finally {
      _ZH_FORMATTERS.dice_rolled = saved;
    }
  });
});

describe('i18n-log — zh null-parity (event-only / conditionally-null types)', () => {
  const G = {
    players: [{ id: '0', character: { name: 'Marcus Grayline' } }],
    board: { spaces: [{ name: 'Reading Railroad' }] },
  };

  test.each([
    ['route_committed', '0', {}],
    ['game_over', null, {}],
    ['duel_offered', '0', { propertyId: 0, ownerId: '1', rent: 10 }],
    ['went_to_jail', '0', { reason: 'card' }],
    ['landing_notice', '0', { note: 'some_future_note', propertyId: 0 }],
    ['card_applied', '0', { deck: 'chance', cardIndex: 0, action: 'gain', effect: { amount: 50 } }],
    ['card_applied', '0', { deck: 'chance', cardIndex: 0, action: 'pay', effect: { amount: 50 } }],
    ['card_applied', '0', { deck: 'chance', cardIndex: 0, action: 'moveTo', effect: {} }],
    ['card_applied', '0', { deck: 'chance', cardIndex: 0, action: 'goToJail', effect: {} }],
    ['passive_triggered', '0', { passive: 'enforcer', effect: 'something_else' }],
  ])('%s is null in both en and zh for this data', (type, actor, data) => {
    const ev = { type, actor, data };
    expect(formatLogLine(ev, 'en', G)).toBeNull();
    expect(formatLogLine(ev, 'zh', G)).toBeNull();
  });
});

describe('i18n-log — zh interpolation (representative sample)', () => {
  const G = {
    players: [
      { id: '0', character: { name: 'Marcus Grayline' } },
      { id: '1', character: { name: 'Sophia Ember' } },
    ],
    board: {
      spaces: { 5: { name: 'Reading Railroad' } },
      chanceCards: [{ text: 'Advance to Illinois Ave.', action: 'moveTo' }],
    },
  };

  test('dice_rolled', () => {
    const ev = { type: 'dice_rolled', actor: '0', data: { d1: 4, d2: 1, total: 5 } };
    expect(formatLogLine(ev, 'zh', G)).toBe('Marcus Grayline 掷出 4 + 1 = 5');
  });

  test('property_bought', () => {
    const ev = { type: 'property_bought', actor: '0', data: { propertyId: 5, paidPrice: 186 } };
    expect(formatLogLine(ev, 'zh', G)).toBe('以 $186 买下 Reading Railroad！');
  });

  test('rent_paid', () => {
    const ev = { type: 'rent_paid', actor: '1', data: { propertyId: 5, ownerId: '0', amount: 12 } };
    expect(formatLogLine(ev, 'zh', G)).toBe('向 Marcus Grayline 支付 Reading Railroad 租金 $12。');
  });

  test('tax_paid', () => {
    const spaces = { 6: { name: 'Luxury Tax' } };
    const g2 = { ...G, board: { ...G.board, spaces } };
    const ev = { type: 'tax_paid', actor: '0', data: { spaceId: 6, amount: 85 } };
    expect(formatLogLine(ev, 'zh', g2)).toBe('缴纳 Luxury Tax：$85。');
  });

  test('bankruptcy', () => {
    const ev = { type: 'bankruptcy', actor: '0', data: { creditorId: null } };
    expect(formatLogLine(ev, 'zh', G)).toBe('Marcus Grayline 破产了！');
  });

  test('trade_proposed', () => {
    const ev = { type: 'trade_proposed', actor: '0', data: { targetPlayerId: '1' } };
    expect(formatLogLine(ev, 'zh', G)).toBe('Marcus Grayline 向 Sophia Ember 提议交易！');
  });

  test('card_drawn (deck label localized, card body text stays EN)', () => {
    const ev = { type: 'card_drawn', actor: '0', data: { deck: 'chance', cardIndex: 0, text: 'Advance to Illinois Ave.' } };
    expect(formatLogLine(ev, 'zh', G)).toBe('机变：Advance to Illinois Ave.');
  });

  test('auction_ended (winner)', () => {
    const ev = { type: 'auction_ended', actor: null, data: { propertyId: 5, winnerId: '0', amount: 2 } };
    expect(formatLogLine(ev, 'zh', G)).toBe('Marcus Grayline 以 $2 拍得 Reading Railroad！');
  });

  test('auction_ended (no bids)', () => {
    const ev = { type: 'auction_ended', actor: null, data: { propertyId: 5, winnerId: null, amount: 0 } };
    expect(formatLogLine(ev, 'zh', G)).toBe('无人出价。Reading Railroad 仍未被认领。');
  });
});

describe('i18n-log — locale threading (post-merge ticket #5: formatLogLine must not depend on the ambient i18n global)', () => {
  // deckLabelZh/season_changed's seasonNameZh used to call the bare t()/t(key), which reads
  // the i18n module's CURRENT global locale — not the `locale` argument the caller (and
  // formatLogLine's own 'zh' branch guard) already committed to. These two formatters are
  // the only ZH_FORMATTERS entries that call t() at all, so they're the only ones this bug
  // could ever affect. Proof: flip the GLOBAL i18n locale to 'en' first, then ask
  // formatLogLine for a 'zh' render — every word must still be zh, none of the deck/season
  // labels should leak the (currently-global) EN strings in.
  const { setLocale, getLocale } = require('../i18n');
  const prevLocale = getLocale();

  afterEach(() => {
    setLocale(prevLocale); // this test file shares one i18n module instance — restore it
  });

  const G = {
    players: [{ id: '0', character: { name: 'Marcus Grayline' } }],
    board: { spaces: {} },
  };

  test('card_drawn: zh deck label survives even while the global locale is en', () => {
    setLocale('en');
    const ev = { type: 'card_drawn', actor: '0', data: { deck: 'chance', text: 'Advance to Illinois Ave.' } };
    expect(formatLogLine(ev, 'zh', G)).toBe('机变：Advance to Illinois Ave.');
  });

  test('card_redrawn: zh deck label survives even while the global locale is en', () => {
    setLocale('en');
    const ev = { type: 'card_redrawn', actor: '0', data: { deck: 'community', newText: 'Bank error in your favor.' } };
    expect(formatLogLine(ev, 'zh', G)).toBe('重抽！命运：Bank error in your favor.');
  });

  test('season_changed: zh season name survives even while the global locale is en', () => {
    setLocale('en');
    const ev = { type: 'season_changed', actor: null, data: { seasonIndex: 0 } };
    const result = formatLogLine(ev, 'zh', G);
    expect(result).toContain('夏季'); // RULES.seasons.list[0] is summer; zh name via i18n
    expect(result).not.toMatch(/[A-Za-z]/); // no stray EN letters leaked from the global locale
  });

  test('conversely, an en render is unaffected by the global locale being zh (en path never calls t())', () => {
    setLocale('zh');
    const ev = { type: 'card_drawn', actor: '0', data: { deck: 'chance', text: 'Advance to Illinois Ave.' } };
    expect(formatLogLine(ev, 'en', G)).toBe(formatEventMessage('card_drawn', '0', ev.data, G));
  });
});

describe('i18n-log — logLineKind visual classification', () => {
  const G = {
    players: [
      { id: '0', character: { name: 'Marcus Grayline' } },
      { id: '1', character: { name: 'Sophia Ember' } },
    ],
    board: {
      spaces: { 5: { name: 'Reading Railroad' } },
      chanceCards: [
        { text: 'Advance to Illinois Ave.', action: 'moveTo' },
        { text: 'Black Swan Event! Pay 10% of your total assets.', action: 'payPercent' },
        { text: 'Go to Jail. Do not pass GO.', action: 'goToJail' },
        { text: "Hostile Takeover! Force-buy an opponent's cheapest property at 150% price.", action: 'forceBuy' },
      ],
      communityCards: [
        { text: 'Bank error in your favor. Collect $200.', action: 'gain' },
      ],
    },
  };

  // One row per golden-fixture-covered line + its legacy (regex-computed)
  // class — proves the new type+data classification reproduces the old
  // text-regex classification for every line the golden scenarios actually
  // render in EN.
  test.each([
    ['property_bought', { propertyId: 5, paidPrice: 186 }, 'good'],
    ['rent_paid', { propertyId: 5, ownerId: '0', amount: 12 }, 'bad'],
    ['tax_paid', { spaceId: 5, amount: 85 }, 'bad'],
    ['bankruptcy', { creditorId: null }, 'bad'],
    ['trade_proposed', { targetPlayerId: '1' }, 'neutral'],
    ['trade_accepted', { proposerId: '0' }, 'neutral'],
    ['trade_rejected', {}, 'neutral'],
    ['trade_cancelled', {}, 'neutral'],
    ['auction_started', { propertyId: 5 }, 'neutral'],
    ['auction_turn', { bidderId: '0' }, 'neutral'],
    ['bid_placed', { amount: 2 }, 'neutral'],
    ['auction_passed', {}, 'neutral'],
    ['auction_ended', { propertyId: 5, winnerId: '0', amount: 2 }, 'good'],
    ['auction_ended', { propertyId: 5, winnerId: null, amount: 0 }, 'neutral'],
    ['property_mortgaged', { propertyId: 5, amount: 60 }, 'neutral'],
    ['property_unmortgaged', { propertyId: 5, cost: 66 }, 'neutral'],
    ['property_upgraded', { propertyId: 5, newLevelName: 'House', cost: 46 }, 'neutral'],
    ['building_sold', { propertyId: 5, newLevel: 0, refund: 23 }, 'neutral'],
    ['character_selected', { money: 1800, affinityBonus: 0 }, 'neutral'],
    ['dice_rolled', { d1: 4, d2: 1, total: 5 }, 'neutral'],
    ['moved', { from: 0, to: 5 }, 'neutral'],
    ['landing_notice', { note: 'available', propertyId: 5, listPrice: 200, effectivePrice: 186 }, 'neutral'],
    ['landing_notice', { note: 'parking_relax' }, 'neutral'],
    ['landing_notice', { note: 'visiting_jail' }, 'bad'], // legacy quirk, golden-covered — preserved
    ['salary_collected', { source: 'go', amount: 200 }, 'good'],
    ['jail_reminder', { fine: 50 }, 'bad'],
    ['jail_fine_paid', { fine: 50, failed: false }, 'bad'],
    ['season_changed', { seasonIndex: 1 }, 'neutral'],
    ['card_prompt', { deck: 'chance', cardIndex: 0 }, 'neutral'],
    ['card_applied', { action: 'payPercent', effect: { assets: 1750, amount: 143, percent: 10 } }, 'bad'],
    ['card_applied', { action: 'forceBuy', effect: { outcome: 'no_opponents' } }, 'neutral'],
    ['card_drawn', { deck: 'chance', cardIndex: 0, text: 'Advance to Illinois Ave.' }, 'neutral'],
    ['card_drawn', { deck: 'chance', cardIndex: 1, text: 'Black Swan Event! Pay 10% of your total assets.' }, 'bad'],
    ['card_drawn', { deck: 'chance', cardIndex: 2, text: 'Go to Jail. Do not pass GO.' }, 'bad'],
    ['card_drawn', { deck: 'chance', cardIndex: 3, text: "Hostile Takeover! Force-buy an opponent's cheapest property at 150% price." }, 'neutral'],
    ['card_drawn', { deck: 'community', cardIndex: 0, text: 'Bank error in your favor. Collect $200.' }, 'good'],
    ['card_redrawn', { deck: 'chance', cardIndex: 3, newText: "Hostile Takeover! Force-buy an opponent's cheapest property at 150% price." }, 'neutral'],
    ['passive_triggered', { passive: 'arbitrageur', effect: 'bankruptcy_bonus', amount: 100 }, 'neutral'],
  ])('%s %j -> %s', (type, data, expectedKind) => {
    const ev = { type, actor: '0', data };
    expect(logLineKind(ev, G)).toBe(expectedKind);
  });
});
