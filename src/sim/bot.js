// Atlas Balance Sim — greedy-developer bot (plan D3) + route strategies (D4).
//
// PURE decision logic: decideMoves(G, ctx, playerID, policy) returns an ORDERED
// list of move tuples (e.g. [['rollOnly'], ['commitRoute', route], ['buyProperty']])
// rather than dispatching them itself. The match runner dispatches each tuple
// through the Client and re-reads state between dispatches. This keeps the
// decider unit-testable against crafted G states with NO boardgame.io coupling.
//
// boardgame.io v0.45 OLD positional API: the engine moves are move(G, ctx, ...args);
// the bot mirrors that signature so test states match what the engine sees.
//
// All thresholds live in `policy` with sane defaults (CLAUDE.md: no inline magic
// numbers). decideMoves emits AT MOST ONE blocking-state resolution per call; the
// runner loops decideMoves each time it needs the next action, so a turn that
// rolls -> resolves card -> builds -> ends is several decideMoves calls.

import { routeChoices } from '../atlas-movement';
import { RULES } from '../../mods/active-rules';
import { isDuelCooldownBlocked } from '../events';
import { canAttempt } from '../persuasion/engine';

// Default greedy-developer policy. Every knob here is overridable per contestant
// via the `policy` arg so tournaments can vary aggression without code edits.
export const DEFAULT_POLICY = {
  // Keep this much cash untouched when deciding to buy / build (survival float).
  cashBuffer: 200,
  // Build (upgrade) only while money - cashBuffer >= upgradeCost * this. >1 makes
  // the bot hoard more before building; the default 1.0 builds as soon as affordable
  // above the buffer. This is the lever that ends the 4000-turn no-build marathons.
  buildAggression: 1.0,
  // Max fraction of a property's face value the bot will bid in an auction.
  auctionMaxFraction: 0.6,
  // Pay the jail fine to get moving again if money - cashBuffer covers the fine.
  payJailFine: true,
  // v1 keeps card resolution simple: always acceptCard (no redraw heuristic).
  useRedraws: false,
  // Route strategy on atlas forks: 'camper' | 'tourer' (D4). No-op on loop maps.
  routeStrategy: 'camper',
  // Challenger's response to a rent-duel offer (Task 7 of the duel mechanism;
  // no-op unless RULES.duel.enabled, so this default leaves every duel-free
  // sim run byte-identical): 'never' always pays rent (no duel ever offered
  // by this bot); 'always' always initiates (falling back to payRent only
  // when the challenger's cooldown blocks it — an INVALID_MOVE must never be
  // dispatched); 'strength' initiates only when the challenger's duel
  // strength (statPrimary + floor(statSecondary / secondaryDivisor), per
  // RULES.duel) strictly exceeds the owner's, else pays rent. Deliberately
  // named 'strength', not 'ev' — these are stat heuristics, not a true
  // expected-value calculation. The OWNER's fight-vs-decline response is
  // NOT gated by this knob (see duelDecision below): every policy value
  // must still answer sensibly when acting as the defender.
  duelPolicy: 'never',
  // MT2-SP5 direction C2 "舌战群儒", T4: bot-side attempt policy for the
  // persuasion seams the sim bot's own move walk ACTUALLY reaches —
  //   - rent refund (求情): rent auto-pays as part of movement resolution
  //     (Game.js handleLanding -> payRentAmount), zero bot move needed to
  //     open the window; decideMoves just has to notice G.lastRentPayment on
  //     the next call and decide whether to spend the attempt.
  //   - duel taunt (叫阵): only reachable when duelPolicy makes THIS bot the
  //     challenger who initiates (duelPolicy 'never' never opens this
  //     window for itself) — see duelDecision's 'response' branch.
  //   - trade lobby (游说): NOT implemented — the sim bot never calls
  //     proposeTrade at all (see decideMoves' priority list), so this seam
  //     is structurally unreachable and forcing it would be pure fiction.
  // 'never'    never attempts (default — existing sim runs are byte-
  //            identical unless a run opts in via --persuasion-policy,
  //            same convention as duelPolicy's own default-off).
  // 'always'   attempts whenever canAttempt allows.
  // 'valueful' attempts only when the estimated expected gain clears a
  //            small, fixed, RULES-INDEPENDENT bar (see
  //            VALUEFUL_MIN_EXPECTED_RENT_GAIN / VALUEFUL_MIN_DUEL_CHANCE
  //            below — bot-policy constants, not read from RULES).
  persuasionPolicy: 'never',
};

// === Persuasion (MT2-SP5 direction C2, T4) ===================================
// Keyless path ONLY — the sim never wires an LLM judge, so `score` is always
// omitted on every attemptPersuasion dispatch below (same keyless-only
// posture the whole sim already has for every other RNG-touching decision:
// deterministic via ctx.random, never an external call).

// 'valueful' bars — bot-policy constants, deliberately NOT read from RULES
// (the point is a fixed, portable heuristic the bot applies regardless of
// which mod's RULES.persuasion values are active).
export const VALUEFUL_MIN_EXPECTED_RENT_GAIN = 15; // dollars
export const VALUEFUL_MIN_DUEL_CHANCE = 0.5; // P(tier >= 1)

// P(tier >= 1) under the SAME keyless charisma-check cutpoints
// src/persuasion/engine.js's rollTier itself draws against — mirrors that
// math exactly WITHOUT consuming an rng draw (this is an ESTIMATE the bot
// uses to decide whether to attempt at all; the real draw, if any, happens
// engine-side inside rollTier once the move is actually dispatched).
function tier1PlusChance(actorCharisma, targetCharisma) {
  const cc = RULES.persuasion.charismaCheck;
  const diff = (actorCharisma || 0) - (targetCharisma || 0);
  const edge = Math.min(cc.maxDiffBonus, Math.max(-cc.maxDiffBonus, diff * cc.perPointDiffBonus));
  const tier1ChanceRaw = Math.min(1, Math.max(0, cc.baseTier1Chance + edge));
  const tier2Chance = Math.min(1, Math.max(0, cc.baseTier2Chance + edge));
  const tier2Cut = Math.min(1, Math.max(0, 1 - tier2Chance));
  const tier1Cut = Math.min(tier2Cut, Math.max(0, tier2Cut - tier1ChanceRaw));
  return 1 - tier1Cut; // P(r >= tier1Cut) = P(tier is 1 or 2)
}

function charismaOf(G, seat) {
  const p = G.players[parseInt(seat)];
  return p && p.character ? p.character.stats.charisma : 0;
}

// 求情 (rent refund) attempt decision. Returns a move tuple or null. Reuses
// canAttempt directly (not hand-mirrored) — it is already the exact
// predicate src/Game.js's attemptPersuasion move dispatches through
// (window + accounting caps + RULES.persuasion.enabled), so this can never
// dispatch an INVALID_MOVE the runner would have to silently absorb.
function rentPersuasionMove(G, ctx, playerID, pol) {
  if (pol.persuasionPolicy === 'never') return null;
  const lrp = G.lastRentPayment;
  if (!lrp || String(lrp.payerSeat) !== String(playerID)) return null;
  if (!canAttempt(G, ctx, 'rent', playerID, lrp.ownerSeat, RULES).ok) return null;
  if (pol.persuasionPolicy === 'valueful') {
    // Expectation = (already-paid amount) x (tier-1 refund fraction) x
    // P(tier >= 1) — deliberately uses the TIER-1 (not tier-2) refund
    // fraction so 'valueful' never overstates its own expected value.
    const tier1Pct = RULES.persuasion.rent.tierRefundPct[1] || 0;
    const chance = tier1PlusChance(charismaOf(G, playerID), charismaOf(G, lrp.ownerSeat));
    const expectedGain = lrp.amount * tier1Pct * chance;
    if (expectedGain <= VALUEFUL_MIN_EXPECTED_RENT_GAIN) return null;
  }
  return [['attemptPersuasion', 'rent', String(lrp.ownerSeat), '']];
}

// 叫阵 (duel taunt) attempt decision, called from duelDecision's 'response'
// branch (the challenger's OWN decideMoves call — ctx.currentPlayer stays
// the challenger for the whole duel, see duelDecision's header). Returns a
// move tuple or null.
function duelPersuasionMove(G, ctx, duel, pol) {
  if (pol.persuasionPolicy === 'never') return null;
  if (!canAttempt(G, ctx, 'duel', duel.challengerId, duel.ownerId, RULES).ok) return null;
  if (pol.persuasionPolicy === 'valueful') {
    // No clean dollar EV exists for a dice-total shift (unlike rent's direct
    // refund), so 'valueful' here uses a simple, honest probability bar
    // instead of a fabricated dollar figure: attempt only when the
    // charisma-check gives at least a coin-flip's chance of ANY beneficial
    // tier.
    const chance = tier1PlusChance(charismaOf(G, duel.challengerId), charismaOf(G, duel.ownerId));
    if (chance < VALUEFUL_MIN_DUEL_CHANCE) return null;
  }
  return [['attemptPersuasion', 'duel', String(duel.ownerId), '']];
}

// Merge a partial policy over the defaults (shallow — all keys are scalars).
export function resolvePolicy(policy) {
  return Object.assign({}, DEFAULT_POLICY, policy || {});
}

// --- small pure helpers (mirror Game.js semantics; read-only) ---

function groupKeyOf(space) {
  return space.placeId || space.color;
}

function ownsFullGroup(G, playerID, groupKey) {
  const ids = groupKey && G.board.colorGroups[groupKey];
  if (!ids) return false;
  return ids.every(id => G.ownership[id] === playerID);
}

// Recompute an upgrade cost the same way Game.getUpgradeCost does, WITHOUT season
// or character discounts (those only make the real cost lower, so building when we
// can afford the undiscounted cost is always safe — never over-commits cash).
function baseUpgradeCost(G, space, targetLevel) {
  return Math.floor(space.price * RULES.buildings.upgradeCostMultipliers[targetLevel - 1]);
}

// All spaces the player can legally upgrade right now (full group, even-build rule,
// below max level, no mortgaged member), cheapest first. Pure — mirrors the
// upgradeProperty guards in Game.js so the runner never dispatches an INVALID_MOVE.
export function upgradeableSpaces(G, playerID) {
  const player = G.players[parseInt(playerID)];
  const out = [];
  player.properties.forEach(pid => {
    const space = G.board.spaces[pid];
    if (!space || space.type !== 'property') return;
    const gk = groupKeyOf(space);
    if (!gk || !G.board.colorGroups[gk]) return;
    if (!ownsFullGroup(G, playerID, gk)) return;
    const groupIds = G.board.colorGroups[gk];
    if (groupIds.some(id => G.mortgaged[id])) return;
    const level = G.buildings[pid] || 0;
    if (level >= RULES.core.maxBuildingLevel) return;
    // even-building: only the group's current-min-level members are eligible
    const minLevel = Math.min.apply(null, groupIds.map(id => G.buildings[id] || 0));
    if (level > minLevel) return;
    out.push({ pid: pid, level: level, cost: baseUpgradeCost(G, space, level + 1) });
  });
  out.sort((a, b) => a.cost - b.cost);
  return out;
}

// Owned, unmortgaged, building-free properties cheapest first — the order the
// survive-by-mortgaging step liquidates holdings (lowest value first, so it keeps
// the properties that matter most to its monopolies).
function mortgageableSpaces(G, playerID) {
  const player = G.players[parseInt(playerID)];
  return player.properties
    .filter(pid => {
      if (G.mortgaged[pid]) return false;
      if ((G.buildings[pid] || 0) > 0) return false;
      const gk = groupKeyOf(G.board.spaces[pid]);
      if (gk && G.board.colorGroups[gk]) {
        // Game.js forbids mortgaging when ANY group member has buildings.
        if (G.board.colorGroups[gk].some(id => (G.buildings[id] || 0) > 0)) return false;
      }
      return true;
    })
    .sort((a, b) => G.board.spaces[a].price - G.board.spaces[b].price);
}

// === Route strategy (D4) =====================================================
// chooseRoute picks ONE entry from routeChoices(...). Pure: scores each branch's
// route against the strategy and returns the winning route array.
//
// tourer: maximize NEW places seen along the branch (coverage-seeking explorer).
// camper: minimize spread — stay nearest the player's owned cluster; ties broken
//   toward the branch that revisits already-owned/seen places (homebody).
export function chooseRoute(G, ctx, choices, strategy) {
  if (!choices || choices.length === 0) return [];
  if (choices.length === 1) return choices[0].route;

  const playerID = ctx.currentPlayer;
  const player = G.players[parseInt(playerID)];
  // Places the player already "knows": ones it owns property in.
  const ownedPlaces = {};
  player.properties.forEach(pid => {
    const gk = groupKeyOf(G.board.spaces[pid]);
    if (gk) ownedPlaces[gk] = true;
  });

  function placesOnRoute(route) {
    const seen = {};
    route.forEach(id => {
      const sp = G.board.spaces[id];
      const gk = groupKeyOf(sp);
      if (gk) seen[gk] = true;
    });
    return Object.keys(seen);
  }

  let best = null;
  let bestScore = -Infinity;
  choices.forEach((choice, idx) => {
    const places = placesOnRoute(choice.route);
    const ownedHits = places.filter(p => ownedPlaces[p]).length;
    let score;
    if (strategy === 'tourer') {
      // Reward branches that touch more distinct places, and especially NEW ones.
      const newPlaces = places.length - ownedHits;
      score = places.length + newPlaces; // distinct coverage, new weighted double
    } else {
      // camper: prefer branches that keep near owned cluster (more owned hits =
      // higher score), penalize branches that wander into many distinct places.
      score = ownedHits * 10 - places.length;
    }
    // Deterministic tie-break: earliest choice (edge order) wins.
    if (score > bestScore) {
      bestScore = score;
      best = choice.route;
    } else if (score === bestScore && best === null) {
      best = choice.route;
    }
  });
  return best || choices[0].route;
}

// === Move decider (D3) =======================================================
// Returns the ordered move list to dispatch NEXT. The runner calls this in a loop
// per turn: each call returns the single highest-priority action (plus, for the
// roll case, the immediate follow-up commit), then the runner re-reads G and calls
// again until decideMoves returns [['endTurn']] (or an empty list if stuck).
//
// Priority order (D3; duel resolution added Task 7 of the duel mechanism):
//   1. jail (not yet rolled): pay fine if affordable+policy, else roll to escape
//   2. roll: rollOnly+commitRoute (atlas) or rollDice (loop), once per turn
//   3. resolve blocking card: acceptCard
//   4. resolve duel: challenger offer (payRent/initiateDuel per duelPolicy), or
//      — during the 'response' sub-phase — a persuasion taunt attempt per
//      persuasionPolicy (T4), THEN owner response (respondDuel/declineDuel by
//      strength, policy-independent) once that window closes
//   5. resolve auction: bid up to cap, else passAuction
//   6. resolve buy decision: buyProperty if affordable above buffer, else passProperty
//   6.5 persuasion: rent-refund attempt per persuasionPolicy (T4), once per
//      turn, right after rolling — before build so a successful refund can
//      still feed that same turn's build budget
//   7. build: upgrade cheapest eligible full-group space while buffer allows
//   8. survive: mortgage lowest-value holdings if money < 0 (shouldn't normally
//      happen post-resolution, but covers a card/tax that dipped us negative)
//   9. endTurn
export function decideMoves(G, ctx, playerID, policy) {
  const pol = resolvePolicy(policy);
  const player = G.players[parseInt(playerID)];
  const atlas = G.board.movementMode === 'atlas';

  // --- 3/4/5: resolve blocking states FIRST so endTurn never bounces. These can
  // be set even before we've rolled (jail roll can land on a card/buy), so they
  // take precedence over a fresh roll.
  if (G.pendingCard) {
    return [['acceptCard']];
  }
  // Duel (Task 7): both sub-phases block endTurn (engine 8-move guard list),
  // so this must resolve before anything else, same tier as auction/canBuy.
  // duelDecision derives the acting player directly from G.duel.challengerId/
  // ownerId rather than the `playerID` argument (mirrors auctionDecision's
  // acting-bidder derivation below) — correct regardless of which seat the
  // runner's actingSeat computation currently points at. `ctx` is threaded
  // through (T4) purely for duelPersuasionMove's canAttempt call.
  if (G.duel) {
    return duelDecision(G, ctx, pol);
  }
  if (G.auction) {
    return auctionDecision(G, ctx, pol);
  }
  if (G.canBuy) {
    return buyDecision(G, player, pol);
  }

  // --- 1: jail handling, before the roll, while not yet rolled.
  if (player.inJail && !G.hasRolled) {
    if (pol.payJailFine && player.money - pol.cashBuffer >= RULES.core.jailFine) {
      return [['payJailFine'], ...rollMoves(G, ctx, atlas, pol)];
    }
    // else fall through to roll (try doubles / serve time)
  }

  // --- 2: roll once per turn.
  if (!G.hasRolled) {
    return rollMoves(G, ctx, atlas, pol);
  }

  // --- 6.5: persuasion (rent refund window, T4). A no-op (null) for
  // persuasionPolicy 'never' (DEFAULT_POLICY) or once the window's own
  // accounting closes it (already attempted / cap hit) — the game then falls
  // straight through to build/survive/endTurn exactly as before this feature
  // existed, so 'never' runs stay byte-identical to pre-T4 behavior.
  const rentPersuasion = rentPersuasionMove(G, ctx, playerID, pol);
  if (rentPersuasion) return rentPersuasion;

  // --- 6: build. One upgrade per decideMoves call so the runner re-reads cash.
  const builds = upgradeableSpaces(G, playerID);
  for (let i = 0; i < builds.length; i++) {
    const b = builds[i];
    if (player.money - pol.cashBuffer >= b.cost * pol.buildAggression) {
      return [['upgradeProperty', b.pid]];
    }
  }

  // --- 7: survive (defensive — resolve a negative balance by mortgaging).
  if (player.money < 0) {
    const m = mortgageableSpaces(G, playerID);
    if (m.length > 0) return [['mortgageProperty', m[0]]];
  }

  // --- 8: end the turn.
  return [['endTurn']];
}

// Roll sequence: atlas = rollOnly then commitRoute(chosen branch); loop = rollDice.
// On atlas, the commit route must be computed AFTER rollOnly resolves (the dice
// total isn't known until then), so the runner dispatches rollOnly, re-reads G,
// then calls decideRoute() for the commit. We express that as a two-step list with
// a deferred-route marker the runner expands.
function rollMoves(G, ctx, atlas, pol) {
  if (!atlas) return [['rollDice']];
  // ['rollOnly'] then a deferred commit: the runner sees 'commitRoute' with a null
  // route and fills it via decideRoute() once the post-roll dice total is known.
  return [['rollOnly'], ['commitRoute', null]];
}

// Called by the runner after rollOnly resolves, to pick the actual route. Returns
// the route array for commitRoute. If there's no fork the lone route is returned;
// if the player can't move at all, [] (a legal stall).
export function decideRoute(G, ctx, pol) {
  const resolved = resolvePolicy(pol);
  const player = G.players[parseInt(ctx.currentPlayer)];
  const total = G.lastDice ? G.lastDice.total : 0;
  const choices = routeChoices(G.board.edges, player.position, total);
  return chooseRoute(G, ctx, choices, resolved.routeStrategy);
}

function buyDecision(G, player, pol) {
  const space = G.board.spaces[player.position];
  const price = G.effectivePrice || (space ? space.price : Infinity);
  if (player.money - pol.cashBuffer >= price) {
    return [['buyProperty']];
  }
  return [['passProperty']];
}

function auctionDecision(G, ctx, pol) {
  const auction = G.auction;
  const bidderEntry = auction.bidders[auction.currentBidderIndex];
  // Only the active bidder acts; if it's not our seat the runner will rotate to
  // the right seat (cross-seat auctions are driven by the runner per current bidder).
  const bidder = G.players[parseInt(bidderEntry.playerId)];
  const space = G.board.spaces[auction.propertyId];
  const faceValue = space ? space.price : 0;
  const cap = Math.floor(faceValue * pol.auctionMaxFraction);
  const minBid = auction.currentBid === 0
    ? RULES.auction.startingBid
    : auction.currentBid + RULES.auction.minimumIncrement;
  if (minBid <= cap && minBid <= bidder.money) {
    return [['placeBid', minBid]];
  }
  return [['passAuction']];
}

// === Duel decision (Task 7) ==================================================
// A rent-duel offer/response, per RULES.duel §engine spec. G.duel is a singleton
// envelope: {phase:'offer'|'response', propertyId, ownerId, challengerId, rent}.
// Both branches derive their actors from G.duel itself (never from a `playerID`
// argument) so the decision is correct regardless of which seat the runner
// happens to be iterating — same reasoning as auctionDecision above deriving the
// acting bidder from G.auction rather than trusting the caller's seat. `ctx`
// (T4) is threaded through ONLY for duelPersuasionMove's canAttempt call —
// canAttempt itself never reads it today, but the real ctx is passed through
// anyway rather than a stub, matching every other decideMoves helper's
// signature discipline.
function duelDecision(G, ctx, pol) {
  const duel = G.duel;
  if (duel.phase === 'offer') {
    if (pol.duelPolicy === 'never') return [['payRent']];
    if (pol.duelPolicy === 'always') {
      return duelCooldownBlocked(G, duel) ? [['payRent']] : [['initiateDuel']];
    }
    // 'strength': initiate only on a strict advantage; ties/weakness pay rent.
    // Also gated by the cooldown guard (matches the 'always' branch above) — a
    // strictly-stronger challenger who is cooldown-blocked must still pay rent,
    // otherwise the bot dispatches an INVALID_MOVE the runner's stuck-detector
    // silently truncates the whole match on.
    const chalStrength = duelStrength(G, duel.challengerId);
    const ownerStrength = duelStrength(G, duel.ownerId);
    if (chalStrength > ownerStrength && !duelCooldownBlocked(G, duel)) return [['initiateDuel']];
    return [['payRent']];
  }
  // phase 'response': persuasion (T4) FIRST — this is genuinely the
  // CHALLENGER's own decideMoves call (ctx.currentPlayer, and therefore
  // `pol`, stays the challenger's for the whole duel — see this function's
  // header), so `pol.persuasionPolicy` here means "should THIS challenger
  // taunt before the owner responds". Returns the taunt move once; the
  // runner dispatches it, canAttempt's own accounting closes the window, and
  // the VERY NEXT call (same G.duel, same ctx.currentPlayer) falls through
  // to the strength-based response below — so a policy that declines (or a
  // window that's already exhausted) never adds an extra no-op call.
  const persuasion = duelPersuasionMove(G, ctx, duel, pol);
  if (persuasion) return persuasion;
  // The owner (defender) decides. Policy-independent by spec — every
  // duelPolicy value ('never' included, since a 'never' bot never INITIATES
  // but can still be challenged as an owner) answers with the same strength
  // rule: fight when at least as strong as the challenger (matches the
  // engine's tieGoesToDefender default), else decline.
  const chalStrength = duelStrength(G, duel.challengerId);
  const defStrength = duelStrength(G, duel.ownerId);
  return defStrength >= chalStrength ? [['respondDuel']] : [['declineDuel']];
}

// Mirrors the engine's respondDuel roll() stat term (Game.js), minus the dice:
// statPrimary + floor(statSecondary / secondaryDivisor), per RULES.duel.
function duelStrength(G, playerId) {
  const stats = G.players[playerId].character.stats;
  return stats[RULES.duel.statPrimary] + Math.floor(stats[RULES.duel.statSecondary] / RULES.duel.secondaryDivisor);
}

// Mirrors the engine's initiateDuel cooldown guard (Game.js) exactly, so the
// bot never dispatches an initiateDuel the engine would reject as INVALID_MOVE.
// Delegates to the shared helper (final-review Fix 3 — de-triplication: this
// local body used to duplicate the exact same boolean Game.js's initiateDuel
// and App.js's _duelPromptHtml each inlined separately).
function duelCooldownBlocked(G, duel) {
  return isDuelCooldownBlocked(G.players[duel.challengerId], G.totalTurns);
}
