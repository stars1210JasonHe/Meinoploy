// src/events.js — typed engine event stream + message rendering.
// G.messages stays a PER-TURN RESET BUFFER (reset sites call resetMessages);
// G.events is append-only, capped, seq-monotonic. Spec:
// docs/superpowers/specs/2026-07-07-engine-events-seats-design.md
import { RULES } from '../mods/active-rules';

export const EVENT_LOG_CAP_FALLBACK = 200;

const TYPE_LIST = [
  'character_selected', 'dice_rolled', 'route_committed', 'moved', 'salary_collected',
  'passive_triggered', 'property_bought', 'property_passed', 'rent_paid', 'tax_paid',
  'card_drawn', 'card_applied', 'card_redrawn', 'went_to_jail', 'jail_fine_paid',
  'left_jail', 'property_upgraded', 'building_sold', 'property_mortgaged',
  'property_unmortgaged', 'property_regulated', 'reroll_used', 'trade_proposed',
  'trade_accepted', 'trade_rejected', 'trade_cancelled', 'auction_started',
  'auction_turn', 'bid_placed', 'auction_passed', 'auction_ended', 'bankruptcy',
  'season_changed', 'game_over',
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
    default:
      return null;
  }
}
