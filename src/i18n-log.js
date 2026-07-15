// src/i18n-log.js — event-driven, locale-aware game log (Task 4).
// Spec: docs/superpowers/specs/2026-07-15-localization-design.md §3.
//
// The drawer LOG renders from G.events (append-only, capped, seq-monotonic —
// see src/events.js), not G.messages (a per-turn RESET BUFFER). This module
// is the only consumer that turns an event stream into display lines:
//
//   en   — every event delegates to the engine's OWN formatEventMessage
//          (imported from ./events, pure). That guarantees byte parity with
//          today's G.messages content, including null-filtering (event-only
//          types like 'game_over'/'duel_offered'/'route_committed' never
//          produce a line). See src/__tests__/i18n-log.test.js for the
//          parity proof against the golden fixtures
//          (src/__tests__/fixtures/golden-messages.json).
//
//   zh   — ZH_FORMATTERS covers every one of events.js's 42 registered event
//          types. Types that are always- or conditionally-null in EN return
//          null under the EXACT SAME conditions in zh (a half-rendered event
//          would be worse than a missing one). Any type NOT in the table —
//          only reachable if events.js grows a new type after this table
//          was written — falls back to the EN formatter rather than
//          throwing or leaving a blank line: see formatLogLine below and the
//          coverage test in i18n-log.test.js for the documented tradeoff
//          (silent EN fallback beats a broken zh log for an unknown type).
//
// Player/character/place NAMES, mod-level DATA strings (space names, card
// body text, building level names) and $ amounts are never localized here —
// only the surrounding sentence structure is (spec §5: mod content
// translation is out of scope for v1).
//
// logLineKind() also lives here (not App.js): the good/bad/neutral CSS class
// used to key off the RENDERED TEXT (regex over English keywords), which
// silently breaks the moment the same line renders in zh. It now keys off
// the event's TYPE + DATA (locale-invariant) instead — see the file-level
// comment above logLineKind for the exact mapping and its known, documented
// deviations from the legacy regex's occasional false calls.

import { formatEventMessage, playerName } from './events';
import { RULES } from '../mods/active-rules';
import { t } from './i18n';

function deckLabelZh(deck) {
  return deck === 'chance' ? t('tile.type.chance') : t('tile.type.community');
}

function seasonNameZh(season) {
  return t('season.name.' + season.id);
}

// ── zh formatter table (one entry per events.js TYPE_LIST member) ─────────
const ZH_FORMATTERS = {
  dice_rolled(actor, data, G) {
    return `${playerName(G.players[actor])} 掷出 ${data.d1} + ${data.d2} = ${data.total}`;
  },

  // route_committed: unhandled in the EN switch too (falls to `default:
  // return null`, formatEventMessage) — no rendered line in either locale.
  // Explicit entry (rather than relying on the EN fallback) so the coverage
  // test can assert ALL 42 registered types, not 41-plus-one-exception.
  route_committed() {
    return null;
  },

  moved(actor, data, G) {
    if (data.routeExhausted) return '前方无路可走——路线到此为止。';
    return `到达 ${G.board.spaces[data.to].name}。`;
  },

  landing_notice(actor, data, G) {
    const space = data.propertyId !== undefined ? G.board.spaces[data.propertyId] : null;
    switch (data.note) {
      case 'available':
        return data.effectivePrice < data.listPrice
          ? `${space.name} 可供购买！标价 $${data.listPrice}，你的价格 $${data.effectivePrice}。购买还是放弃？`
          : `${space.name} 可以 $${data.effectivePrice} 购买。购买还是放弃？`;
      case 'unaffordable':
        return `${space.name} 需要 $${data.price}，但你只有 $${data.playerMoney}。`;
      case 'owned':
        return `你已拥有 ${space.name}。`;
      case 'visiting_jail':
        return '只是路过监狱。';
      case 'parking_relax':
        return '免费停车——放松一下！';
      default:
        return null;
    }
  },

  salary_collected(actor, data, G) {
    if (data.source === 'hub') return `${playerName(G.players[actor])} 途经资本枢纽！领取 $${data.amount}。`;
    if (data.source === 'parking') return `免费停车奖池！获得 $${data.amount}！`;
    return `经过起点！领取 $${data.amount}。`;
  },

  passive_triggered(actor, data, G) {
    if (data.passive === 'idealist' && data.effect === 'go_bonus') {
      return data.context === 'hub'
        ? `成长愿景：在资本枢纽额外获得 $${data.amount}！`
        : `成长愿景：路经起点额外获得 $${data.amount}！`;
    }
    if (data.passive === 'financier' && data.effect === 'loss_reduced') {
      if (data.context === 'tax') return `金融专长将税额降至 $${data.amount}。`;
      return `金融专长将损失降至 $${data.amount}。`;
    }
    if (data.passive === 'arbitrageur' && data.effect === 'bankruptcy_bonus') {
      return `${playerName(G.players[actor])} 从危机套利中获得 $${data.amount}！`;
    }
    return null;
  },

  rent_paid(actor, data, G) {
    return `向 ${playerName(G.players[data.ownerId])} 支付 ${G.board.spaces[data.propertyId].name} 租金 $${data.amount}。`;
  },

  tax_paid(actor, data, G) {
    return `缴纳 ${G.board.spaces[data.spaceId].name}：$${data.amount}。`;
  },

  card_drawn(actor, data) {
    if (data.empty) return '牌堆已空。';
    return `${deckLabelZh(data.deck)}：${data.text}`;
  },

  card_prompt() {
    return '你可以接受此卡牌，或选择重抽。';
  },

  card_applied(actor, data, G) {
    switch (data.action) {
      case 'payPercent':
        return `总资产：$${data.effect.assets}。缴纳 $${data.effect.amount}（${data.effect.percent}%）。`;
      case 'gainAll':
        return `所有玩家获得 $${data.effect.amount}！`;
      case 'gainPerProperty':
        return `${data.effect.count} 处地产 × $${data.effect.perProperty} = 获得 $${data.effect.amount}！`;
      case 'freeUpgrade':
        if (data.effect.outcome === 'upgraded') return `免费升级！${data.effect.targetSpaceName} 升级为 ${data.effect.newLevelName}！`;
        return '没有可免费升级的地产。';
      case 'downgrade':
        if (data.effect.outcome === 'downgraded') return `市场崩盘！${data.effect.targetSpaceName} 降级为 ${data.effect.newLevelName}。`;
        return '没有可降级的建筑。';
      case 'forceBuy':
        if (data.effect.outcome === 'bought') return `恶意收购！以 $${data.effect.cost} 从 ${playerName(G.players[data.effect.targetOwnerId])} 手中买下 ${data.effect.targetSpaceName}！`;
        if (data.effect.outcome === 'insufficient_funds') return `资金不足，无法发起恶意收购（需要 $${data.effect.cost}）。`;
        return '没有可供恶意收购的对手地产。';
      // 'gain'/'pay'/'moveTo'/'goToJail' — data-only in EN too, no message.
      default:
        return null;
    }
  },

  card_redrawn(actor, data) {
    return `重抽！${deckLabelZh(data.deck)}：${data.newText}`;
  },

  went_to_jail(actor, data) {
    if (data.reason === 'card') return null;
    return data.reason === 'triples' ? '三连对子！直接入狱！' : '入狱！';
  },

  left_jail(actor, data) {
    if (data.how === 'doubles') return '掷出对子！你自由了！';
    return `在狱中服刑 ${data.maxTurns} 回合，缴纳 $${data.fine} 罚金。`;
  },

  jail_wait(actor, data) {
    return `仍在狱中。第 ${data.turn}/${data.maxTurns} 回合。`;
  },

  jail_fine_paid(actor, data, G) {
    if (data.failed) return `资金不足，无法缴纳 $${data.fine} 罚金！`;
    return `${playerName(G.players[actor])} 缴纳 $${data.fine} 罚金出狱。`;
  },

  jail_reminder(actor, data, G) {
    return `${playerName(G.players[actor])} 正在狱中。缴纳 $${data.fine} 罚金，或尝试掷出对子越狱。`;
  },

  property_upgraded(actor, data, G) {
    return `在 ${G.board.spaces[data.propertyId].name} 建造 ${data.newLevelName}，花费 $${data.cost}！`;
  },

  building_sold(actor, data, G) {
    const soldLevel = data.newLevel + 1;
    return `出售 ${G.board.spaces[data.propertyId].name} 上的 ${RULES.buildings.names[soldLevel]}，获得 $${data.refund}。现为：${RULES.buildings.names[data.newLevel]}。`;
  },

  property_mortgaged(actor, data, G) {
    return `抵押 ${G.board.spaces[data.propertyId].name}，获得 $${data.amount}。`;
  },

  property_unmortgaged(actor, data, G) {
    return `赎回 ${G.board.spaces[data.propertyId].name}，花费 $${data.cost}。`;
  },

  property_regulated(actor, data, G) {
    return `${playerName(G.players[actor])} 对 ${G.board.spaces[data.propertyId].name} 实施管控！（租金 +${RULES.passives.enforcer.regulatedRentBonus * 100}%）`;
  },

  reroll_used(actor, data, G) {
    return `${playerName(G.players[actor])} 使用重掷！（剩余 ${data.rerollsLeft} 次）`;
  },

  character_selected(actor, data, G) {
    if (data.allSelected) return `所有角色已选定！游戏开始！由 ${playerName(G.players[0])} 先掷骰。`;
    return data.affinityBonus > 0
      ? `${playerName(G.players[actor])} 加入游戏！（$${data.money}，+$${data.affinityBonus} 世界亲和加成）`
      : `${playerName(G.players[actor])} 加入游戏！（$${data.money}）`;
  },

  property_bought(actor, data, G) {
    return `以 $${data.paidPrice} 买下 ${G.board.spaces[data.propertyId].name}！`;
  },

  property_passed() {
    return '放弃购买。';
  },

  season_changed(actor, data) {
    const season = RULES.seasons.list[data.seasonIndex];
    return `${season.icon} 季节变为${seasonNameZh(season)}！`;
  },

  bankruptcy(actor, data, G) {
    return `${playerName(G.players[actor])} 破产了！`;
  },

  trade_proposed(actor, data, G) {
    return `${playerName(G.players[actor])} 向 ${playerName(G.players[data.targetPlayerId])} 提议交易！`;
  },

  trade_accepted(actor, data, G) {
    return `交易达成！${playerName(G.players[data.proposerId])} 与 ${playerName(G.players[actor])} 完成了交易。`;
  },

  trade_rejected(actor, data, G) {
    return `${playerName(G.players[actor])} 拒绝了交易。`;
  },

  trade_cancelled() {
    return '交易已取消。';
  },

  auction_started(actor, data, G) {
    return `${G.board.spaces[data.propertyId].name} 进入拍卖！起拍价 $${RULES.auction.startingBid}。`;
  },

  auction_turn(actor, data, G) {
    return `轮到 ${playerName(G.players[data.bidderId])} 出价。`;
  },

  bid_placed(actor, data, G) {
    return `${playerName(G.players[actor])} 出价 $${data.amount}！`;
  },

  auction_passed(actor, data, G) {
    return `${playerName(G.players[actor])} 弃权。`;
  },

  auction_ended(actor, data, G) {
    if (data.winnerId === null) return `无人出价。${G.board.spaces[data.propertyId].name} 仍未被认领。`;
    return `${playerName(G.players[data.winnerId])} 以 $${data.amount} 拍得 ${G.board.spaces[data.propertyId].name}！`;
  },

  // game_over: always null in EN (event-only, no pre-migration G.messages
  // site ever announced it) — same in zh.
  game_over() {
    return null;
  },

  // duel_offered: UI prompt only, no log line in EN — same in zh.
  duel_offered() {
    return null;
  },

  duel_initiated(actor, data, G) {
    return `${playerName(G.players[actor])} 向 ${playerName(G.players[data.ownerId])} 发起决斗，争夺 ${G.board.spaces[data.propertyId].name}！`;
  },

  duel_declined(actor, data, G) {
    return `${playerName(G.players[actor])} 拒绝了决斗。`;
  },

  duel_resolved(actor, data, G) {
    return `决斗！${playerName(G.players[actor])} ${data.challengerRoll.total} 对 ${playerName(G.players[data.ownerId])} ${data.defenderRoll.total}——${playerName(G.players[data.winnerId])} 获胜！`;
  },
};

// Renders a single already-logged event { type, actor, data } (a G.events
// entry) to a display string, or null for an event-only type (no line, in
// either locale). `en` always delegates to the engine's own
// formatEventMessage — see the file header for why that's the byte-parity
// guarantee. `zh` consults ZH_FORMATTERS; a type with no entry (forward-compat
// only — every type known at the time this file was written IS covered, see
// the coverage test) falls back to the EN formatter rather than blanking.
export function formatLogLine(ev, locale, G) {
  if (locale === 'zh') {
    const fn = ZH_FORMATTERS[ev.type];
    if (fn) return fn(ev.actor, ev.data, G);
  }
  return formatEventMessage(ev.type, ev.actor, ev.data, G);
}

// ── visual classification (good/bad/neutral) ───────────────────────────────
// The legacy renderMessages() classified lines by regex over the RENDERED
// (English) text — silently wrong the moment the same line renders in zh.
// This keys off the event's TYPE + DATA instead (locale-invariant structured
// fields, never the rendered string), verified to reproduce the legacy
// regex's classification for every line the golden fixtures actually
// exercise (src/__tests__/i18n-log.test.js). For types/branches NOT exercised
// by any golden scenario, the class below is a deliberate semantic judgement
// call (money/status gained -> good, lost -> bad, informational -> neutral)
// and in a few documented cases intentionally DEVIATES from what the legacy
// regex would have produced had it been fed that (untested) English text —
// see the per-case comments — because the regex's classification there was
// itself an accident of keyword substring matching (e.g. "You're free from
// jail!" reads as *bad* today purely because it contains "jail").
const CARD_DRAW_KIND = {
  gain: 'good', gainAll: 'good', gainPerProperty: 'good', freeUpgrade: 'good',
  pay: 'bad', payPercent: 'bad', goToJail: 'bad', downgrade: 'bad',
  // forceBuy/moveTo: neutral at ANNOUNCE time (the effect hasn't happened
  // yet) — matches the legacy regex's classification of the announce-time
  // text for every golden-covered card (see i18n-log.test.js).
  forceBuy: 'neutral', moveTo: 'neutral',
};

function cardActionAt(deck, cardIndex, G) {
  if (cardIndex === null || cardIndex === undefined) return null;
  const list = deck === 'chance' ? G.board.chanceCards : G.board.communityCards;
  return list && list[cardIndex] ? list[cardIndex].action : null;
}

function cardAppliedKind(data) {
  switch (data.action) {
    case 'gain':
    case 'gainAll':
    case 'gainPerProperty':
      return 'good';
    case 'pay':
    case 'payPercent':
    case 'goToJail':
      return 'bad';
    case 'freeUpgrade':
      return data.effect && data.effect.outcome === 'upgraded' ? 'good' : 'neutral';
    case 'downgrade':
      return data.effect && data.effect.outcome === 'downgraded' ? 'bad' : 'neutral';
    case 'forceBuy':
      return data.effect && data.effect.outcome === 'bought' ? 'good' : 'neutral';
    default:
      return 'neutral';
  }
}

export function logLineKind(ev, G) {
  const { type, data } = ev;
  switch (type) {
    case 'property_bought':
    case 'duel_resolved':
    case 'salary_collected':
      return 'good';

    case 'rent_paid':
    case 'tax_paid':
    case 'bankruptcy':
    case 'went_to_jail':
    case 'jail_wait':
    case 'jail_reminder':
    case 'jail_fine_paid': // both success (paid to escape) and failed (couldn't afford)
      return 'bad';

    // Deviation from the legacy regex (which marks BOTH branches bad purely
    // via the "jail" substring): doubles-escape is unambiguous good news;
    // paying-out-the-clock still costs a fine, so stays bad. Neither branch
    // is golden-covered, so this is free to be the more honest call.
    case 'left_jail':
      return data.how === 'doubles' ? 'good' : 'bad';

    case 'landing_notice':
      // 'visiting_jail' ("Just visiting jail.") is golden-covered as BAD
      // (legacy regex's "jail" substring) — preserved as-is even though it's
      // purely informational, to keep the golden-scenario visual identical.
      return data.note === 'visiting_jail' ? 'bad' : 'neutral';

    case 'passive_triggered':
      if (data.passive === 'idealist') return 'good'; // untested; a clear gain
      if (data.passive === 'financier') return 'bad'; // untested; still paying, just less
      return 'neutral'; // arbitrageur bonus — golden-covered as neutral

    case 'card_drawn':
    case 'card_redrawn':
      return CARD_DRAW_KIND[cardActionAt(data.deck, data.cardIndex, G)] || 'neutral';

    case 'card_applied':
      return cardAppliedKind(data);

    // Deviation from the legacy regex (neutral, via "rent" substring miss):
    // regulating is an empowering action for the actor. Untested by golden
    // fixtures, free to be the more honest call.
    case 'property_regulated':
      return 'good';

    case 'auction_ended':
      return data.winnerId === null ? 'neutral' : 'good';

    default:
      return 'neutral';
  }
}

// Renders every event in `events` (chronological order, oldest first — same
// order G.events is stored in) to { type, kind, text } for the ones that
// produce a line (event-only types are dropped, matching G.messages'
// null-filtering). No windowing/slicing here — G.events is already capped
// (events.js's EVENT_LOG_CAP_FALLBACK / RULES.core.eventLogCap) and the log
// now intentionally shows the WHOLE history rather than G.messages' old
// per-turn reset window (spec §3: "Locale switch re-renders the WHOLE log
// history"). Callers reverse for newest-first display, same as the legacy
// G.messages.map(...).reverse() did.
export function renderLogLines(events, locale, G) {
  const lines = [];
  for (const ev of events) {
    const text = formatLogLine(ev, locale, G);
    if (text !== null) lines.push({ type: ev.type, kind: logLineKind(ev, G), text });
  }
  return lines;
}

// Exposed for the coverage test (i18n-log.test.js) — not part of the public
// rendering API.
export { ZH_FORMATTERS as _ZH_FORMATTERS };
