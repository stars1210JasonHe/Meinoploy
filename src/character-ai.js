// CharacterAI — AI integration module for character responses and chat
// Calls OpenAI API to generate in-character dialogue based on lore + game state
import { playerName } from './events';

// Event types that trigger AI responses
export const EVENT_TYPES = {
  ROLL_DICE: 'roll_dice',
  LAND_PROPERTY_BUY: 'land_property_buy',
  LAND_PROPERTY_RENT: 'land_property_rent',
  PAY_TAX: 'pay_tax',
  DRAW_CARD: 'draw_card',
  GO_TO_JAIL: 'go_to_jail',
  PASS_GO: 'pass_go',
  BUY_PROPERTY: 'buy_property',
  UPGRADE_PROPERTY: 'upgrade_property',
  AUCTION_START: 'auction_start',
  TRADE_PROPOSED: 'trade_proposed',
  BANKRUPTCY: 'bankruptcy',
  SEASON_CHANGE: 'season_change',
  GAME_OVER: 'game_over',
};

// Events considered "major" for the "Major events only" verbosity mode
const MAJOR_EVENTS = new Set([
  EVENT_TYPES.LAND_PROPERTY_BUY,
  EVENT_TYPES.LAND_PROPERTY_RENT,
  EVENT_TYPES.DRAW_CARD,
  EVENT_TYPES.GO_TO_JAIL,
  EVENT_TYPES.BUY_PROPERTY,
  EVENT_TYPES.UPGRADE_PROPERTY,
  EVENT_TYPES.AUCTION_START,
  EVENT_TYPES.TRADE_PROPOSED,
  EVENT_TYPES.BANKRUPTCY,
  EVENT_TYPES.SEASON_CHANGE,
  EVENT_TYPES.GAME_OVER,
]);

// Verbosity modes
export const VERBOSITY = {
  OFF: 'off',
  MAJOR: 'major',
  ALL: 'all',
};

// Human-readable labels for went_to_jail's data.reason ('space'/'triples'/'card')
// — read by mapEngineEventToAi, not by the engine's own formatter (events.js
// already has its own byte-identical G.messages strings for these reasons;
// this is a separate, AI-prompt-facing phrasing).
const JAIL_REASON_LABELS = {
  space: 'Go To Jail space',
  triples: 'Triple doubles',
  card: 'a Chance/Community Chest card',
};

// Pure adapter: engine event (from G.events, shape {seq,turn,type,actor,data})
// -> { eventType, eventData } for the AI's own EVENT_TYPES/​_formatEventContext,
// or null when the engine type has no AI reaction (unmapped, or filtered by a
// sub-condition like landing_notice's note or salary_collected's source).
// G is read-only here — only used to resolve names/space labels off ids
// already carried in the payload (never re-derives amounts from live state).
export function mapEngineEventToAi(event, G) {
  if (!event) return null;
  const { type, actor, data } = event;

  switch (type) {
    case 'dice_rolled':
      return {
        eventType: EVENT_TYPES.ROLL_DICE,
        eventData: { d1: data.d1, d2: data.d2, total: data.total, isDoubles: data.doubles },
      };

    // Only the 'available' note is a buy prompt — 'unaffordable'/'owned'/
    // 'visiting_jail'/'parking_relax' carry no buy decision and must not
    // trigger a LAND_PROPERTY_BUY reaction.
    case 'landing_notice': {
      if (data.note !== 'available') return null;
      const space = G.board.spaces[data.propertyId];
      const player = G.players[actor];
      return {
        eventType: EVENT_TYPES.LAND_PROPERTY_BUY,
        eventData: { spaceName: space.name, price: data.effectivePrice, money: player ? player.money : 0 },
      };
    }

    case 'rent_paid': {
      const space = G.board.spaces[data.propertyId];
      return {
        eventType: EVENT_TYPES.LAND_PROPERTY_RENT,
        eventData: { spaceName: space.name, ownerName: playerName(G.players[data.ownerId]), rent: data.amount },
      };
    }

    case 'tax_paid':
      return { eventType: EVENT_TYPES.PAY_TAX, eventData: { amount: data.amount } };

    // data.empty (deck exhausted) -> no AI reaction (parity with old string sniffer)
    case 'card_drawn':
      if (data.empty) return null;
      return {
        eventType: EVENT_TYPES.DRAW_CARD,
        eventData: { cardText: data.text },
      };

    case 'went_to_jail':
      return {
        eventType: EVENT_TYPES.GO_TO_JAIL,
        eventData: { reason: JAIL_REASON_LABELS[data.reason] || data.reason },
      };

    // Only the GO-crossing salary is a "passed GO" moment — hub/parking/card
    // salary sources are real money but not this specific reaction.
    case 'salary_collected': {
      if (data.source !== 'go') return null;
      return { eventType: EVENT_TYPES.PASS_GO, eventData: { amount: data.amount } };
    }

    case 'property_bought': {
      const space = G.board.spaces[data.propertyId];
      return { eventType: EVENT_TYPES.BUY_PROPERTY, eventData: { spaceName: space.name, price: data.paidPrice } };
    }

    case 'property_upgraded': {
      const space = G.board.spaces[data.propertyId];
      return {
        eventType: EVENT_TYPES.UPGRADE_PROPERTY,
        eventData: { spaceName: space.name, levelName: data.newLevelName, cost: data.cost },
      };
    }

    case 'auction_started': {
      const space = G.board.spaces[data.propertyId];
      return { eventType: EVENT_TYPES.AUCTION_START, eventData: { spaceName: space.name } };
    }

    case 'trade_proposed':
      return {
        eventType: EVENT_TYPES.TRADE_PROPOSED,
        eventData: { targetName: playerName(G.players[data.targetPlayerId]) },
      };

    case 'bankruptcy':
      return {
        eventType: EVENT_TYPES.BANKRUPTCY,
        eventData: { playerName: playerName(G.players[actor]) },
      };

    case 'season_changed':
      return { eventType: EVENT_TYPES.SEASON_CHANGE, eventData: { newSeason: data.seasonName } };

    case 'game_over': {
      const winnerId = data.result && data.result.winner;
      const winnerName = (winnerId !== undefined && winnerId !== null) ? playerName(G.players[winnerId]) : '';
      return { eventType: EVENT_TYPES.GAME_OVER, eventData: { winnerName } };
    }

    default:
      return null;
  }
}

// Pure cursor-advance helper for detectAndTriggerAI's lazy seq cursor
// (App.js — a DOM-bound class method, so the cursor arithmetic is extracted
// here to stay unit-testable). `events` is G.events (seq-monotonic, front-
// trimmed at the cap); `lastSeq` is the caller's last-seen seq.
//
// lastSeq === undefined (first sight of G.events — new game, load, exit-to-
// menu restart, mid-match online join) -> lazy-init: absorb everything
// already present WITHOUT firing (newEvents: []), cursor set to the current
// max seq (-1 if there are no events yet, so seq 0 is still "new" next call).
//
// Otherwise -> incremental: return events with seq > lastSeq, in order.
// Trim-gap (lastSeq older than the oldest remaining seq, because the cap
// trimmed everything in between) needs no special case: filtering by
// seq > lastSeq already returns every event still present, which IS "skip to
// oldest available" — there is nothing older left to skip past.
export function consumeNewEvents(events, lastSeq) {
  const list = events || [];
  if (lastSeq === undefined) {
    const nextSeq = list.length ? list[list.length - 1].seq : -1;
    return { newEvents: [], nextSeq };
  }
  const newEvents = list.filter(e => e.seq > lastSeq);
  const nextSeq = newEvents.length ? newEvents[newEvents.length - 1].seq : lastSeq;
  return { newEvents, nextSeq };
}

export class CharacterAI {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey || '';
    this.model = options.model || 'gpt-4o-mini';
    this.chatModel = options.chatModel || 'gpt-4o';
    this.verbosity = options.verbosity || VERBOSITY.MAJOR;
    this._pendingRequests = 0;
    this.maxConcurrent = 2;
  }

  isEnabled() {
    return this.apiKey && this.verbosity !== VERBOSITY.OFF;
  }

  shouldRespond(eventType) {
    if (!this.isEnabled()) return false;
    if (this.verbosity === VERBOSITY.ALL) return true;
    if (this.verbosity === VERBOSITY.MAJOR) return MAJOR_EVENTS.has(eventType);
    return false;
  }

  setApiKey(key) {
    this.apiKey = key || '';
  }

  setVerbosity(mode) {
    if (Object.values(VERBOSITY).includes(mode)) {
      this.verbosity = mode;
    }
  }

  // Build a system prompt from character data + lore
  buildSystemPrompt(character, lore) {
    const parts = [];

    parts.push(`You are ${character.name}, ${character.title}.`);

    if (lore) {
      if (lore.titleZh) parts.push(`Chinese title: ${lore.titleZh}`);
      if (lore.identity) parts.push(`Identity: ${lore.identity}`);
      if (lore.alignment) parts.push(`Alignment: ${lore.alignment}`);

      if (lore.background) {
        // Take first paragraph as concise background
        const firstPara = lore.background.split('\n\n')[0];
        parts.push(`\nBackground: ${firstPara}`);
      }

      if (lore.style && lore.style.length > 0) {
        parts.push('\nYour philosophy:');
        lore.style.forEach((s, i) => {
          // Strip markdown bold markers
          parts.push(`${i + 1}. ${s.replace(/\*\*/g, '')}`);
        });
      }

      if (lore.relationships && lore.relationships.length > 0) {
        parts.push('\nYour relationships with other council members:');
        lore.relationships.forEach(r => {
          parts.push(`- ${r.target}: ${r.description}`);
        });
      }

      if (lore.themeSummary) {
        parts.push(`\nCore theme: ${lore.themeSummary.replace(/\n/g, ' ')}`);
      }
    }

    const s = character.stats;
    parts.push(`\nYour game stats: Capital ${s.capital}, Luck ${s.luck}, Negotiation ${s.negotiation}, Charisma ${s.charisma}, Tech ${s.tech}, Stamina ${s.stamina}.`);
    parts.push(`Your ability: ${character.passive.name} — ${character.passive.description}`);

    parts.push('\nRules for your responses:');
    parts.push('- Keep responses to 1-2 sentences max');
    parts.push('- Stay in character always');
    parts.push('- React based on your personality and philosophy');
    parts.push('- Reference your relationships with other characters when relevant');
    parts.push('- Use your character\'s speaking style (formal/casual/cryptic/bold as fits your personality)');
    parts.push('- You may use Chinese expressions or mix languages to reflect your identity');

    return parts.join('\n');
  }

  // Format game event context for the AI
  _formatEventContext(eventType, eventData, gameState) {
    const parts = [];

    if (gameState) {
      if (gameState.turnNumber !== undefined) parts.push(`Turn ${gameState.turnNumber}`);
      if (gameState.season) parts.push(`Season: ${gameState.season}`);
      if (gameState.money !== undefined) parts.push(`Your money: $${gameState.money}`);
      if (gameState.propertyCount !== undefined) parts.push(`Your properties: ${gameState.propertyCount}`);
    }

    switch (eventType) {
      case EVENT_TYPES.ROLL_DICE:
        parts.push(`You rolled ${eventData.d1} + ${eventData.d2} = ${eventData.total}${eventData.isDoubles ? ' (doubles!)' : ''}`);
        break;
      case EVENT_TYPES.LAND_PROPERTY_BUY:
        parts.push(`You landed on ${eventData.spaceName} (unowned, costs $${eventData.price}). You have $${eventData.money}.`);
        break;
      case EVENT_TYPES.LAND_PROPERTY_RENT:
        parts.push(`You landed on ${eventData.spaceName}, owned by ${eventData.ownerName}. You paid $${eventData.rent} in rent.`);
        break;
      case EVENT_TYPES.PAY_TAX:
        parts.push(`You paid $${eventData.amount} in tax.`);
        break;
      case EVENT_TYPES.DRAW_CARD:
        parts.push(`You drew a card: "${eventData.cardText}"`);
        break;
      case EVENT_TYPES.GO_TO_JAIL:
        parts.push(`You were sent to jail! Reason: ${eventData.reason || 'Go To Jail space'}`);
        break;
      case EVENT_TYPES.PASS_GO:
        parts.push(`You passed GO and collected $${eventData.amount}.`);
        break;
      case EVENT_TYPES.BUY_PROPERTY:
        parts.push(`You bought ${eventData.spaceName} for $${eventData.price}.`);
        break;
      case EVENT_TYPES.UPGRADE_PROPERTY:
        parts.push(`You upgraded ${eventData.spaceName} to ${eventData.levelName} for $${eventData.cost}.`);
        break;
      case EVENT_TYPES.AUCTION_START:
        parts.push(`Auction started for ${eventData.spaceName}!`);
        break;
      case EVENT_TYPES.TRADE_PROPOSED:
        parts.push(`A trade was proposed with ${eventData.targetName}.`);
        break;
      case EVENT_TYPES.BANKRUPTCY:
        parts.push(`${eventData.playerName} went bankrupt!`);
        break;
      case EVENT_TYPES.SEASON_CHANGE:
        parts.push(`Season changed to ${eventData.newSeason}.`);
        break;
      case EVENT_TYPES.GAME_OVER:
        parts.push(`Game over! ${eventData.winnerName} wins!`);
        break;
    }

    return parts.join(' | ');
  }

  // Format game state for chat context
  _formatGameStateContext(gameState) {
    if (!gameState) return '';
    const parts = [];
    if (gameState.turnNumber !== undefined) parts.push(`Turn ${gameState.turnNumber}`);
    if (gameState.season) parts.push(`Season: ${gameState.season}`);
    if (gameState.money !== undefined) parts.push(`You have $${gameState.money}`);
    if (gameState.propertyCount !== undefined) parts.push(`You own ${gameState.propertyCount} properties`);
    if (gameState.otherPlayers) parts.push(`Other players: ${gameState.otherPlayers}`);
    if (gameState.lastEvent) parts.push(`Last event: ${gameState.lastEvent}`);
    return parts.length > 0 ? '\n\nCurrent game state: ' + parts.join(', ') + '.' : '';
  }

  // Call OpenAI API
  async _callApi(messages, model) {
    if (!this.apiKey) throw new Error('No API key configured');

    // Simple concurrency guard
    if (this._pendingRequests >= this.maxConcurrent) return null;
    this._pendingRequests++;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: model || this.model,
          messages: messages,
          max_tokens: 150,
          temperature: 0.8,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
      }

      const data = await res.json();
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Unexpected OpenAI response structure');
      }
      return data.choices[0].message.content.trim();
    } finally {
      this._pendingRequests--;
    }
  }

  // Generate an event response (1-2 sentences, fast model)
  async respondToEvent(character, lore, eventType, eventData, gameState) {
    if (!this.shouldRespond(eventType)) return null;

    const systemPrompt = this.buildSystemPrompt(character, lore);
    const eventContext = this._formatEventContext(eventType, eventData, gameState);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Game event: ${eventContext}\n\nRespond briefly in character (1-2 sentences).` },
    ];

    try {
      return await this._callApi(messages, this.model);
    } catch (e) {
      console.warn('CharacterAI event response failed:', e.message);
      return null;
    }
  }

  // Multi-turn chat conversation (uses better model)
  async chat(character, lore, userMessage, history, gameState) {
    if (!this.apiKey) return null;

    const systemPrompt = this.buildSystemPrompt(character, lore) +
      this._formatGameStateContext(gameState) +
      '\n\nThe player is chatting with you. Respond conversationally but in-character. You can give game advice based on your personality and strategy style.';

    const messages = [{ role: 'system', content: systemPrompt }];

    // Add conversation history (keep last 10 exchanges = 20 messages)
    const recentHistory = (history || []).slice(-20);
    recentHistory.forEach(msg => {
      messages.push({ role: msg.role, content: msg.content });
    });

    messages.push({ role: 'user', content: userMessage });

    try {
      return await this._callApi(messages, this.chatModel);
    } catch (e) {
      console.warn('CharacterAI chat failed:', e.message);
      return null;
    }
  }

  // Quick intro chat for character selection
  async introduce(character, lore) {
    if (!this.apiKey) return null;

    const systemPrompt = this.buildSystemPrompt(character, lore);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Introduce yourself briefly. Who are you and what\'s your strategy?' },
    ];

    try {
      return await this._callApi(messages, this.model);
    } catch (e) {
      console.warn('CharacterAI intro failed:', e.message);
      return null;
    }
  }
}
