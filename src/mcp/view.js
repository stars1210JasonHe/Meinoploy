// Pure projections for the MCP tool surface (spec §1 tools 4-5). Never expose
// raw G — this shaping is the wire contract (and the future redaction point).
import { RULES } from '../../mods/active-rules';
import { isDuelCooldownBlocked } from '../events';
import { canAttempt, resolvePersuasionRules, globalAttemptCount } from '../persuasion/engine';

// Byte-faithful mirror of boardgame.io's IsPlayerActive (spec §1 tool 4,
// verified against reducer source: `playerID in ctx.activePlayers` when the
// envelope exists — currentPlayer is NOT implicitly admitted).
export function canAct(ctx, seat) {
  if (ctx.activePlayers) return seat in ctx.activePlayers;
  return ctx.currentPlayer === seat;
}

// Shared mirror of Game.js's redrawCard merchant bypass (getPassive(player)
// === 'merchant', unlimited free redraws) — deliberately more defensive than
// the engine's getPassive (which assumes character.passive exists), since
// MCP projections can run over partially-shaped/crafted states. Used by the
// digest's redraw hint below AND legal-moves.js's redrawCard listing, so the
// passive chain is hand-rolled exactly once on the MCP side.
export function isMerchant(player) {
  return !!(player && player.character && player.character.passive && player.character.passive.id === 'merchant');
}

function seatRow(G, p) {
  return {
    id: p.id,
    name: p.character ? p.character.name : null,
    character: p.character ? p.character.id : null,
    money: p.money,
    position: p.position,
    positionName: (G.board.spaces[p.position] && G.board.spaces[p.position].name) || null,
    properties: p.properties.slice(),
    bankrupt: !!p.bankrupt,
    inJail: !!p.inJail,
  };
}

export function stateView(G, ctx, seat) {
  const yourTurn = ctx.currentPlayer === seat;
  const acting = canAct(ctx, seat);
  return {
    yourSeat: seat,
    phase: G.phase,
    turnPhase: G.turnPhase,
    totalTurns: G.totalTurns,
    isYourTurn: yourTurn,
    canAct: acting,
    isAddressed: acting && !yourTurn,
    gameover: ctx.gameover !== undefined ? ctx.gameover : null,
    seats: G.players.map(p => seatRow(G, p)),
    flags: {
      canBuy: !!G.canBuy,
      effectivePrice: G.effectivePrice || 0,
      pendingCard: G.pendingCard ? { deck: G.pendingCard.deck, text: G.pendingCard.card && G.pendingCard.card.text } : null,
      awaitingRoute: !!G.awaitingRoute,
      trade: G.trade ? {
        proposerId: G.trade.proposerId, targetPlayerId: G.trade.targetPlayerId,
        offeredProperties: G.trade.offeredProperties.slice(), requestedProperties: G.trade.requestedProperties.slice(),
        offeredMoney: G.trade.offeredMoney, requestedMoney: G.trade.requestedMoney,
      } : null,
      auction: G.auction ? {
        propertyId: G.auction.propertyId, currentBid: G.auction.currentBid,
        currentBidder: G.auction.currentBidder,
        activeBidderId: G.auction.bidders[G.auction.currentBidderIndex].playerId,
      } : null,
      duel: G.duel ? { phase: G.duel.phase, propertyId: G.duel.propertyId, ownerId: G.duel.ownerId, challengerId: G.duel.challengerId, rent: G.duel.rent } : null,
    },
    board: { size: G.board.boardSize, movementMode: G.board.movementMode, modId: G.activeModId || null, mapId: G.activeMapId || null },
  };
}

function spaceName(G, id) {
  const s = G.board.spaces[id];
  return s ? s.name : `#${id}`;
}

// Deterministic English digest (spec §1 tool 5): pure function of (G, ctx,
// seat), pinned orderings (seat order = G.players order). Leads with GAME OVER.
export function stateDigest(G, ctx, seat) {
  const lines = [];
  if (ctx.gameover !== undefined && ctx.gameover !== null) {
    lines.push(`GAME OVER — ${JSON.stringify(ctx.gameover)}`);
  }
  if (G.phase === 'characterSelect') {
    lines.push(`Character select. Turn: seat ${ctx.currentPlayer}.${ctx.currentPlayer === seat ? ' YOUR TURN — pick with selectCharacter(characterId).' : ''}`);
  } else {
    lines.push(`Turn ${G.totalTurns}, seat ${ctx.currentPlayer} to act (turnPhase: ${G.turnPhase}).${ctx.currentPlayer === seat ? ' YOUR TURN.' : ''}`);
  }
  for (const p of G.players) {
    const you = p.id === seat ? ' (you)' : '';
    const status = p.bankrupt ? ' BANKRUPT' : (p.inJail ? ' IN JAIL' : '');
    lines.push(`  seat ${p.id}${you}: ${p.character ? p.character.name : '(no character)'} $${p.money} @ ${spaceName(G, p.position)} props:${p.properties.length}${status}`);
  }
  // Decision point (exactly one of these sub-states can be open at a time).
  if (G.canBuy && ctx.currentPlayer === seat) {
    lines.push(`DECISION: you may buyProperty (${spaceName(G, G.players[Number(seat)].position)} for $${G.effectivePrice}) or passProperty (starts an auction).`);
  }
  if (G.pendingCard && ctx.currentPlayer === seat) {
    // Redraw eligibility mirror of Game.js's redrawCard guard (merchant passive
    // = unlimited free redraws; otherwise player.luckRedraws > 0) — same
    // condition legal-moves.js uses to decide whether to list redrawCard at
    // all. Ticket: this line previously offered "or redrawCard" unconditionally,
    // even to a seat with zero redraws left and no merchant passive.
    const p = G.players[Number(seat)];
    const canRedraw = isMerchant(p) || (p && p.luckRedraws > 0);
    lines.push(`DECISION: card drawn — "${G.pendingCard.card ? G.pendingCard.card.text : ''}" — acceptCard${canRedraw ? ' or redrawCard' : ''}.`);
  }
  if (G.awaitingRoute && ctx.currentPlayer === seat) {
    lines.push('DECISION: choose a route — commitRoute(route) (see list_legal_moves for choices).');
  }
  if (G.trade) {
    const t = G.trade;
    const role = t.targetPlayerId === seat ? 'YOU are the target: acceptTrade or rejectTrade' : (t.proposerId === seat ? 'you proposed (cancelTrade to withdraw)' : 'waiting');
    lines.push(`TRADE pending: seat ${t.proposerId} -> seat ${t.targetPlayerId}: offers [${t.offeredProperties.map(id => spaceName(G, id)).join(', ')}] +$${t.offeredMoney} for [${t.requestedProperties.map(id => spaceName(G, id)).join(', ')}] +$${t.requestedMoney}. ${role}.`);
  }
  if (G.auction) {
    const a = G.auction;
    const active = a.bidders[a.currentBidderIndex].playerId;
    lines.push(`AUCTION on ${spaceName(G, a.propertyId)}: current bid $${a.currentBid}${a.currentBidder !== null ? ` by seat ${a.currentBidder}` : ''}; seat ${active} to bid${active === seat ? ' — YOU: placeBid(amount) or passAuction' : ''}.`);
  }
  if (G.duel) {
    const d = G.duel;
    if (d.phase === 'offer' && d.challengerId === seat) {
      const blocked = isDuelCooldownBlocked(G.players[Number(d.challengerId)], G.totalTurns);
      lines.push(`DECISION: rent $${d.rent} due on ${spaceName(G, d.propertyId)} to seat ${d.ownerId} — payRent, or initiateDuel${blocked ? ' (COOLDOWN — unavailable)' : ` (win: waived; lose: $${Math.round(RULES.duel.loseMultiplier * d.rent)})`}.`);
    } else if (d.phase === 'response' && d.ownerId === seat) {
      lines.push(`DECISION: seat ${d.challengerId} challenges you over ${spaceName(G, d.propertyId)} (rent $${d.rent}) — respondDuel (fight) or declineDuel (take normal rent).`);
    } else {
      lines.push(`DUEL ${d.phase} on ${spaceName(G, d.propertyId)} between seats ${d.challengerId} and ${d.ownerId}.`);
    }
  }
  // Persuasion windows (MT2-SP5 direction C2 "舌战群儒", T4) — deliberately
  // NOT "DECISION:" lines like canBuy/pendingCard/awaitingRoute/duel above:
  // these are OPTIONAL side actions (the game proceeds normally whether or
  // not the seat uses them), so a distinct "PERSUASION:" prefix avoids
  // implying the seat must act before anything else can happen. Reuses
  // canAttempt directly — a window is hinted here IFF attemptPersuasion
  // would actually be dispatchable right now (same predicate
  // list_legal_moves uses), so this silently disappears whenever
  // RULES.persuasion.enabled is false — including the server-side
  // online-disable gate (T4 item 1) — with zero extra code.
  const persuasionRules = resolvePersuasionRules(RULES);
  const persuasionState = G.persuasion || {};
  const persuasionHint = (kind, targetSeat, label) => {
    if (!canAttempt(G, ctx, kind, seat, targetSeat, RULES).ok) return;
    const globalLeft = persuasionRules.globalCapPerGame - globalAttemptCount(persuasionState.globalUsed, seat);
    lines.push(`PERSUASION: you may attemptPersuasion(kind:'${kind}', targetSeat:'${targetSeat}') — ${label} (${globalLeft} attempt(s) left this game).`);
  };
  if (G.lastRentPayment && String(G.lastRentPayment.payerSeat) === seat) {
    persuasionHint('rent', G.lastRentPayment.ownerSeat, `ask for a refund on the $${G.lastRentPayment.amount} rent you just paid this turn`);
  }
  if (G.duel && G.duel.phase === 'response' && String(G.duel.challengerId) === seat) {
    persuasionHint('duel', G.duel.ownerId, 'taunt before they respond to your duel challenge');
  }
  if (G.trade && String(G.trade.proposerId) === seat) {
    persuasionHint('trade', G.trade.targetPlayerId, 'lower their acceptance threshold for your pending trade offer');
  }
  return lines.join('\n');
}
