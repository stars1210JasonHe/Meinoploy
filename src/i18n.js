// src/i18n.js — locale core (spec 2026-07-15-localization-design.md §1).
//
// Flat string tables per locale (`STRINGS.zh` / `STRINGS.en`), a pure `t(key, params)`
// lookup with `{name}`-style interpolation, and a tiny locale-change pub/sub so UI owners
// (App.js today; game-chrome.js/entry-ui.js/Lobby.js in later tasks) can react when the
// user flips LANG. Missing-key policy: current-locale table -> EN table -> the key itself
// literally (NEVER blank), with one console.warn per missing key per session (dev aid, not
// user-facing).
//
// Module-level singleton state (by design — many call sites import `t` directly, mirroring
// game-chrome.js's existing `esc()` convention: a small pure helper imported everywhere
// rather than threaded through every function signature). localStorage access is guarded
// exactly like audio.js's mute persistence (`typeof localStorage` check + try/catch): under
// Jest's default 'node' testEnvironment (no jsdom, no docblock) `localStorage` doesn't
// exist at all, and even where it does exist it can throw (private browsing, quota, disabled
// storage) — either way i18n must keep working in-memory rather than crash the app.

const STORAGE_KEY = 'meinopoly_locale';
const DEFAULT_LOCALE = 'zh';

// Seed set (Task 1 proof set): the topbar buttons this task migrates. Later tasks append
// keys here screen-by-screen — see docs/superpowers/plans/2026-07-15-localization.md.
export const STRINGS = {
  zh: {
    'topbar.load': '读档',
    'topbar.ai': 'AI',
    'topbar.snd': '音效',
    'topbar.muted': '静音',
    'topbar.save': '存档',
    'topbar.exit': '退出',
    'topbar.full': '全屏',
    'topbar.fullExit': '退出全屏',
    // The LANG button shows the locale it will SWITCH TO, not the active one — so this
    // value (read while zh is active) is deliberately the English label 'EN'.
    'topbar.lang': 'EN',

    // Task 2 (entry screens): hero/menu (showModeSelect).
    'menu.localGame': '本地游戏',
    'menu.onlineGame': '在线游戏',
    'menu.pressStart': '按 START 键开始',
    'menu.modsWord': '个模组',
    'menu.tradeAuction': '交易与拍卖',
    'menu.heroAlt': 'Meinopoly：Dominion 主视觉',

    // Mod select (showModSelect).
    'mod.heading': '选择模组',
    'mod.subheading': '选择你想游玩的游戏世界',
    'mod.back': '返回',

    // Map select (showMapSelect) + shared map-card preview fallback (entry-ui.js).
    'map.heading': '选择地图',
    'map.subheading': '选择你想游玩的棋盘',
    'map.back': '返回',
    'map.places': '个地点',
    'map.spaces': '格',
    'map.previewFallback': '地图',
    'map.layoutAtlas': '图集',

    // Game setup (showSetup / _renderSetup).
    'setup.heading': '游戏设置',
    'setup.subheading': '玩家与胜利条件',
    'setup.players': '玩家人数',
    'setup.bots': '电脑玩家',
    'setup.modeSurvivalLabel': '生存到底',
    'setup.modeSurvivalDesc': '最后一位未破产的玩家获胜，经典淘汰模式。',
    'setup.modeWealthLabel': '限时 · 比拼财富',
    'setup.modeWealthDesc': '达到设定回合数后，净资产最高者获胜。',
    'setup.modeMonopolyLabel': '掌控天下',
    'setup.modeMonopolyDesc': '率先掌控设定数量的完整色组，立即获胜。',
    'setup.selected': '已选择',
    'setup.turnLimit': '回合上限',
    'setup.groupsToWin': '获胜所需色组数',
    'setup.back': '返回',
    'setup.start': '开始游戏',

    // Character select (renderCharacterSelect).
    'charselect.botPicking': 'BOT 选择中…',
    'charselect.player': '玩家 {n}',
    'charselect.heading': '选择你的角色',
    'charselect.subheading': '每位议员都拥有独特属性与被动技能。',
    'charselect.startMoney': '起始资金',
    'charselect.viewLore': '查看设定',
    'charselect.askAI': '咨询 AI',
    'charselect.taken': '已被选',
    'charselect.selected': '已选中',
    'charselect.selectPrompt': '请选择一位议员继续',
    'charselect.back': '返回',
    'charselect.beginGame': '开始游戏',
    'charselect.nextPlayer': '下一位玩家',

    // Results screen (renderResults).
    'results.victory': '胜利',
    'results.reasonDominion': '{name} 掌控了 {groups} 个色组。',
    'results.reasonMaxTurns': '回合已达上限——最富有者获胜。',
    'results.reasonSurvival': '{name} 是最后的幸存者。',
    'results.reasonDefault': '{name} 掌控了议会。',
    'results.finalStandings': '最终排名',
    'results.propsWord': '处地产',
    'results.playAgain': '再来一局',
    'results.playerFallback': '玩家 {n}',

    // Saves modal (showSavesModal).
    'saves.empty': '暂无存档，游戏进行中可保存进度。',
    'saves.playersWord': '位玩家',
    'saves.turnWord': '回合',
    'saves.load': '读取',
    'saves.delete': '删除',
    'saves.heading': '已保存的游戏',
    'saves.close': '关闭',

    // Online lobby (Lobby.js + App's showOnlineLobby).
    'lobby.heading': '在线大厅',
    'lobby.subheading': '创建或加入联机对局',
    'lobby.yourName': '你的名字',
    'lobby.namePlaceholder': '输入你的名字',
    'lobby.createGame': '创建游戏',
    'lobby.playersOption': '人',
    'lobby.create': '创建',
    'lobby.availableGames': '可用游戏',
    'lobby.refresh': '刷新',
    'lobby.backToMenu': '返回主菜单',
    'lobby.noGames': '暂无游戏，快去创建一个吧！',
    'lobby.slotWord': '座位',
    'lobby.gameWord': '对局',
    'lobby.joined': '已加入',
    'lobby.join': '加入',
    'lobby.full': '已满',

    // entry-ui.js: breadcrumb step labels (breadcrumbSteps).
    'breadcrumb.mode': '模式',
    'breadcrumb.mod': '模组',
    'breadcrumb.map': '地图',
    'breadcrumb.setup': '设置',
    'breadcrumb.character': '角色',

    // entry-ui.js: pluralize() — Chinese has no plural 's', so each word gets one
    // (count-invariant) zh template; English keeps the singular/plural split so the
    // legacy '1 MAP' / '4 MAPS' output is reproduced byte-for-byte via t() too.
    'entry.plural.map.one': '{n} 张地图',
    'entry.plural.map.other': '{n} 张地图',
    'entry.plural.character.one': '{n} 位角色',
    'entry.plural.character.other': '{n} 位角色',
  },
  en: {
    'topbar.load': 'LOAD',
    'topbar.ai': 'AI',
    'topbar.snd': 'SND',
    'topbar.muted': 'MUTED',
    'topbar.save': 'SAVE',
    'topbar.exit': 'EXIT',
    'topbar.full': 'FULL',
    'topbar.fullExit': 'EXIT FS',
    // Symmetric with zh.topbar.lang above: read while en is active, so it's the target
    // locale's own name, written in that locale's script.
    'topbar.lang': '中文',

    // Task 2 (entry screens): hero/menu (showModeSelect).
    'menu.localGame': 'LOCAL GAME',
    'menu.onlineGame': 'ONLINE GAME',
    'menu.pressStart': 'PRESS START',
    'menu.modsWord': 'MODS',
    'menu.tradeAuction': 'TRADE &amp; AUCTION',
    'menu.heroAlt': 'Meinopoly: Dominion',

    // Mod select (showModSelect).
    'mod.heading': 'SELECT MOD',
    'mod.subheading': 'Choose the game world to play',
    'mod.back': 'BACK',

    // Map select (showMapSelect) + shared map-card preview fallback (entry-ui.js).
    'map.heading': 'SELECT MAP',
    'map.subheading': 'Choose the board you want to play on',
    'map.back': 'BACK',
    'map.places': 'PLACES',
    'map.spaces': 'SPACES',
    'map.previewFallback': 'MAP',
    'map.layoutAtlas': 'ATLAS',

    // Game setup (showSetup / _renderSetup).
    'setup.heading': 'GAME SETUP',
    'setup.subheading': 'Players &amp; victory condition',
    'setup.players': 'PLAYERS',
    'setup.bots': 'BOTS',
    'setup.modeSurvivalLabel': 'LAST STANDING',
    'setup.modeSurvivalDesc': 'Last player not bankrupt wins. Classic elimination.',
    'setup.modeWealthLabel': 'TIMED · RICHEST',
    'setup.modeWealthDesc': 'After a set number of turns, the highest net worth wins.',
    'setup.modeMonopolyLabel': 'DOMINION',
    'setup.modeMonopolyDesc': 'First to control a set number of full color groups wins instantly.',
    'setup.selected': 'SELECTED',
    'setup.turnLimit': 'TURN LIMIT',
    'setup.groupsToWin': 'GROUPS TO WIN',
    'setup.back': 'BACK',
    'setup.start': 'START GAME',

    // Character select (renderCharacterSelect).
    'charselect.botPicking': 'BOT is picking…',
    'charselect.player': 'PLAYER {n}',
    'charselect.heading': 'CHOOSE YOUR CHARACTER',
    'charselect.subheading': 'Each councillor carries unique stats and a passive edge.',
    'charselect.startMoney': 'START',
    'charselect.viewLore': 'VIEW LORE',
    'charselect.askAI': 'ASK AI',
    'charselect.taken': 'TAKEN',
    'charselect.selected': 'SELECTED',
    'charselect.selectPrompt': 'Select a councillor to continue',
    'charselect.back': 'BACK',
    'charselect.beginGame': 'BEGIN GAME',
    'charselect.nextPlayer': 'NEXT PLAYER',

    // Results screen (renderResults).
    'results.victory': 'VICTORY',
    'results.reasonDominion': '{name} controls {groups} color groups.',
    'results.reasonMaxTurns': 'Turn limit reached — richest wins.',
    'results.reasonSurvival': '{name} is the last one standing.',
    'results.reasonDefault': '{name} controls the Council.',
    'results.finalStandings': 'FINAL STANDINGS',
    'results.propsWord': 'PROPS',
    'results.playAgain': 'PLAY AGAIN',
    'results.playerFallback': 'Player {n}',

    // Saves modal (showSavesModal).
    'saves.empty': 'No saved games. Save during play to see them here.',
    'saves.playersWord': 'players',
    'saves.turnWord': 'Turn',
    'saves.load': 'LOAD',
    'saves.delete': 'DEL',
    'saves.heading': 'SAVED GAMES',
    'saves.close': 'CLOSE',

    // Online lobby (Lobby.js + App's showOnlineLobby).
    'lobby.heading': 'ONLINE LOBBY',
    'lobby.subheading': 'Create or join a networked match',
    'lobby.yourName': 'YOUR NAME',
    'lobby.namePlaceholder': 'Enter your name',
    'lobby.createGame': 'CREATE GAME',
    'lobby.playersOption': 'PLAYERS',
    'lobby.create': 'CREATE',
    'lobby.availableGames': 'AVAILABLE GAMES',
    'lobby.refresh': 'REFRESH',
    'lobby.backToMenu': 'BACK TO MENU',
    'lobby.noGames': 'No games available. Create one!',
    'lobby.slotWord': 'SLOT',
    'lobby.gameWord': 'GAME',
    'lobby.joined': 'joined',
    'lobby.join': 'JOIN',
    'lobby.full': 'FULL',

    // entry-ui.js: breadcrumb step labels (breadcrumbSteps).
    'breadcrumb.mode': 'MODE',
    'breadcrumb.mod': 'MOD',
    'breadcrumb.map': 'MAP',
    'breadcrumb.setup': 'SETUP',
    'breadcrumb.character': 'CHARACTER',

    // entry-ui.js: pluralize() — see the matching zh comment above for why each word
    // needs a one/other pair even though the zh side collapses both to one string.
    'entry.plural.map.one': '{n} MAP',
    'entry.plural.map.other': '{n} MAPS',
    'entry.plural.character.one': '{n} CHARACTER',
    'entry.plural.character.other': '{n} CHARACTERS',
  },
};

let _locale = DEFAULT_LOCALE;
const _listeners = [];
const _warned = new Set(); // missing keys already console.warn'd this session

function _hasStorage() {
  return typeof localStorage !== 'undefined';
}

function _readPersistedLocale() {
  if (!_hasStorage()) return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'zh' || saved === 'en' ? saved : null;
  } catch (e) {
    return null; // storage present but inaccessible (private mode, disabled, etc.)
  }
}

// Reads the persisted locale (default 'zh' if absent/invalid/unavailable). Call once at
// app boot, before the first render, so the very first paint is already in the right
// language.
export function initLocale() {
  _locale = _readPersistedLocale() || DEFAULT_LOCALE;
  return _locale;
}

export function getLocale() {
  return _locale;
}

// Sets the active locale, persists it (best-effort), and notifies every registered
// onLocaleChange listener synchronously. Invalid locales are ignored (no-op, current
// locale returned unchanged) rather than throwing — callers toggling via a button never
// need to validate first.
export function setLocale(locale) {
  if (locale !== 'zh' && locale !== 'en') return _locale;
  _locale = locale;
  if (_hasStorage()) {
    try { localStorage.setItem(STORAGE_KEY, _locale); } catch (e) { /* best-effort persist */ }
  }
  _listeners.slice().forEach(cb => {
    try { cb(_locale); } catch (e) { /* one bad listener must not break the others */ }
  });
  return _locale;
}

// Registers a callback invoked with the new locale on every setLocale(). Returns an
// unsubscribe function.
export function onLocaleChange(cb) {
  _listeners.push(cb);
  return () => {
    const idx = _listeners.indexOf(cb);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}

function _interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ));
}

// Looks up `key` in the active locale's table; missing -> EN table -> the key itself
// (never blank). `params` interpolates `{name}` placeholders. Warns once per missing key
// per session regardless of whether the EN fallback resolved it — a zh gap is worth
// flagging even though the user never sees a blank string.
//
// T1-review Finding 2: a table value of '' (empty string) is treated exactly like a
// missing key, not just `undefined`. The original fallback chain only triggered on
// `undefined`, so a plausible copy-paste gap during the 400-key migration (a key present
// in the table but accidentally seeded with '') would render silently blank with no warn —
// violating the "never blank" guarantee just as badly as a missing key would. `_isBlank`
// is factored out so both the current-locale lookup and the EN-fallback lookup apply the
// same undefined-or-empty test.
function _isBlank(v) {
  return v === undefined || v === '';
}
export function t(key, params) {
  const table = STRINGS[_locale] || {};
  let str = table[key];
  if (_isBlank(str)) {
    if (!_warned.has(key)) {
      _warned.add(key);
      console.warn(`[i18n] missing key "${key}" for locale "${_locale}"`);
    }
    const enStr = STRINGS.en && STRINGS.en[key];
    str = !_isBlank(enStr) ? enStr : key;
  }
  return _interpolate(str, params);
}
