# 大富翁在线版技术设计稿（2025）

> **目标**：打造一款支持 **局域网 + 互联网** 的多人在线大富翁游戏，提供酷炫前端、可自绘地图与可自定义角色，同时保持可扩展与易维护。

---

## 目录
1. [总体概览](#总体概览)
2. [系统架构](#系统架构)
3. [网络通信设计](#网络通信设计)
4. [数据库模型（PostgreSQL 16）](#数据库模型postgresql-16)
5. [前端实现](#前端实现)
6. [地图系统](#地图系统)
7. [角色系统](#角色系统)
8. [规则与玩法](#规则与玩法)
9. [安全与鉴权](#安全与鉴权)
10. [DevOps 与部署](#devops-与部署)
11. [测试策略](#测试策略)
12. [里程碑 & 资源估算](#里程碑--资源估算)
13. [未来扩展方向](#未来扩展方向)
14. [附录：技术栈版本](#附录技术栈版本)

---

## 总体概览
| 模块 | 主要职责 | 关键技术 |
|------|----------|----------|
| **客户端** | UI / 动画 / 输入 | React 19 + Next.js 14 (首选) <br>备选：SvelteKit 2.0、SolidStart 1.0 |
| **实时通信** | 房间、回合、同步 | WebSocket (`socket.io v6`)、WebRTC DataChannel(可选 P2P) |
| **后端服务** | 游戏逻辑、匹配、支付 | Node.js 20 (TypeScript) + NestJS 10（CQRS） |
| **数据层** | 永久 & 易失数据 | PostgreSQL 16 + Redis 7 (cluster) |
| **CI/CD** | 构建、测试、发布 | GitHub Actions → Docker → K8s / Docker Compose |
| **监控** | 指标 & 日志 | Prometheus, Grafana, Loki, Tempo |

---

## 系统架构
```
 browser                          game-service               db-service      cache-service
+-----------+                    +--------------+          +-----------+   +-----------+
| React UI  | <—HTTP(S)—>  API  <->  NestJS API  | <—gRPC—> | Postgres  |   |  Redis    |
|           |                    |  (GraphQL)   |          +-----------+   +-----------+
| Canvas 2D | <- WebSocket ->    |  WS Gateway  | <-> Pub/Sub (Redis)
+-----------+                    +--------------+
```
* **水平扩展**：Stateless API + Sticky-Session WebSocket；房间级分片
* **局域网模式**：`docker compose up` 即起 3 容器（db/redis/server），前端静态文件托管在同一主机
* **云模式**：单 Helm chart 一键上 K8s；Ingress NGINX + cert‑manager 自动 TLS

---

## 网络通信设计
### 1. 发现机制（LAN）
| 步骤 | 协议 | 说明 |
|------|------|------|
| 房主广播房间 | UDP Multicast (224.0.0.251:5353) | 包含 `roomId`, `mapId`, `players`, `status` |
| 客户端发现 | mDNS 查询 | 前端 `dnssd` 库侦听 _monopoly._tcp.local |
| 建立连接 | WebSocket | `/ws?token=xxx&room=123` |

### 2. 消息流
```ts
interface WsMessage {
  type: 'JOIN' | 'ROLL' | 'BUY' | 'CHAT' | 'SYNC' | 'LEAVE';
  payload: any;
  ts: number; // epoch ms
}
```
* **关键字段**：`roomTick` （命令序号）确保一致性；客户端本地预测、服务器权威修正。
* **心跳**：30 s ping/pong；失联 2 次视为掉线并托管。

---

## 数据库模型（PostgreSQL 16）
```sql
-- 用户
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(32) UNIQUE NOT NULL,
  email TEXT UNIQUE,
  pass_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 地图
CREATE TABLE maps (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  theme TEXT,
  data_json JSONB NOT NULL,
  cover_url TEXT,
  author_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 角色
CREATE TABLE characters (
  id UUID PRIMARY KEY,
  name TEXT,
  attrs_json JSONB,
  avatar_url TEXT,
  owner_id UUID REFERENCES users(id)
);

-- 房间（持久化快照，仅在结算后写入）
CREATE TABLE game_rooms (
  id UUID PRIMARY KEY,
  map_id UUID REFERENCES maps(id),
  host_id UUID REFERENCES users(id),
  status SMALLINT, -- 0 idle, 1 playing, 2 finished
  created_at TIMESTAMPTZ DEFAULT now()
);
```
* **JSONB 索引**：常查字段 (`data_json->>'theme'`) 建 GIN。
* **Redis key 设计**：`room:{id}:state`, `user:{id}:session`。

---

## 前端实现
### 1. 框架选择
| 指标 | React 19 + Next.js | SvelteKit 2 | SolidStart 1 |
|------|-------------------|-------------|--------------|
| 学习成本 | ★★★☆☆ | ★★☆☆☆ | ★★★☆☆ |
| 社区生态 | ★★★★★ | ★★★★☆ | ★★☆☆☆ |
| 性能(FPS) | ★★★★☆ (并发) | ★★★★☆ | ★★★★★ |
| SSR/Suspense | 内建 | 内建 | 内建 |
| 我们建议 | React（团队大） |

### 2. UI & 动画
* **Tailwind CSS v4** + **shadcn/ui**：快速、暗黑模式自动
* **Framer Motion 12**：棋子移动、骰子弹跳、界面转场
* **PixiJS 8**：渲染地图 & 棋子，1e5 sprite 下保持 60 FPS
* **Three.js**（可选）: 把棋盘升成 2.5D，配合 `react-three-fiber`。

### 3. 状态管理
* React Server Components + `zustand/vanilla`
* WebSocket 数据 via `react-query` 的 `wsLink`，自动缓存

---

## 地图系统
### 1. 模板集
**热门城市 (10)**：纽约、东京、上海、巴黎、伦敦、柏林、悉尼、旧金山、迪拜、首尔  
**热门星球 (10)**：火星、木星、土星、金星、海王星、冥王星、Kepler‑452b、Pandora、Arrakis、Gallifrey  
**虚构城市 (10)**：哥谭、黑曜市、辛普森镇、瓦坎达、米德加、霍格莫德、伦敦巷、夜之城、国王港、中央市

### 2. 地图 JSON Schema（v1）
```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Monopoly Map",
  "type": "object",
  "required": ["version", "tiles", "edges"],
  "properties": {
    "version": {"type": "integer", "const": 1},
    "tiles": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "type", "x", "y"],
        "properties": {
          "id": {"type": "integer"},
          "name": {"type": "string"},
          "type": {"enum": ["start", "property", "chance", "tax", "jail", "special"]},
          "cost": {"type": "integer", "minimum": 0},
          "rent": {
            "type": "array",
            "items": {"type": "integer"},
            "minItems": 4,
            "maxItems": 6
          },
          "x": {"type": "integer"},
          "y": {"type": "integer"}
        }
      }
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "array", "minItems": 2, "maxItems": 2,
        "items": {"type": "integer"}
      }
    },
    "bgImage": {"type": "string"}
  }
}
```
### 3. 编辑器功能
1. 网格拖放 & 吸附
2. 右键批量编辑租金/地价
3. 导出 `.map.json` 与缩略图
4. 默认模板存放 `public/maps/*.map.json`

---

## 角色系统
### 1. 属性表
| 属性 | 初始范围 | 作用 | 备注 |
|------|----------|------|------|
| Money | 1500+ | 资产 | 破产即淘汰 |
| Luck | 1‑100 | 事件概率加成 | ±Luck% 改变触发率 |
| Negotiation | 1‑100 | 交易折扣 | 每 20 点成本‑5% |
| Charisma | 1‑100 | 联盟机制 | 背刺惩罚 = Charisma×2 |
| Stamina | 1‑100 | 额外行动 | 每 25 点赠 1 次 Reroll |
| Tech | 1‑100 | 建筑升级 | 仅星球地图可用 |
| Card Slots | 1‑6 | 装备道具 | 抽卡后可随意替换 |

### 2. 生成算法
```ts
const base = {
  Money: 1500,
  Luck: rand(40, 60),
  Negotiation: rand(40, 60),
  Charisma: rand(40, 60),
  Stamina: rand(40, 60),
  Tech: rand(20, 40),
};
// 职业模板叠加
const archetype = {
  Entrepreneur: { Luck: +10, Negotiation: +20 },
  Scientist: { Tech: +30, Luck: -5 },
  Adventurer: { Stamina: +25, Money: -300 },
};
```
* **平衡**：总和 ≈ 350；±15% 随机浮动确保多样性。
* **成长**：完成任务得 `AttributePoint`，按 1 : 1 提升。

---

## 规则与玩法
```
● 每局回合 = 所有人完成投掷
● 过起点 +£200
● 地产四级：房屋→酒店→摩天→地标
● 双骰同点再掷；三次同点进入监狱
● 新增：
  ○ 股份系统：任一地产可 IPO，其他玩家买入获分红
  ○ 联盟：共享地产收益，联盟成员同格停止收租
  ○ 随机事件牌：黑天鹅(股价‑30%)、市集(随机交易)、虫洞(跳转)
  ○ 季节：20 回合一季，地产价值 ±10% 波动
```

---

## 安全与鉴权
* **JWT** (`HS256`) 存 HTTP‑only cookie；WebSocket `Sec-WebSocket-Protocol` 带 token
* **速率限制**：API 100 r/min per IP，WS 消息 ≤ 30/s
* **CSRF**：SameSite=Lax；地图上传接口用 CSRF token
* **XSS/依赖安全**： ESLint + Dependabot + Snyk

---

## DevOps 与部署
### 1. LAN 单机脚本
```bash
# docker-compose.yaml
services:
  postgres:
    image: postgres:16
    env_file: .env
  redis:
    image: redis:7
  api:
    build: ./server
    depends_on: [postgres, redis]
  client:
    build: ./web
    ports: ["3000:3000"]
```
### 2. K8s (云)
* **Helm Chart**：`monopoly/` 包含 sub‑charts `api`, `client`, `redis`, `postgres`
* **CD**：`actions/ci.yml` → `docker push` → `helm upgrade --install`

### 3. 监控 & 日志
* `prometheus-operator` 自动抓取 `/metrics`
* Grafana dashboard：FPS、WS RTT、房间人数
* Loki + Tempo：集中日志 + 链路追踪

---

## 测试策略
| 层级 | 工具 | 覆盖 |
|------|------|------|
| 单元 | Vitest / Jest | 80%+ 逻辑函数 |
| 集成 | Supertest + Testcontainers | REST/GraphQL, DB mock |
| E2E | Playwright (Chromium+WebKit+Firefox) | 创建房间→结算 |
| 负载 | k6 + WS extension | 1k 并发房间 |

* **CI 阶段网格**：PR → 单元 + 集成；main → E2E → Docker build → Deploy staging
* **回归**：周三全量回放对局 200 场，自动比对资产/胜者一致性

---

## 里程碑 & 资源估算
| 阶段 | 周期 | 人月 | 交付物 |
|------|------|------|-------|
| M0 原型 | 2 | 2 | 本地 PvE 原型，掷骰＋买地 |
| M1 LAN | 4 | 4 | WS 房间，2‑4 人局域网对战 |
| M2 互联网 | 6 | 6 | 登录、匹配、云部署，一键脚手架 |
| M3 地图编辑器 | 8 | 5 | 所见即所得编辑 + 30 模板 |
| M4 角色 & 事件 | 10 | 6 | 属性成长、随机事件系统 |
| M5 公测 | 12 | 3 | 皮肤商城、数据埋点、A/B 调参 |

> **预算**：约 26 人月；3‑5 人团队约 6‑8 个月可上线公测。

---

## 未来扩展方向
* **AI 地图生成**：Stable Diffusion + GPT 描述 → Tile Placement
* **移动端**：React Native 0.74；复用业务层
* **Battle Pass**：赛季制奖励，提升留存
* **UGC 市场**：玩家上传地图/角色，平台抽成

---

## 附录：技术栈版本
| 分类 | 组件 | 版本 |
|------|------|------|
| 语言 | TypeScript | 5.5 |
| 前端 | React | 19.1 (2025‑03) |
| 前端 | Next.js | 14.0 |
| 前端 | PixiJS | 8.0 |
| 前端 | Framer Motion | 12.0 |
| 后端 | Node.js | 20.11 |
| 框架 | NestJS | 10.3 |
| DB | PostgreSQL | 16.2 |
| Cache | Redis | 7.2 |
| CI | GitHub Actions | 2025Q2 |
| Ctnr | Docker | 26.0 |

---

> **参考资料**
> 1. React 19 Features (Medium, 2025‑05)
> 2. Announcing SvelteKit 2 (Svelte Blog, 2023‑12)
> 3. SolidStart 1.0 Release (GitHub, 2024‑05)
> 4. PixiJS 8 Release Notes (2024‑11)
> 5. PostgreSQL 16 Docs (2024‑09)

