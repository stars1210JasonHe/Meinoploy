// Atlas Balance Sim — net-worth scoring for the turn-cap tiebreak (D5).
//
// Game.js computes standings via getTotalAssets()/rankStandings() but does NOT
// export them, and this task must not modify the engine. So this module RE-IMPLEMENTS
// the exact same math (verified against Game.js getTotalAssets + rankStandings) for
// use only at the sim turn cap. When the engine declares its own gameover the sim
// trusts over.standings directly — this code only runs on the maxTurns path.

import { RULES } from '../../mods/dominion/rules';

// Mirror of Game.getTotalAssets: cash + property value (mortgaged → mortgage payout,
// else full price) + summed building costs. No season mod (matches the engine: it
// floors mortgage/building values without applying the live season multiplier here).
export function getTotalAssets(G, player) {
  let total = player.money;
  player.properties.forEach(pid => {
    const mortgaged = G.mortgaged && G.mortgaged[pid];
    total += mortgaged
      ? Math.floor(G.board.spaces[pid].price * RULES.core.mortgageRate)
      : G.board.spaces[pid].price;
    const level = G.buildings[pid] || 0;
    for (let i = 1; i <= level; i++) {
      total += Math.floor(G.board.spaces[pid].price * RULES.buildings.upgradeCostMultipliers[i - 1]);
    }
  });
  return total;
}

function ownsColorGroup(G, playerId, color) {
  if (!color || !G.board.colorGroups[color]) return false;
  return G.board.colorGroups[color].every(id => G.ownership[id] === playerId);
}

function countFullGroups(G, playerId) {
  let n = 0;
  for (const color in G.board.colorGroups) {
    if (ownsColorGroup(G, playerId, color)) n++;
  }
  return n;
}

// Mirror of Game.rankStandings: sort by net worth desc, tie-break cash desc, then id asc.
export function rankStandings(G, players) {
  return players
    .map(p => ({
      id: p.id,
      score: getTotalAssets(G, p),
      props: p.properties.length,
      groups: countFullGroups(G, p.id),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const am = G.players[parseInt(a.id)].money;
      const bm = G.players[parseInt(b.id)].money;
      if (bm !== am) return bm - am;
      return parseInt(a.id) - parseInt(b.id);
    });
}
