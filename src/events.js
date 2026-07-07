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
  'rent_paid', 'tax_paid', 'card_drawn', 'card_applied', 'card_redrawn',
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

    case 'went_to_jail':
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
    // by this slice; other passives (financier pay/payPercent, arbitrageur)
    // are added by later slices onto this same case.
    case 'passive_triggered': {
      if (data.passive === 'idealist' && data.effect === 'go_bonus') {
        const suffix = data.context === 'hub' ? 'at the hub' : 'from GO';
        return `Growth vision: extra $${data.amount} ${suffix}!`;
      }
      if (data.passive === 'financier' && data.effect === 'loss_reduced' && data.context === 'tax') {
        return `Financial expertise reduces tax to $${data.amount}.`;
      }
      return null;
    }

    case 'rent_paid':
      return `Paid $${data.amount} rent to ${playerName(G.players[data.ownerId])} for ${G.board.spaces[data.propertyId].name}.`;

    case 'tax_paid':
      return `Paid $${data.amount} in ${G.board.spaces[data.spaceId].name}.`;

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
