// Terra Titans event card decks — deck validity + balance probe (ticket A2).
//
// Ticket A2: the terra-titans atlas world shipped with NO `world.cards`, so
// src/world-loader.js's loadWorld() fell back to `cards.chance || []` /
// `cards.community || []` — every chance/community landing on the live board
// silently no-op'd (`card_drawn` logged `empty:true`). The fix lives on
// TERRA_TITANS.cards in mods/dominion/atlas/worlds/terra-titans.js (imports
// the 28 hand-written base cards from mods/terra-titans/cards.js and appends
// one dynamically-resolved moveTo hub-teleport card per deck). This file
// verifies: (1) the fix actually closes the empty:true no-op on the REAL
// terra-titans board, (2) every card's action is one applyCard actually
// implements, (3) every moveTo target is a valid, in-range, hub space, (4)
// card values are finite/positive as appropriate for their action, and (5)
// every one of the 30 cards applies through the real engine reducer without
// throwing (a structural smoke test across all represented action types).
import { Monopoly, setActiveMap } from '../Game';
import { loadWorld } from '../world-loader';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import {
  TERRA_TITANS, TERRA_CHANCE_CARDS, TERRA_COMMUNITY_CARDS,
} from '../../mods/dominion/atlas/worlds/terra-titans';
import { terraTitansData } from '../../mods/terra-titans/bundle.data';
import { CHANCE_CARDS as BASE_CHANCE_CARDS, COMMUNITY_CARDS as BASE_COMMUNITY_CARDS } from '../../mods/terra-titans/cards';

// Mirrors src/Game.js applyCard's switch statement (lines ~769-1014) — the
// AUTHORITATIVE list of actions the engine actually implements. An action
// outside this set is not a crash (applyCard's switch has no default case,
// so an unknown action silently no-ops) — hence this explicit allowlist
// rather than relying on "did it throw".
const APPLYCARD_SUPPORTED_ACTIONS = [
  'gain', 'pay', 'moveTo', 'goToJail', 'payPercent',
  'gainAll', 'gainPerProperty', 'freeUpgrade', 'downgrade', 'forceBuy',
];

// boardgame.io v0.45 positional API — same helpers as atlas-engine.test.js.
function makeCtx(diceQueue, currentPlayer = '0') {
  const q = diceQueue.slice();
  return {
    currentPlayer,
    numPlayers: 2,
    random: { Number: () => (q.length ? q.shift() : 0.0) },
    events: { endTurn: () => {} },
  };
}
function dice(d1, d2) { return [(d1 - 1) / 6 + 0.01, (d2 - 1) / 6 + 0.01]; }

function terraG() {
  setActiveMap(loadWorld(TERRA_TITANS, ARCHETYPES));
  const G = Monopoly.setup({ numPlayers: 2, playOrder: ['0', '1'] });
  G.phase = 'play';
  return G;
}

const ALL_CARDS = TERRA_CHANCE_CARDS.map(c => ({ ...c, deck: 'chance' }))
  .concat(TERRA_COMMUNITY_CARDS.map(c => ({ ...c, deck: 'community' })));

describe('Terra Titans event card decks: content shape', () => {
  test('each deck ships 14-16 cards (spec: ~14-16 per deck)', () => {
    expect(TERRA_CHANCE_CARDS.length).toBeGreaterThanOrEqual(14);
    expect(TERRA_CHANCE_CARDS.length).toBeLessThanOrEqual(16);
    expect(TERRA_COMMUNITY_CARDS.length).toBeGreaterThanOrEqual(14);
    expect(TERRA_COMMUNITY_CARDS.length).toBeLessThanOrEqual(16);
  });

  test('every card action is one applyCard actually supports', () => {
    for (const c of ALL_CARDS) {
      expect(APPLYCARD_SUPPORTED_ACTIONS).toContain(c.action);
    }
  });

  test('card texts are non-empty, unique English one-liners per deck', () => {
    for (const deck of [TERRA_CHANCE_CARDS, TERRA_COMMUNITY_CARDS]) {
      const texts = deck.map(c => c.text);
      for (const t of texts) {
        expect(typeof t).toBe('string');
        expect(t.length).toBeGreaterThan(10);
      }
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  test('gain/gainAll/gainPerProperty values are finite positive numbers', () => {
    for (const c of ALL_CARDS) {
      if (['gain', 'gainAll', 'gainPerProperty'].includes(c.action)) {
        expect(Number.isFinite(c.value)).toBe(true);
        expect(c.value).toBeGreaterThan(0);
      }
    }
  });

  test('pay values are finite positive numbers', () => {
    for (const c of ALL_CARDS) {
      if (c.action === 'pay') {
        expect(Number.isFinite(c.value)).toBe(true);
        expect(c.value).toBeGreaterThan(0);
      }
    }
  });

  test('payPercent values are a sane 1-100 percent', () => {
    for (const c of ALL_CARDS) {
      if (c.action === 'payPercent') {
        expect(c.value).toBeGreaterThan(0);
        expect(c.value).toBeLessThanOrEqual(100);
      }
    }
  });

  test('forceBuy value is a percent premium (>= 100, matching Dominion convention)', () => {
    for (const c of ALL_CARDS) {
      if (c.action === 'forceBuy') {
        expect(c.value).toBeGreaterThanOrEqual(100);
      }
    }
  });

  test('goToJail/freeUpgrade/downgrade carry value:0 (unused by applyCard for these actions)', () => {
    for (const c of ALL_CARDS) {
      if (['goToJail', 'freeUpgrade', 'downgrade'].includes(c.action)) {
        expect(c.value).toBe(0);
      }
    }
  });

  test('deck has a healthy mix of redraw-eligible (negative) and other cards', () => {
    // Mirrors src/Game.js's redraw-eligibility list (pay/payPercent/downgrade/goToJail —
    // see the 'canRedraw' checks in the chance/community handleLanding cases) and
    // src/dialogue/memory.js's comment confirming the same 4 actions are the only
    // grudge/redraw-relevant ones. A deck with none of these makes luck redraws inert;
    // an all-negative deck makes the game punishing. Assert a middle ground.
    const REDRAW_ELIGIBLE = ['pay', 'payPercent', 'downgrade', 'goToJail'];
    const negativeCount = ALL_CARDS.filter(c => REDRAW_ELIGIBLE.includes(c.action)).length;
    expect(negativeCount).toBeGreaterThanOrEqual(6);
    expect(negativeCount).toBeLessThanOrEqual(ALL_CARDS.length / 2);
  });
});

describe('Terra Titans event card decks: moveTo targets', () => {
  const mapData = loadWorld(TERRA_TITANS, ARCHETYPES);

  test('every moveTo target is a valid in-range space id', () => {
    const moveToCards = ALL_CARDS.filter(c => c.action === 'moveTo');
    expect(moveToCards.length).toBeGreaterThan(0);
    for (const c of moveToCards) {
      expect(Number.isInteger(c.value)).toBe(true);
      expect(c.value).toBeGreaterThanOrEqual(0);
      expect(c.value).toBeLessThan(mapData.spaceCount);
    }
  });

  test('every moveTo target used here is a HUB space (salary rule is exercised)', () => {
    const moveToCards = ALL_CARDS.filter(c => c.action === 'moveTo');
    for (const c of moveToCards) {
      expect(mapData.spaces[c.value].isHub).toBe(true);
    }
  });

  test('moveTo targets are resolved BY PLACE ID, not a hardcoded number — reordering PLACES would move the target with it', () => {
    // Cross-check against an INDEPENDENT loadWorld() call (not the module-level
    // ENTRY var terra-titans.js used to build these cards) — proves the two
    // computations agree, which is the whole point of resolving dynamically.
    const chanceMove = TERRA_CHANCE_CARDS.find(c => c.action === 'moveTo');
    const communityMove = TERRA_COMMUNITY_CARDS.find(c => c.action === 'moveTo');
    expect(mapData.spaces[chanceMove.value].placeId).toBe('london');
    expect(mapData.spaces[communityMove.value].placeId).toBe('shanghai');
  });
});

describe('Terra Titans event card decks: wired into the mod bundle', () => {
  test('the world object feeding real play carries the same non-empty decks', () => {
    expect(TERRA_TITANS.cards.chance).toBe(TERRA_CHANCE_CARDS);
    expect(TERRA_TITANS.cards.community).toBe(TERRA_COMMUNITY_CARDS);
  });

  test('terraTitansData (Tier-A mod bundle) exposes the same authored decks', () => {
    expect(terraTitansData.worlds[0].cards.chance.length).toBeGreaterThan(0);
    expect(terraTitansData.worlds[0].cards.community.length).toBeGreaterThan(0);
    // terraTitansData.cards.* is the "mod default board" field (see
    // bundle.data.js's header comment) — briefly installed by setActiveMod()
    // and immediately overwritten by setActiveMap(loadWorld(...)) on every
    // real terra-titans game (it registers no map.json boards). It sources
    // from the SAME mods/terra-titans/cards.js base arrays as the world's
    // resolved decks (minus the world-only moveTo card), so it should never
    // go stale/dominion-flavored again.
    expect(terraTitansData.cards.chance).toBe(BASE_CHANCE_CARDS);
    expect(terraTitansData.cards.community).toBe(BASE_COMMUNITY_CARDS);
  });
});

describe('Terra Titans event card decks: closes the empty:true no-op on the real board', () => {
  test('setActiveMap(loadWorld(TERRA_TITANS)) installs non-empty G.board.chanceCards/communityCards', () => {
    const G = terraG();
    expect(Array.isArray(G.board.chanceCards)).toBe(true);
    expect(Array.isArray(G.board.communityCards)).toBe(true);
    expect(G.board.chanceCards.length).toBe(TERRA_CHANCE_CARDS.length);
    expect(G.board.communityCards.length).toBe(TERRA_COMMUNITY_CARDS.length);
  });

  // Locates a REAL chance/community space on the production board, walks a
  // player onto it via rollDice (real move, real route), and asserts the
  // resulting card_drawn event is a genuine draw (empty:false, real text) —
  // this is the actual pre-fix bug (`card_drawn` logged `empty:true` and
  // handleLanding's chance/community case broke immediately, doing nothing).
  function driveOneRealDraw(roleType) {
    const G = terraG();
    const targetId = G.board.spaces.findIndex(s => s.type === roleType);
    expect(targetId).toBeGreaterThanOrEqual(0);
    // Every archetype that produces a chance/community slot puts it at
    // slotIndex 2 (see mods/dominion/atlas/archetypes.js — tech-hub, landmark,
    // wilderness -> chance; financial-district, capital-hub -> community, all
    // [property, property, {chance|community}]). Assert the invariant this
    // route-construction relies on, so a future archetype edit fails loudly
    // here instead of silently walking the wrong route.
    expect(G.board.spaces[targetId].slotIndex).toBe(2);
    const entryId = targetId - G.board.spaces[targetId].slotIndex;
    G.players[0].position = entryId;
    const route = [];
    for (let s = entryId + 1; s <= targetId; s++) route.push(s);
    expect(route.length).toBe(2); // dice(1,1) below must sum to this

    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), route);

    const drawn = G.events.filter(e => e.type === 'card_drawn');
    expect(drawn.length).toBe(1);
    expect(drawn[0].data.deck).toBe(roleType);
    expect(drawn[0].data.empty).toBeFalsy();
    expect(drawn[0].data.text).toBeTruthy();
    return { G, drawn: drawn[0] };
  }

  test('draws a real CHANCE card off the production board', () => {
    const { drawn } = driveOneRealDraw('chance');
    expect(TERRA_CHANCE_CARDS.map(c => c.text)).toContain(drawn.data.text);
  });

  test('draws a real COMMUNITY card off the production board', () => {
    const { drawn } = driveOneRealDraw('community');
    expect(TERRA_COMMUNITY_CARDS.map(c => c.text)).toContain(drawn.data.text);
  });
});

describe('Terra Titans event card decks: every card applies through the real engine', () => {
  test('all 30 cards apply via acceptCard without throwing or producing NaN money', () => {
    const G = terraG();
    // Provision both seats generously so every action branch has something to
    // act on: player0 owns a full 2-property place group (freeUpgrade target,
    // with one building pre-built so downgrade has something to remove) and
    // has a large money buffer (so pay/payPercent never bankrupts mid-loop);
    // player1 owns one property elsewhere (forceBuy's 'bought' outcome).
    const propertySpaces = G.board.spaces.filter(s => s.type === 'property');
    const groupPlaceId = propertySpaces[0].placeId;
    const groupIds = G.board.colorGroups[groupPlaceId];
    expect(groupIds.length).toBeGreaterThanOrEqual(2);
    groupIds.forEach(pid => {
      G.ownership[pid] = '0';
      G.players[0].properties.push(pid);
    });
    G.buildings[groupIds[0]] = 2; // something for 'downgrade' to remove

    const opponentProp = propertySpaces.find(s => !groupIds.includes(s.id));
    G.ownership[opponentProp.id] = '1';
    G.players[1].properties.push(opponentProp.id);

    G.players[0].money = 10_000_000;
    G.players[1].money = 10_000_000;

    const ctx = makeCtx([], '0');
    ALL_CARDS.forEach((card, i) => {
      G.pendingCard = { card, deck: card.deck, cardIndex: i };
      G.turnPhase = 'card';
      const result = Monopoly.moves.acceptCard(G, ctx);
      expect(result).not.toBe('INVALID_MOVE');
      G.players.forEach(p => {
        expect(Number.isFinite(p.money)).toBe(true);
      });
    });
  });
});
