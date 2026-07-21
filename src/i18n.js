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

    // ── Task 3 (in-game HUD + modals) ────────────────────────────────────
    // Shared display-only fallback name for a seat with no picked character
    // (renamed from Task 2's results.playerFallback — same string, now used by
    // turnbox/duel/auction/trade/legend/tile-owner too). DISPLAY ONLY: wire
    // values (Lobby.joinMatch's playerName) stay fixed English — see Lobby.js.
    'game.playerFallback': '玩家 {n}',
    // Topbar SAVE button transient feedback (saveGame).
    'topbar.rolling': '掷骰中…',
    'topbar.saved': '已保存 ✓',

    // game-chrome.js: chip strip badges + chip detail popover.
    'chip.turn': '行动中',
    'chip.out': '出局',
    'chip.jail': '入狱',
    'chip.bot': 'BOT',
    'chip.inJail': '狱中',
    'chip.deeds': '{n} 处地契',
    // Ability tags shown in the chip detail popover (renderPlayerInfo).
    'chip.abilityReroll': '重掷 {n}',
    'chip.abilityRedraw': '重抽 {n}',
    'chip.abilityReg': '管控：{name}',

    // game-chrome.js: right-drawer tab rail + footer.
    'drawer.log': '日志',
    'drawer.chat': '聊天',
    'drawer.manage': '管理',
    'drawer.exitToMenu': '退出至主菜单',

    // Legend cartouche (game-chrome legendHtml title + App._renderLegend rows).
    // Pre-i18n these were the reskin's bilingual labels — bilingual = zh value.
    'legend.title': 'LEGEND · 图例',
    'legend.neutral': '中立 NEUTRAL',
    'legend.territory': '领地 · {name}',
    'legend.tax': '税赋 TAX',
    'legend.chance': '机变 CHANCE',

    // Tile detail popover (game-chrome tileDetailHtml + App helpers).
    'tile.unowned': '无主',
    'tile.mortgaged': '已抵押',
    'tile.rent': '租金 {rent}',
    'tile.rentVaries': '视骰点而定',
    'tile.pop': '人口 {v}',
    'tile.gdp': 'GDP {v}',
    'tile.fame': '声望 {v}',
    // Space-type labels (App._tileTypeLabel; unknown types fall through to raw data).
    'tile.type.go': '起点',
    'tile.type.property': '地产',
    'tile.type.railroad': '铁路',
    'tile.type.utility': '公共事业',
    'tile.type.tax': '税赋',
    'tile.type.chance': '机变',
    'tile.type.community': '命运',
    'tile.type.jail': '监狱',
    'tile.type.goToJail': '入狱',
    'tile.type.parking': '免费停车',
    // Corner/special flavor lines (App._tileFlavorText).
    'tile.flavor.go': '每次经过起点即可领取薪金。',
    'tile.flavor.jail': '路过参观，或是服刑中。',
    'tile.flavor.goToJail': '直接入狱，不得经过起点。',
    'tile.flavor.chance': '抽取一张机变卡。',
    'tile.flavor.community': '抽取一张命运卡。',
    'tile.flavor.tax': '向国库缴纳 ${amount}。',
    'tile.flavor.parkingPot': '免费停车——领取累积的奖池。',
    'tile.flavor.parking': '免费停车，稍作休整。',

    // Season box (App._centerHtml). Season NAMES are engine-level constants
    // (every mod ships summer/autumn/winter/spring today), so they localize as
    // UI-layer names keyed by season id; an unknown/custom id falls back to the
    // mod's own season.name data at the call site.
    'season.label': '季节',
    'season.name.summer': '夏季',
    'season.name.autumn': '秋季',
    'season.name.winter': '冬季',
    'season.name.spring': '春季',
    'season.cycle': '周期 {c}/{i}',
    'season.turnOf': '回合 {n}/{max}',
    'season.turn': '第 {n} 回合',
    'season.fxPrice': '地价 {v}%',
    'season.fxRent': '租金 +{v}%',
    'season.fxTax': '税赋 x{v}',
    'season.fxPot': '奖池 ${v}',

    // Turnbox / board-center slot (renderTurnbox + _centerSlotHtml).
    'turnbox.total': '总点 {n}',
    'turnbox.doubles': '对子 x{n}',
    'turnbox.buy': '购买',
    'turnbox.pass': '放弃',
    'turnbox.auction': '拍卖',
    'turnbox.waiting': '等待中…',
    'turnbox.chooseRoute': '选择路线——点击高亮的城市',
    'turnbox.payFineOrRoll': '缴纳罚金，或掷出对子越狱',
    'turnbox.rollToMove': '掷骰移动',
    'turnbox.resolveCard': '请处理你的卡牌',
    'turnbox.auctionInProgress': '拍卖进行中',
    'turnbox.tradePending': '交易待定',
    'turnbox.endWhenReady': '可随时结束回合',
    'turnbox.botThinking': 'BOT 思考中…',
    'turnbox.waitingFor': '等待<br/>{name}…',
    'turnbox.rollForDoubles': '掷骰越狱',
    'turnbox.payFine': '缴纳罚金 ${fine}',
    'turnbox.rollDice': '掷骰子',
    'turnbox.reroll': '重掷（{n}）',
    // Reskin bilingual action labels — bilingual = zh value, plain EN = en value.
    'turnbox.trade': '交易 TRADE',
    'turnbox.endTurn': '结束回合 END TURN',

    // Event card modal + turnbox fallback buttons (renderStateModal).
    // Deck names reuse tile.type.chance / tile.type.community.
    'card.accept': '接受',
    'card.redraw': '重抽',
    'card.tagGood': '鸿运',
    'card.tagBad': '厄运',
    'card.tagNeutral': '事件',

    // Rent duel (offer/response prompts + result strip).
    'duel.offer': '{name} — 租金 {rent}',
    'duel.payRent': '支付租金',
    'duel.duel': '决斗！',
    'duel.cooldown': '还需 {n} 回合才能再次决斗',
    'duel.waitingResponse': '等待 {name} 应战…',
    'duel.challenged': '{owner}，有人为 {space} 向你发起决斗！',
    'duel.stakes': '胜：免除 {challenger} 的租金。负：支付 {mult} 倍租金（{amount}）。',
    'duel.fight': '应战',
    'duel.decline': '拒绝',
    'duel.vs': '对',
    'duel.wins': '{name} 获胜（{outcome}）',
    'duel.outcomeWaived': '租金免除',
    'duel.outcomePaid': '已支付 {mult} 倍租金',

    // Manage drawer (renderManage).
    'manage.title': '资产管理',
    'manage.unmort': '赎回 ${v}',
    'manage.mort': '抵押 ${v}',
    'manage.sell': '出售',

    // Event-log drawer header (renderMessages — CONTENT is Task 4's scope).
    'log.title': '事件日志',

    // Auction modal (renderStateModal).
    'auction.title': '拍卖',
    'auction.listed': '标价 ${price}',
    'auction.currentBid': '当前出价',
    'auction.toBid': '轮到出价：{name}',
    'auction.stateLeads': '领先',
    'auction.stateIn': '在局',
    'auction.pass': '弃权',
    'auction.bid': '出价',

    // Trade: pending-proposal modal + builder modal.
    'trade.proposalTitle': '交易提案',
    'trade.nothing': '无',
    'trade.cancel': '取消',
    'trade.reject': '拒绝',
    'trade.accept': '接受',
    'trade.builderTitle': '发起交易',
    'trade.noDeeds': '没有可交易的地契',
    'trade.cash': '现金',
    'trade.with': '交易对象',
    'trade.balance': '平衡',
    'trade.balPos': '对你有利',
    'trade.balNeg': '对方占优',
    'trade.balEven': '大致均衡',
    'trade.send': '发出提案',

    // Persuasion (MT2-SP5 direction C2 "舌战群儒", T3): the three seam
    // buttons (求情/叫阵/游说), the shared free-text modal, keyless canned
    // verdict lines per tier (speech bubble from the TARGET), and the
    // bot-plea popup (owner-as-judge).
    'persuasion.rentButton': '求情',
    'persuasion.duelButton': '叫阵',
    'persuasion.tradeButton': '游说',
    'persuasion.rentHint': '向 {name} 求情，追回部分租金？',
    'persuasion.rentTitle': '向 {name} 求情',
    'persuasion.duelTitle': '向 {name} 叫阵',
    'persuasion.tradeTitle': '游说 {name}',
    'persuasion.placeholder': '输入你的说辞……',
    'persuasion.submit': '发送',
    'persuasion.cancel': '取消',
    'persuasion.judging': '判定中……',
    'persuasion.remaining': '本场景剩余 {seam} 次 · 本局总剩余 {global} 次',
    'persuasion.verdict.rent.fail': '……不行。',
    'persuasion.verdict.rent.tier1': '……好吧，八折。',
    'persuasion.verdict.rent.tier2': '算你说得动听，七折吧。',
    'persuasion.verdict.duel.fail': '牙尖嘴利，没用。',
    'persuasion.verdict.duel.tier1': '哼，算你说得有点道理。',
    'persuasion.verdict.duel.tier2': '……好，我让你三分。',
    'persuasion.verdict.trade.fail': '这笔交易，免谈。',
    'persuasion.verdict.trade.tier1': '……那就再考虑一下吧。',
    'persuasion.verdict.trade.tier2': '你说得有道理，我松口了。',
    'persuasion.pleaLine': '……租金 {amount}，能否高抬贵手？',
    'persuasion.pleaAccept': '答应',
    'persuasion.pleaReject': '拒绝',

    // AI settings modal (showAISettings).
    'aiset.title': 'AI 角色设置',
    'aiset.connected': '已连接',
    'aiset.noKey': '未设置 API 密钥',
    'aiset.apiKeyLabel': 'OpenAI API 密钥',
    'aiset.keyHint': '仅保存在你的浏览器本地，只发送给 OpenAI。',
    'aiset.verbosityLabel': '回应频率',
    'aiset.verbosityOff': '关闭（无 AI 回应）',
    'aiset.verbosityMajor': '仅重大事件（推荐）',
    'aiset.verbosityAll': '所有事件',
    'aiset.verbosityHint': '角色评论游戏事件的频率。',
    // T2 ($3 hard cap): running dialogue-spend estimate readout.
    'aiset.costLabel': '本局对话花费估算',
    'aiset.costCapped': '已达上限',
    'aiset.cancel': '取消',
    'aiset.save': '保存',

    // Chat panel + AI chatter strip (AI REPLIES themselves are data, untouched).
    'chat.title': '聊天',
    'chat.start': '和 {name} 聊聊吧',
    'chat.you': '你',
    'chat.setKey': '请先在 AI 设置中填写 API 密钥',
    'chat.typeMessage': '输入消息…',
    'chat.send': '发送',
    'chat.noResponse': '（没有回应——请检查 AI 设置中的 API 密钥）',
    'ai.thinking': '思考中…',
    'ai.councilChatter': '议会杂谈',

    // Lore modal section labels (showLoreModal — lore TEXT is mod data).
    // Pre-i18n these were hardcoded zh; they keep those values here.
    'lore.background': '背景故事',
    'lore.noticed': '被议会注意到的原因',
    'lore.joining': '加入维度议会',
    'lore.style': '行事风格',
    'lore.relationships': '与其他代理人的关系',
    'lore.passive': '被动技能',
    'lore.startingCapital': '起始资金',
    'lore.close': '关闭',
    // Lore modal tab rail (T3, MT2-SP4 direction B): only rendered when the
    // character has at least one stored diary entry (App.js showLoreModal).
    'lore.tabBio': '简介',
    'lore.tabDiary': '心路',

    // Player-detail popover: code-driven attitude section (game-chrome.js
    // attitudeChipsHtml). Keyless-safe — grudge/trust are pure ledger reads.
    'attitude.title': '态度',
    'attitude.grudgeLabel': '宿怨',
    'attitude.trustLabel': '信任',
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

    // ── Task 3 (in-game HUD + modals) — see the zh table for section notes ──
    'game.playerFallback': 'Player {n}',
    'topbar.rolling': 'ROLLING…',
    'topbar.saved': 'SAVED ✓',

    // game-chrome.js: chip strip badges + chip detail popover.
    'chip.turn': 'TURN',
    'chip.out': 'OUT',
    'chip.jail': 'JAIL',
    'chip.bot': 'BOT',
    'chip.inJail': 'IN JAIL',
    'chip.deeds': '{n} DEEDS',
    'chip.abilityReroll': 'REROLL {n}',
    'chip.abilityRedraw': 'REDRAW {n}',
    'chip.abilityReg': 'REG: {name}',

    // game-chrome.js: right-drawer tab rail + footer.
    'drawer.log': 'LOG',
    'drawer.chat': 'CHAT',
    'drawer.manage': 'MANAGE',
    'drawer.exitToMenu': 'EXIT TO MENU',

    // Legend cartouche — en gets the plain-EN half of the reskin's bilingual labels.
    'legend.title': 'LEGEND',
    'legend.neutral': 'NEUTRAL',
    'legend.territory': 'TERRITORY · {name}',
    'legend.tax': 'TAX',
    'legend.chance': 'CHANCE',

    // Tile detail popover.
    'tile.unowned': 'UNOWNED',
    'tile.mortgaged': 'MORTGAGED',
    'tile.rent': 'RENT {rent}',
    'tile.rentVaries': 'varies by dice',
    'tile.pop': 'POP {v}',
    'tile.gdp': 'GDP {v}',
    'tile.fame': 'FAME {v}',
    'tile.type.go': 'GO',
    'tile.type.property': 'PROPERTY',
    'tile.type.railroad': 'RAILROAD',
    'tile.type.utility': 'UTILITY',
    'tile.type.tax': 'TAX',
    'tile.type.chance': 'CHANCE',
    'tile.type.community': 'COMMUNITY CHEST',
    'tile.type.jail': 'JAIL',
    'tile.type.goToJail': 'GO TO JAIL',
    'tile.type.parking': 'FREE PARKING',
    'tile.flavor.go': 'Collect on every pass around the board.',
    'tile.flavor.jail': 'Just visiting — or serving time.',
    'tile.flavor.goToJail': 'Go directly to jail. Do not pass GO.',
    'tile.flavor.chance': 'Draw a Chance card.',
    'tile.flavor.community': 'Draw a Community Chest card.',
    'tile.flavor.tax': 'Pay ${amount} to the treasury.',
    'tile.flavor.parkingPot': 'Free Parking — collects the accumulated pot.',
    'tile.flavor.parking': 'Free Parking. Take a breather.',

    // Season box.
    'season.label': 'SEASON',
    'season.name.summer': 'Summer',
    'season.name.autumn': 'Autumn',
    'season.name.winter': 'Winter',
    'season.name.spring': 'Spring',
    'season.cycle': 'Cycle {c}/{i}',
    'season.turnOf': 'T{n}/{max}',
    'season.turn': 'Turn {n}',
    'season.fxPrice': 'PRICE {v}%',
    'season.fxRent': 'RENT +{v}%',
    'season.fxTax': 'TAX x{v}',
    'season.fxPot': 'POT ${v}',

    // Turnbox / board-center slot.
    'turnbox.total': 'TOTAL {n}',
    'turnbox.doubles': 'DOUBLES x{n}',
    'turnbox.buy': 'BUY',
    'turnbox.pass': 'PASS',
    'turnbox.auction': 'AUCTION',
    'turnbox.waiting': 'WAITING…',
    'turnbox.chooseRoute': 'CHOOSE YOUR ROUTE — CLICK A HIGHLIGHTED CITY',
    'turnbox.payFineOrRoll': 'PAY FINE OR ROLL FOR DOUBLES',
    'turnbox.rollToMove': 'ROLL TO MOVE',
    'turnbox.resolveCard': 'RESOLVE YOUR CARD',
    'turnbox.auctionInProgress': 'AUCTION IN PROGRESS',
    'turnbox.tradePending': 'TRADE PENDING',
    'turnbox.endWhenReady': 'END TURN WHEN READY',
    'turnbox.botThinking': 'BOT thinking…',
    'turnbox.waitingFor': 'WAITING FOR<br/>{name}…',
    'turnbox.rollForDoubles': 'ROLL FOR DOUBLES',
    'turnbox.payFine': 'PAY ${fine} FINE',
    'turnbox.rollDice': 'ROLL DICE',
    'turnbox.reroll': 'REROLL ({n})',
    'turnbox.trade': 'TRADE',
    'turnbox.endTurn': 'END TURN',

    // Event card modal + turnbox fallback buttons.
    'card.accept': 'ACCEPT',
    'card.redraw': 'REDRAW',
    'card.tagGood': 'FORTUNE',
    'card.tagBad': 'HAZARD',
    'card.tagNeutral': 'EVENT',

    // Rent duel.
    'duel.offer': '{name} — rent {rent}',
    'duel.payRent': 'PAY RENT',
    'duel.duel': 'DUEL!',
    'duel.cooldown': 'Duel available in {n} turn(s)',
    'duel.waitingResponse': 'WAITING FOR {name} TO RESPOND…',
    'duel.challenged': '{owner}, you are challenged for {space}!',
    'duel.stakes': 'Win: rent waived for {challenger}. Lose: pay {mult}&times; rent ({amount}).',
    'duel.fight': 'FIGHT',
    'duel.decline': 'DECLINE',
    'duel.vs': 'vs',
    'duel.wins': '{name} WINS ({outcome})',
    'duel.outcomeWaived': 'rent waived',
    'duel.outcomePaid': '{mult}&times; rent paid',

    // Manage drawer.
    'manage.title': 'MANAGE',
    'manage.unmort': 'UNMORT ${v}',
    'manage.mort': 'MORT ${v}',
    'manage.sell': 'SELL',

    // Event-log drawer header.
    'log.title': 'EVENT LOG',

    // Auction modal.
    'auction.title': 'AUCTION',
    'auction.listed': 'Listed ${price}',
    'auction.currentBid': 'CURRENT BID',
    'auction.toBid': 'TO BID: {name}',
    'auction.stateLeads': 'LEADS',
    'auction.stateIn': 'IN',
    'auction.pass': 'PASS',
    'auction.bid': 'BID',

    // Trade: pending-proposal modal + builder modal.
    'trade.proposalTitle': 'TRADE PROPOSAL',
    'trade.nothing': 'Nothing',
    'trade.cancel': 'CANCEL',
    'trade.reject': 'REJECT',
    'trade.accept': 'ACCEPT',
    'trade.builderTitle': 'PROPOSE TRADE',
    'trade.noDeeds': 'No deeds to offer',
    'trade.cash': 'CASH',
    'trade.with': 'TRADE WITH',
    'trade.balance': 'BALANCE',
    'trade.balPos': 'IN YOUR FAVOUR',
    'trade.balNeg': 'FAVOURS RIVAL',
    'trade.balEven': 'ROUGHLY EVEN',
    'trade.send': 'PROPOSE',

    // Persuasion (MT2-SP5 direction C2 "舌战群儒", T3): the three seam
    // buttons (求情/叫阵/游说), the shared free-text modal, keyless canned
    // verdict lines per tier (speech bubble from the TARGET), and the
    // bot-plea popup (owner-as-judge).
    'persuasion.rentButton': 'PLEAD',
    'persuasion.duelButton': 'TAUNT',
    'persuasion.tradeButton': 'LOBBY',
    'persuasion.rentHint': 'Plead with {name} for a rent refund?',
    'persuasion.rentTitle': 'Plead with {name}',
    'persuasion.duelTitle': 'Taunt {name}',
    'persuasion.tradeTitle': 'Lobby {name}',
    'persuasion.placeholder': 'Type your words…',
    'persuasion.submit': 'SEND',
    'persuasion.cancel': 'CANCEL',
    'persuasion.judging': 'JUDGING…',
    'persuasion.remaining': '{seam} left for this seam · {global} left this game',
    'persuasion.verdict.rent.fail': '…No.',
    'persuasion.verdict.rent.tier1': '…Fine, 10% off.',
    'persuasion.verdict.rent.tier2': 'Well said. 20% off.',
    'persuasion.verdict.duel.fail': 'Sharp tongue, no effect.',
    'persuasion.verdict.duel.tier1': 'Hmph. Fair point.',
    'persuasion.verdict.duel.tier2': "…Fine, I'll go easy on you.",
    'persuasion.verdict.trade.fail': 'Not a chance.',
    'persuasion.verdict.trade.tier1': '…Let me reconsider.',
    'persuasion.verdict.trade.tier2': "You've got a point. Deal's better now.",
    'persuasion.pleaLine': '…{amount} rent — any chance of mercy?',
    'persuasion.pleaAccept': 'ACCEPT',
    'persuasion.pleaReject': 'REJECT',

    // AI settings modal.
    'aiset.title': 'AI CHARACTER SETTINGS',
    'aiset.connected': 'CONNECTED',
    'aiset.noKey': 'NO API KEY',
    'aiset.apiKeyLabel': 'OpenAI API Key',
    'aiset.keyHint': 'Stored locally in your browser. Sent only to OpenAI.',
    'aiset.verbosityLabel': 'Response Verbosity',
    'aiset.verbosityOff': 'Off (no AI responses)',
    'aiset.verbosityMajor': 'Major events only (recommended)',
    'aiset.verbosityAll': 'All events',
    'aiset.verbosityHint': 'How often characters comment on game events.',
    // T2 ($3 hard cap): running dialogue-spend estimate readout.
    'aiset.costLabel': 'Dialogue Spend (est.)',
    'aiset.costCapped': 'CAPPED',
    'aiset.cancel': 'CANCEL',
    'aiset.save': 'SAVE',

    // Chat panel + AI chatter strip.
    'chat.title': 'CHAT',
    'chat.start': 'Start a conversation with {name}',
    'chat.you': 'YOU',
    'chat.setKey': 'Set API key in AI settings',
    'chat.typeMessage': 'Type a message…',
    'chat.send': 'SEND',
    'chat.noResponse': '(No response — check your API key in AI settings)',
    'ai.thinking': 'Thinking…',
    'ai.councilChatter': 'COUNCIL CHATTER',

    // Lore modal section labels.
    'lore.background': 'BACKGROUND',
    'lore.noticed': 'WHY THE COUNCIL TOOK NOTICE',
    'lore.joining': 'JOINING THE COUNCIL',
    'lore.style': 'STYLE OF PLAY',
    'lore.relationships': 'RELATIONSHIPS',
    'lore.passive': 'PASSIVE',
    'lore.startingCapital': 'STARTING CAPITAL',
    'lore.close': 'CLOSE',
    'lore.tabBio': 'PROFILE',
    'lore.tabDiary': 'DIARY',

    'attitude.title': 'STANDING',
    'attitude.grudgeLabel': 'GRUDGE',
    'attitude.trustLabel': 'TRUST',
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
// `localeOverride` (post-merge ticket, i18n-log.js's formatLogLine): every other call site
// omits this 3rd arg and gets the module's current locale exactly as before — 100%
// backward compatible. It exists so a caller that has ALREADY committed to rendering a
// specific locale (formatLogLine's zh branch, keyed off an explicit `locale` parameter, not
// off getLocale()) can look up strings for THAT locale even if the global singleton has
// since moved on, instead of silently trusting the singleton to still agree. See
// i18n-log.js's deckLabelZh/seasonNameZh for the concrete consumer.
export function t(key, params, localeOverride) {
  const locale = (localeOverride === 'zh' || localeOverride === 'en') ? localeOverride : _locale;
  const table = STRINGS[locale] || {};
  let str = table[key];
  if (_isBlank(str)) {
    if (!_warned.has(key)) {
      _warned.add(key);
      console.warn(`[i18n] missing key "${key}" for locale "${locale}"`);
    }
    const enStr = STRINGS.en && STRINGS.en[key];
    str = !_isBlank(enStr) ? enStr : key;
  }
  return _interpolate(str, params);
}
