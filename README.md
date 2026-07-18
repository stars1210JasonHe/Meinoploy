<div align="center">

![Meinopoly](assets/hero.png)

# MEINOPOLY

**Every world can be a board game. Even the one inside a book.**

一个可改装、AI 驱动的大富翁式策略引擎 — 任何一本书，都能变成一个可玩的世界。

**1,489 unit tests · 45 E2E tests · 6 worlds · 3 renderers · 中文 / English**

[English](#english) · [中文](#中文)

</div>

---

## English

Meinopoly is a **moddable Monopoly-style strategy engine** built on [boardgame.io](https://boardgame.io). The engine is constant — worlds, characters, boards, art, rules, and even victory conditions are all **mods**. Six worlds ship in the box, and new ones can be **generated from a book by AI**, end to end: characters, stats, lore, geography, portraits, board art, and balance.

### 📖 Turn any book into a game — one command

```bash
npm run create-mod -- mybook.txt --from-book --portraits --boardbg --auto-balance
```

Feed it a novel. Four stages run in sequence, each resumable and idempotent:

| Stage | What happens | Powered by |
|---|---|---|
| **1 · Extract** | The whole book is read in chunks (map-reduce with a success-only cache); characters, places, factions, and themes are pulled out and merged | `gpt-4o-mini` + code-side union-find |
| **2 · Build** | Characters get 6 gameplay stats + a passive ability + personal lore; places become a board — real places get **real coordinates**, fictional worlds get AI layouts; per-place descriptions come straight from the text | `gpt-4o` structured outputs |
| **3 · Art** | Pixel-art portraits for the whole cast (one grid image per 16 characters, sliced and quantized to a 24-color palette) and an era-styled board background | `gpt-image-1` / `gpt-image-2` |
| **4 · Balance** | A headless tournament simulator plays hundreds of games and hill-climbs the roster's stats until no character is statistically over- or under-powered | pure code, no API |

Also available piecemeal: `--smart` (facts.json → mod), `--dry-run` (free preview), `--balance` (report only), `--map-image` (align places to your own map via vision), `npm run gen-portraits`, `npm run gen-boardbg`. **Cost plans print before any API spend** (a full novel runs roughly $0.5–1 total); API keys live in `.env` and are never logged.

### 🌍 Three ways to see a world

| Classic ring | War-room atlas | Pixel globe |
|---|---|---|
| The familiar loop, reskinned per world | Node-card cities over painted terrain, glowing route networks, forked paths you choose on the map | A rotating night-lights planet you play on |

![War room](assets/board-warroom.png)

![Globe](assets/globe-silkroad.png)

Boards are **data, not code**: percentage-positioned nodes, optional non-linear connections (forks, portals), per-world economy multipliers, and per-map card decks — all in JSON.

### 🎭 Characters that matter

<p>
<img src="mods/dominion/portraits/Albert-Victor.png" width="72" />
<img src="mods/dominion/portraits/Lia-Startrace.png" width="72" />
<img src="mods/dominion/portraits/Evelyn-Zero.png" width="72" />
<img src="mods/dominion/portraits/Knox-Ironlaw.png" width="72" />
<img src="mods/dominion/portraits/Sophia-Ember.png" width="72" />
<img src="mods/dominion/portraits/Cassian-Echo.png" width="72" />
<img src="mods/dominion/portraits/Mira-Dawnlight.png" width="72" />
<img src="mods/dominion/portraits/Ophelia-Nightveil.png" width="72" />
</p>

Every character carries six stats, and **every stat is wired into a real money flow** — measured and tuned by the balance simulator, configurable per mod:

| Stat | In-game effect (defaults) |
|---|---|
| **Capital** | Starting money modifier |
| **Luck** | +3%/pt on card gains; one card **redraw** per 3 points |
| **Negotiation** | +1.5%/pt on rent you *collect* |
| **Charisma** | Discount on rent you *pay* |
| **Tech** | +2%/pt rent on built-up properties |
| **Stamina** | −3%/pt on taxes and negative-card losses; feeds duel rolls |

Plus a unique **passive** each. Dominion's council of ten, for example:

| Character | Title | Passive |
|---|---|---|
| Albert Victor | Council Financier | Property price −10%, negative event losses −20% |
| Lia Startrace | Interstellar Pioneer | Upgrade cost −20% |
| Marcus Grayline | Political Operator | Alliance income share +10% |
| Evelyn Zero | Probability Speculator | Extra card redraws |
| Knox Ironlaw | Order Enforcer | Regulate a property for +20% rent |
| Sophia Ember | Crisis Arbitrageur | Gain $100 when any player goes bankrupt |
| Cassian Echo | Information Merchant | Unlimited card redraws |
| Mira Dawnlight | Idealist Council Member | +$50 bonus when passing GO |
| Renn Chainbreaker | Rule Breaker | −25% rent on monopoly properties |
| Ophelia Nightveil | Shadow Council Member | Hides her true wealth from other players |

### ⚔️ More than roll-and-buy

- **Rent duels (对战)** — land on a rival's property and challenge the landlord instead of paying: both sides roll 2d6 + stamina + luck÷2. Win: rent waived. Lose: pay double. Landlords can decline; cooldowns stop spam. Genghis vs. Cleopatra is a real fight now.
- **Trading & auctions** — propose/accept/reject deals between any players; pass on a property and it goes to round-robin auction.
- **Living boards** — seasons cycle every 10 turns and shift prices, rents, and taxes; enhanced event cards can force purchases, grant free upgrades, teleport you, or tax a percentage of your total assets.
- **4-tier building** — House → Hotel → Skyscraper → Landmark, with the even-building rule.
- **Mortgages, jail, triple-doubles**, and the rest of the classic toolkit — every number lives in a per-mod `rules.js`.
- **Three victory modes**, chosen at game start: **Last Standing**, **Timed-Richest**, or **Dominion** (control N color groups).

### 🤖 AI at the table

- **Local bots** with distinct play styles fill any empty seat — solo play works out of the box.
- **Characters that remember.** Every character keeps a grudge/trust ledger built from what actually happens at the table — lose duels to someone, out-bid them, bankrupt their ally, and they *remember*. Attitudes show as tier glyphs in the player popover (no API key needed), bots consult the ledger before accepting your trades, and grudges decay only slowly with the seasons.
- **AI characters** (optional, your OpenAI key): every character reacts to the game and chats **in character** — and with the memory system, they cite the actual history: *"That's the third time you've come for my land. My blade is dull, but my memory is excellent."* Characters write one-line diaries at each season's turn. All LLM spend is **hard-capped at $3 per game** (a double-fused budget guard, not an estimate).
- **MCP server** — LLM agents join a running match as *real seated players*. Nine tools over the Model Context Protocol: list/create/join match, seat-scoped state & digest, legal-move listing (drift-oracle-tested against the engine), move execution with event attribution, an event cursor, and turn-waiting.

```bash
MOD=terra-titans npm run server        # boot a match server
claude mcp add meinopoly -- node <abs-path>/scripts/mcp-server.js
# → Claude sits down, sees only its seat's information, and plays.
```

### ⚖️ Balance you can prove

```bash
npm run sim -- --mod silk-road
```

The headless simulator plays full-roster melee tournaments (hundreds of games, rotation windows for big casts) and prints per-character win rates against the statistical baseline, with **CI-gated STRONG/WEAK flags** — the same oracle that `--auto-balance` uses to tune generated mods, and the tool that caught a 67% win-rate outlier in a generated world before it ever reached a player.

### 🀄 Fully bilingual

One click flips the entire game between **中文** and **English** — UI, boards, modals, and the complete event log re-render live. The Chinese isn't machine-flavored: register distinctions (设定/设置, 支付/缴纳) survived three review passes.

### 🔧 Built like software, not a demo

- **1,489 unit tests + 45 Playwright E2E tests**; game-log golden pinning (167 frozen snapshots) guards every engine message byte-for-byte
- Seat-authorized online multiplayer (a trade partner can't rewind your moves), save/load with old-save migration
- Event-sourced core: every gameplay occurrence is one typed event on a 42-type registry — the same stream drives the UI log, animations, sound, AI reactions, and the MCP feed
- Deterministic, seeded content generation — same book + same seed = byte-identical mod

### Quick start

```bash
npm install
npm start                  # play at http://localhost:1234
npm run server             # online multiplayer server (port 8088)
npm run sim -- --mod <id>  # headless balance tournament
npm run mcp                # MCP server for AI agents
npx jest --no-coverage     # unit tests
npx playwright test        # E2E tests
```

**Make your own world without AI**: drop a `map.json` + roster into `mods/<id>/` — layouts (square ring, circle, hex, custom-positioned atlas) are validated and auto-positioned by the loader. Start from any shipped mod as a template.

### The worlds in the box

| World | Board | Flavor |
|---|---|---|
| **Dominion** | 4 maps: classic ring, circle, hex station, custom web | A sci-fi council of ten carving up multi-dimensional real estate |
| **Terra Titans** | 49-city pixel globe | 16 historical leaders — Cao Cao to Cleopatra — fight over Earth itself |
| **Ancient Empires** | Night-lights globe | Hammurabi, Cyrus, and the first empires |
| **Steam Barons** | Classic ring | Soot, rail, and industrial fortunes |
| **Silk Road** | Atlas + globe | Zhang Qian to Marco Polo, Venice to Chang'an |
| **Gilded Rails** | Classic ring | America's railroad age, generated by the smart-builder |

**Coming next**: in-character dialogue with per-character memory, alliances & voting, world events.

---

## 中文

Meinopoly 是基于 [boardgame.io](https://boardgame.io) 的**可改装**大富翁式策略引擎：引擎不变，世界、角色、棋盘、美术、规则乃至胜利条件全部是 **mod**。开箱自带六个世界，而新世界可以由 AI **从一本书端到端生成**——角色、属性、背景故事、地理、头像、棋盘美术、数值平衡，一条龙。

### 📖 一行命令，把一本书变成一局游戏

```bash
npm run create-mod -- 三国演义.txt --from-book --portraits --boardbg --auto-balance
```

喂它一本小说，四个阶段依次执行，每步幂等、可断点重跑：

| 阶段 | 做什么 | 靠什么 |
|---|---|---|
| **1 · 提取** | 整本书分块阅读（map-reduce + 成功块缓存），提出角色、地点、势力、主题并合并归一 | `gpt-4o-mini` + 代码侧并查集 |
| **2 · 构建** | 角色获得 6 项对局属性 + 被动技能 + 个人背景故事；地点变成棋盘——真实地名用**真实经纬度**，架空世界由 AI 排布；每格简介直接取自原文 | `gpt-4o` 结构化输出 |
| **3 · 美术** | 全员像素头像（每 16 人拼一张网格图，切片后量化到 24 色）+ 匹配时代风格的棋盘背景 | `gpt-image-1` / `gpt-image-2` |
| **4 · 平衡** | 无头锦标赛模拟器打几百局，对属性爬山调参，直到没有角色在统计上过强或过弱 | 纯代码，零 API |

也可以拆开用：`--smart`（facts.json → mod）、`--dry-run`（免费预览）、`--balance`（只出报告）、`--map-image`（用视觉模型把地点对齐到你自己的地图）、`npm run gen-portraits`、`npm run gen-boardbg`。**任何 API 花费前先打印成本计划**（一本长篇全套约 $0.5–1）；密钥只放 `.env`，绝不落日志。

### 🌍 一个世界，三种打开方式

| 经典环形棋盘 | 战情室地图 | 像素地球 |
|---|---|---|
| 熟悉的循环，每个世界换装 | 手绘地形上的城市节点卡、发光路线网、在地图上亲手选岔路 | 在一颗会转的夜光星球上落子 |

棋盘是**数据不是代码**：百分比定位的节点、可选的非线性连接（岔路、传送门）、每世界经济系数、每张图独立卡组——全在 JSON 里。

### 🎭 角色真的有用

每个角色六项属性，**每一项都挂进真实的金钱流**——由平衡模拟器实测调校，且每个 mod 可改：

| 属性 | 对局效果（默认值） |
|---|---|
| **资本** | 起始资金修正 |
| **幸运** | 事件卡收益 +3%/点；每 3 点换一次**重抽** |
| **谈判** | 你*收*的租金 +1.5%/点 |
| **魅力** | 你*交*的租金打折 |
| **科技** | 有建筑地产的租金 +2%/点 |
| **体力** | 税收与负面卡损失 −3%/点；参与对战掷骰 |

外加人手一个独特**被动**。以 Dominion 的十人议会为例：

| 角色 | 头衔 | 被动 |
|---|---|---|
| Albert Victor | 议会金融家 | 地价 −10%，负面事件损失 −20% |
| Lia Startrace | 星际开拓者 | 升级费用 −20% |
| Marcus Grayline | 政治操盘手 | 同盟收益分成 +10% |
| Evelyn Zero | 概率投机者 | 额外重抽次数 |
| Knox Ironlaw | 秩序执法官 | 管制地产，租金 +20% |
| Sophia Ember | 危机套利者 | 任何玩家破产时获得 $100 |
| Cassian Echo | 信息商人 | 无限重抽 |
| Mira Dawnlight | 理想主义议员 | 经过 GO 额外 +$50 |
| Renn Chainbreaker | 规则破坏者 | 垄断地产租金 −25% |
| Ophelia Nightveil | 暗影议员 | 对其他玩家隐藏真实财富 |

### ⚔️ 不止掷骰买地

- **租金对战（单挑）**——落进对手地盘可以拒交租金、挑战地主：双方掷 2d6 + 体力 + 幸运÷2。赢了免租，输了双倍。地主可拒战，冷却回合防刷。成吉思汗对克利奥帕特拉，现在是真刀真枪。
- **交易与拍卖**——玩家间自由提案/接受/拒绝；弃购地产进入轮流竞价。
- **活的棋盘**——四季每 10 回合轮转，影响地价、租金、税收；增强事件卡会强制购地、免费升级、瞬移、按总资产百分比征税。
- **四级建筑**——民房 → 酒店 → 摩天楼 → 地标，含均衡建造规则。
- **抵押、监狱、三连双**等经典机制齐全——所有数值都在每个 mod 自己的 `rules.js` 里。
- **三种胜利方式**开局任选：**最后生还** / **限时首富** / **版图支配**（控制 N 个颜色组）。

### 🤖 AI 上桌

- **本地机器人**性格各异，随时补位——单人开局即玩。
- **角色会记仇。** 每个角色都有一本由真实对局事件写成的宿怨/信任账：输给谁单挑、被谁抬价、盟友被谁搞破产——他们*记得*。态度徽记显示在玩家详情里（无需 API key），bot 在接受你的交易前会翻这本账，宿怨只随季节缓慢消退。
- **AI 角色**（可选，用你的 OpenAI key）：每个角色按人设对局面做反应、用本人口吻聊天——配上记忆系统，他们引用的是真实历史：*"第三次了。云长的刀不利，但记性很好。"* 换季时每个角色写一句日记。所有 LLM 花费**每局硬顶 $3**（双保险预算护栏，不是估算）。
- **MCP 服务器**——LLM 智能体以**真实玩家席位**加入对局。基于 Model Context Protocol 的九个工具：建房/加入、席位视角的状态与摘要、合法着法列表（与引擎双向漂移测试锁定）、带事件归因的行棋、事件游标、等待轮到自己。

```bash
MOD=terra-titans npm run server        # 起一局服务器
claude mcp add meinopoly -- node <绝对路径>/scripts/mcp-server.js
# → Claude 坐下，只看得到自己席位的信息，开始行棋。
```

### ⚖️ 平衡不是感觉，是测出来的

```bash
npm run sim -- --mod silk-road
```

无头模拟器打全员混战锦标赛（数百局、大阵容轮换窗口），输出每个角色对统计基线的胜率与 **CI 门控的过强/过弱标记**——`--auto-balance` 用的就是这套预言机。它曾在一个生成世界上线前抓出过 67% 胜率的失衡角色。

### 🀄 完整双语

一键在**中文 / English** 间切换——界面、棋盘、弹窗、整条事件日志实时重渲染。中文不是机翻腔：设定/设置、支付/缴纳这类语域区分经受了三轮评审。

### 🔧 按软件工程标准打造

- **1,489 个单元测试 + 45 个 Playwright 端到端测试**；游戏日志金样锁定（167 个冻结快照）逐字节守护引擎文案
- 席位鉴权的在线多人（交易对手无法回滚你的操作）、存档/读档含旧档迁移
- 事件溯源内核：每个游戏事件都是 42 类注册表上的一条类型化记录——同一条流驱动 UI 日志、动画、音效、AI 反应和 MCP 推送
- 内容生成确定性可复现——同一本书 + 同一个种子 = 字节级相同的 mod

### 快速开始

```bash
npm install
npm start                  # 本地游玩 http://localhost:1234
npm run server             # 在线多人服务器（8088 端口）
npm run sim -- --mod <id>  # 无头平衡锦标赛
npm run mcp                # 给 AI 智能体的 MCP 服务器
npx jest --no-coverage     # 单元测试
npx playwright test        # 端到端测试
```

**不用 AI 也能做自己的世界**：往 `mods/<id>/` 放一份 `map.json` + 角色表即可——方环、圆形、六边、自由定位的 atlas 布局都由加载器校验并自动排位。拿任何一个自带 mod 当模板开抄。

### 自带的六个世界

| 世界 | 棋盘 | 风味 |
|---|---|---|
| **Dominion** | 4 张图：经典环 / 圆环 / 六边太空站 / 自由网 | 十人科幻议会瓜分多维地产 |
| **泰坦纪元 Terra Titans** | 49 城像素地球 | 曹操到克利奥帕特拉，16 位历史领袖争夺地球本身 |
| **上古帝国 Ancient Empires** | 夜光地球 | 汉谟拉比、居鲁士与最初的帝国 |
| **蒸汽大亨 Steam Barons** | 经典环 | 煤烟、铁轨与工业财富 |
| **丝绸之路 Silk Road** | 地图 + 地球 | 张骞到马可·波罗，长安到威尼斯 |
| **镀金铁路 Gilded Rails** | 经典环 | 智能构建器生成的美国铁路时代 |

**下一步**：带角色记忆的游戏内对话、联盟与投票、世界事件。
