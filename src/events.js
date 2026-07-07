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
];
export const ENGINE_EVENTS = Object.freeze(Object.fromEntries(TYPE_LIST.map(t => [t, t])));

export function logEvent(G, type, actor, data) {
  if (!ENGINE_EVENTS[type]) throw new Error(`unknown engine event type: ${type}`);
  G.events.push({ seq: G.eventSeq++, turn: G.totalTurns, type, actor, data });
  const cap = (RULES.core && RULES.core.eventLogCap) || EVENT_LOG_CAP_FALLBACK;
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

    // Only the all-selected transition (Game.js selectCharacter) is migrated by
    // this slice; the per-player join message (Task 5) adds another branch here.
    case 'character_selected':
      return data.allSelected
        ? `All characters selected! Game begins! ${playerName(G.players[0])} rolls first.`
        : null;

    default:
      return null;
  }
}
