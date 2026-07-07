// src/events.js — typed engine event stream + message rendering.
// G.messages stays a PER-TURN RESET BUFFER (reset sites call resetMessages);
// G.events is append-only, capped, seq-monotonic. Spec:
// docs/superpowers/specs/2026-07-07-engine-events-seats-design.md
import { RULES } from '../mods/active-rules';

// Moved here (from Game.js) rather than exported back to it: Game.js already
// imports logEvent/resetMessages from this module, so keeping playerName in
// Game.js and importing it INTO events.js would create a circular import
// (Game.js -> events.js -> Game.js). Game.js imports it back from here instead.
export function playerName(player) {
  if (player.character) return player.character.name;
  return `Player ${parseInt(player.id) + 1}`;
}

export const EVENT_LOG_CAP_FALLBACK = 200;

const TYPE_LIST = [
  'character_selected', 'dice_rolled', 'route_committed', 'moved', 'landing_notice',
  'salary_collected', 'passive_triggered', 'property_bought', 'property_passed',
  'rent_paid', 'tax_paid', 'card_drawn', 'card_prompt', 'card_applied', 'card_redrawn',
  'went_to_jail', 'jail_fine_paid', 'left_jail', 'jail_wait', 'property_upgraded',
  'building_sold', 'property_mortgaged', 'property_unmortgaged', 'property_regulated',
  'reroll_used', 'trade_proposed', 'trade_accepted', 'trade_rejected',
  'trade_cancelled', 'auction_started', 'auction_turn', 'bid_placed',
  'auction_passed', 'auction_ended', 'bankruptcy', 'season_changed', 'game_over',
  'jail_reminder',
];
export const ENGINE_EVENTS = Object.freeze(Object.fromEntries(TYPE_LIST.map(t => [t, t])));

export function logEvent(G, type, actor, data) {
  // hasOwnProperty, not a truthy bracket read (final-review Fix 3): ENGINE_EVENTS
  // is a plain object, so a prototype-name type ('toString', 'constructor',
  // 'hasOwnProperty', ...) would resolve to an inherited Object.prototype
  // function via ENGINE_EVENTS[type] — truthy, so `!ENGINE_EVENTS[type]` would
  // silently skip the throw for a type that was never actually registered.
  if (!Object.prototype.hasOwnProperty.call(ENGINE_EVENTS, type)) throw new Error(`unknown engine event type: ${type}`);
  G.events.push({ seq: G.eventSeq++, turn: G.totalTurns, type, actor, data });
  // 0 is not a valid cap (final-review Fix 6): `||` would treat eventLogCap:0
  // as falsy and silently fall back to the default anyway, which happens to
  // be the desired behavior — but only by accident of `||`'s semantics, not
  // by an explicit validity check. Made explicit so any other invalid value
  // (negative, NaN, non-finite) falls back the same documented way.
  const rawCap = RULES.core && RULES.core.eventLogCap;
  const cap = (Number.isFinite(rawCap) && rawCap > 0) ? rawCap : EVENT_LOG_CAP_FALLBACK;
  if (G.events.length > cap) G.events.splice(0, G.events.length - cap);
  const msg = formatEventMessage(type, actor, data, G);
  if (msg !== null) G.messages.push(msg);
}

export function resetMessages(G) {
  G.messages = [];
}

// Branches are added ONLY by the migration task that retires the corresponding
// G.messages site, lifting the template VERBATIM. Unhandled type -> null (event-only).
export function formatEventMessage(type, actor, data, G) {
  switch (type) {
    case 'dice_rolled': {
      const p = G.players[actor];
      return `${playerName(p)} rolled ${data.d1} + ${data.d2} = ${data.total}`;
    }

    // reason:'card' (applyCard's goToJail action) is event-only: the
    // pre-migration code never pushed a "Go to Jail!" message for that
    // branch (only the space-landing goToJail does — confirmed against the
    // golden jail-cycle fixture), so it must return null FIRST, before the
    // other reasons' unconditional text.
    case 'went_to_jail':
      if (data.reason === 'card') return null;
      return data.reason === 'triples' ? 'Triple doubles! Go to Jail!' : 'Go to Jail!';

    // 'doubles'/'served' are the two ways a jailed player actually leaves jail
    // this turn (Game.js rollAndResolveJail). The "remains jailed" outcome used
    // to be shoehorned in here as how:'waiting' (see task-3-report.md); it now
    // has its own dedicated 'jail_wait' type below.
    case 'left_jail': {
      if (data.how === 'doubles') return 'Doubles! You\'re free from jail!';
      return `${data.maxTurns} turns in jail. Paid $${data.fine} fine.`;
    }

    // Player rolled, is still in jail, and didn't roll doubles or hit
    // jailMaxTurns this turn (Game.js rollAndResolveJail). data.turn is the
    // post-increment jailTurns counter captured at emit time (payload-
    // sufficiency: no live G.players[actor].jailTurns read here).
    case 'jail_wait':
      return `Still in jail. Turn ${data.turn}/${data.maxTurns}.`;

    case 'jail_fine_paid': {
      if (data.failed) return `Not enough money to pay $${data.fine} fine!`;
      return `${playerName(G.players[actor])} paid $${data.fine} to get out of jail.`;
    }

    // Per-turn reminder (Game.js turn.onBegin) shown to a still-jailed player
    // BEFORE they roll, offering to pay the fine or try for doubles. Distinct
    // from 'jail_wait' (fired AFTER a roll that fails to escape jail, mid-turn,
    // with a turn-count progress line) — different string, different
    // lifecycle point, hence its own dedicated type rather than a reuse.
    case 'jail_reminder':
      return `${playerName(G.players[actor])} is in jail. Pay $${data.fine} or try to roll doubles.`;

    // Homogeneous movement events only: the unconditional "Landed on X" (every
    // move) and the atlas dead-end notice. Both payload shapes carry
    // {from,to,passedGo[,routeExhausted]} — position-tracking consumers can
    // rely on numeric from/to always being present. The non-financial landing
    // commentary that used to be multiplexed in here via a `note` field (see
    // task-3-report.md) now has its own dedicated 'landing_notice' type below.
    case 'moved': {
      if (data.routeExhausted) return 'No path forward — the route ends here.';
      return `Landed on ${G.board.spaces[data.to].name}.`;
    }

    // Non-financial landing narration: property available/unaffordable/owned,
    // just-visiting-jail, and free-parking-relax. No separate financial or
    // state-typed event accompanies these, and (unlike 'moved') there is no
    // from/to — hence the split from 'moved' into its own type.
    case 'landing_notice': {
      const space = data.propertyId !== undefined ? G.board.spaces[data.propertyId] : null;
      switch (data.note) {
        case 'available':
          return data.effectivePrice < data.listPrice
            ? `${space.name} available! Listed $${data.listPrice}, your price $${data.effectivePrice}. Buy or pass?`
            : `${space.name} is available for $${data.effectivePrice}. Buy or pass?`;
        case 'unaffordable':
          return `${space.name} costs $${data.price} but you only have $${data.playerMoney}.`;
        case 'owned':
          return `You own ${space.name}.`;
        case 'visiting_jail':
          return 'Just visiting jail.';
        case 'parking_relax':
          return 'Free Parking - relax!';
        default:
          return null;
      }
    }

    case 'salary_collected': {
      if (data.source === 'hub') return `${playerName(G.players[actor])} passes a capital hub! Collect $${data.amount}.`;
      if (data.source === 'parking') return `Free Parking jackpot! Collected $${data.amount}!`;
      return `Passed GO! Collect $${data.amount}.`;
    }

    // Idealist (GO/hub bonus) and financier (tax loss reduction) branches added
    // by slice 1; financier's card pay/payPercent branch added by this slice
    // (cards+passives) — same underlying passive, distinct text ("loss" vs
    // "tax"), discriminated by context. Other passives (arbitrageur) are
    // added by later slices onto this same case.
    case 'passive_triggered': {
      if (data.passive === 'idealist' && data.effect === 'go_bonus') {
        // Reused verbatim by applyCard's moveTo GO-crossing branch too
        // (context:'card') — any non-'hub' context reads "from GO", the same
        // text performMove's real dice-move GO crossing produces.
        const suffix = data.context === 'hub' ? 'at the hub' : 'from GO';
        return `Growth vision: extra $${data.amount} ${suffix}!`;
      }
      if (data.passive === 'financier' && data.effect === 'loss_reduced') {
        // 'tax' (slice 1, handleLanding) says "reduces tax to"; the card
        // contexts ('pay'/'payPercent', applyCard) both say "reduces loss to"
        // — identical text for both card actions, so no per-context branch.
        if (data.context === 'tax') return `Financial expertise reduces tax to $${data.amount}.`;
        return `Financial expertise reduces loss to $${data.amount}.`;
      }
      // Sophia Ember (arbitrageur): bonus paid to every other non-bankrupt
      // arbitrageur when a player goes bankrupt (Game.js handleBankruptcy).
      // Logged AFTER the bankrupt player's own 'bankruptcy' event, same order
      // as the original G.messages.push calls.
      if (data.passive === 'arbitrageur' && data.effect === 'bankruptcy_bonus') {
        return `${playerName(G.players[actor])} gains $${data.amount} from crisis arbitrage!`;
      }
      return null;
    }

    case 'rent_paid':
      return `Paid $${data.amount} rent to ${playerName(G.players[data.ownerId])} for ${G.board.spaces[data.propertyId].name}.`;

    case 'tax_paid':
      return `Paid $${data.amount} in ${G.board.spaces[data.spaceId].name}.`;

    // Card draw, from handleLanding's chance/community cases (Game.js). Two
    // sub-shapes share this one type: `empty` (deck exhausted, no card
    // drawn) and the plain announce line. The redraw-offer reminder used to
    // be folded in here as a second card_drawn event with {prompt:true} —
    // it now has its own dedicated 'card_prompt' type below (see
    // task-4-report.md concern #1 / this fix's report section).
    case 'card_drawn': {
      const label = data.deck === 'chance' ? 'CHANCE' : 'COMMUNITY CHEST';
      if (data.empty) return 'The deck is empty.';
      return `${label}: ${data.text}`;
    }

    // Redraw offer, emitted immediately after 'card_drawn' (same deck/
    // cardIndex) once the game has decided a redraw is offered (Cassian
    // passive or a luck redraw on an eligible action). Dedicated type so
    // consumers counting card_drawn events per turn see exactly one per
    // physical draw; deck/cardIndex are carried for consumers even though
    // the rendered string is static.
    case 'card_prompt':
      return 'You may accept or redraw this card.';

    // Every applyCard (Game.js) action branch logs one of these, whether or
    // not it produces a message — 'gain'/'pay'/'goToJail'/'moveTo' never had
    // a dedicated template pre-migration (silent or handled by reused
    // salary_collected/passive_triggered types), so those fall through to
    // null here, matching that no new message appears. `data.effect` carries
    // every value the action's original template (if any) interpolated.
    case 'card_applied': {
      switch (data.action) {
        case 'payPercent':
          return `Total assets: $${data.effect.assets}. Paid $${data.effect.amount} (${data.effect.percent}%).`;
        case 'gainAll':
          return `All players receive $${data.effect.amount}!`;
        case 'gainPerProperty':
          return `${data.effect.count} properties x $${data.effect.perProperty} = $${data.effect.amount} earned!`;
        case 'freeUpgrade':
          if (data.effect.outcome === 'upgraded') return `Free upgrade! ${data.effect.targetSpaceName} upgraded to ${data.effect.newLevelName}!`;
          return 'No properties eligible for free upgrade.';
        case 'downgrade':
          if (data.effect.outcome === 'downgraded') return `Market Crash! ${data.effect.targetSpaceName} downgraded to ${data.effect.newLevelName}.`;
          return 'No buildings to downgrade.';
        case 'forceBuy':
          if (data.effect.outcome === 'bought') return `Hostile Takeover! Bought ${data.effect.targetSpaceName} from ${playerName(G.players[data.effect.targetOwnerId])} for $${data.effect.cost}!`;
          if (data.effect.outcome === 'insufficient_funds') return `Can't afford hostile takeover ($${data.effect.cost} needed).`;
          return 'No opponents with properties for hostile takeover.';
        // 'gain', 'pay', 'moveTo', 'goToJail' — data-only, no message.
        default:
          return null;
      }
    }

    case 'card_redrawn': {
      const label = data.deck === 'chance' ? 'CHANCE' : 'COMMUNITY CHEST';
      return `Redraw! ${label}: ${data.newText}`;
    }

    // Two sub-shapes on one type: the per-player join line (this slice, actor =
    // the selecting player, data.allSelected absent) and the all-selected
    // transition (slice 1, actor null, data:{allSelected:true}). Both fire in
    // the same selectCharacter move — the join line first, then (only after
    // the LAST player selects) resetMessages() clears the per-turn buffer
    // before the transition line is logged, so only the transition line
    // survives into G.messages on that final call (see task-5-report.md).
    case 'character_selected':
      if (data.allSelected) return `All characters selected! Game begins! ${playerName(G.players[0])} rolls first.`;
      return data.affinityBonus > 0
        ? `${playerName(G.players[actor])} joins the game! ($${data.money}, +$${data.affinityBonus} world affinity)`
        : `${playerName(G.players[actor])} joins the game! ($${data.money})`;

    case 'property_bought':
      return `Bought ${G.board.spaces[data.propertyId].name} for $${data.paidPrice}!`;

    case 'property_passed':
      return 'Passed on buying.';

    case 'property_upgraded':
      return `Built ${data.newLevelName} on ${G.board.spaces[data.propertyId].name} for $${data.cost}!`;

    case 'property_mortgaged':
      return `Mortgaged ${G.board.spaces[data.propertyId].name} for $${data.amount}.`;

    case 'property_unmortgaged':
      return `Unmortgaged ${G.board.spaces[data.propertyId].name} for $${data.cost}.`;

    // soldLevel (the level just sold off) is newLevel+1 — building_sold always
    // fires after decrementing by exactly one level, so this is safe
    // arithmetic, not a lookup into any mutable state (RULES.buildings.names
    // is static config, already imported here).
    case 'building_sold': {
      const soldLevel = data.newLevel + 1;
      return `Sold ${RULES.buildings.names[soldLevel]} on ${G.board.spaces[data.propertyId].name} for $${data.refund}. Now: ${RULES.buildings.names[data.newLevel]}.`;
    }

    case 'property_regulated':
      return `${playerName(G.players[actor])} regulates ${G.board.spaces[data.propertyId].name}! (+${RULES.passives.enforcer.regulatedRentBonus * 100}% rent)`;

    case 'reroll_used':
      return `${playerName(G.players[actor])} uses a reroll! (${data.rerollsLeft} left)`;

    case 'season_changed': {
      const season = RULES.seasons.list[data.seasonIndex];
      return `${season.icon} Season changed to ${season.name}!`;
    }

    case 'bankruptcy':
      return `${playerName(G.players[actor])} is BANKRUPT!`;

    // actor = the proposer (Game.js proposeTrade); data mirrors G.trade's
    // real field names verbatim (the normalized-with-defaults values, not the
    // raw incoming proposal, which may have undefined optional fields).
    case 'trade_proposed':
      return `${playerName(G.players[actor])} proposes a trade to ${playerName(G.players[data.targetPlayerId])}!`;

    // actor = the target (Game.js acceptTrade — the target is the one whose
    // move accepts), data carries proposerId so consumers don't need G.trade
    // (already nulled out by the time this logs).
    case 'trade_accepted':
      return `Trade accepted! ${playerName(G.players[data.proposerId])} and ${playerName(G.players[actor])} completed a trade.`;

    // actor = the target (Game.js rejectTrade).
    case 'trade_rejected':
      return `${playerName(G.players[actor])} rejected the trade.`;

    // actor = the proposer (Game.js cancelTrade — only the proposer may
    // cancel). The original string never interpolated anything.
    case 'trade_cancelled':
      return 'Trade cancelled.';

    // actor null (system announcement, Game.js passProperty's auction branch).
    case 'auction_started':
      return `${G.board.spaces[data.propertyId].name} goes to auction! Bidding starts at $${RULES.auction.startingBid}.`;

    // actor null (system rotation prompt). Two Game.js call sites share this
    // branch verbatim: passProperty's first-bidder announce and
    // advanceAuction's per-rotation prompt — same string, same shape.
    case 'auction_turn':
      return `${playerName(G.players[data.bidderId])}'s turn to bid.`;

    case 'bid_placed':
      return `${playerName(G.players[actor])} bids $${data.amount}!`;

    case 'auction_passed':
      return `${playerName(G.players[actor])} passes.`;

    // actor null. Two sub-shapes on one type, discriminated by winnerId: the
    // win (resolveAuction) and the two no-bids sites (advanceAuction's
    // all-passed branch, passAuction's zero-active-bidders branch) — both
    // no-bids call sites share this SAME branch, so their rendered text is
    // byte-identical by construction, not by coincidence.
    case 'auction_ended':
      if (data.winnerId === null) return `No bids. ${G.board.spaces[data.propertyId].name} remains unowned.`;
      return `${playerName(G.players[data.winnerId])} wins the auction for ${G.board.spaces[data.propertyId].name} at $${data.amount}!`;

    // New in this slice (Monopoly.onEnd, game-def level, not a move). No
    // pre-migration G.messages site ever announced game-over, so this is
    // event-only by design — always null, not merely unhandled.
    case 'game_over':
      return null;

    default:
      return null;
  }
}
