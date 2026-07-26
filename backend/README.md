# 串 Knot 后端

这是串 Knot 的可运行后端，基于 Node.js 24 内置 HTTP、Web Crypto 和 SQLite 实现，不依赖第三方 npm 包。

## 能力

- 北京路线和地点种子数据；
- 行程创建、读取与 SQLite 持久化；
- 15 分钟排程、revision 历史和乐观并发控制；
- 幂等写入与用户数据隔离；
- 行程 Agent Run、暂停、恢复、撤销和事件流；
- 实时行程的完成、跳过与延误事件；
- 小红书用户主动交接；
- 百度地点/路线与美团预订的演示 Provider；
- OpenAPI 3.1、健康检查、数据库迁移和结构化日志。

## 目录

```text
backend/
├─ src/
│  ├─ server.js             进程入口与优雅退出
│  ├─ app.js                HTTP 路由
│  ├─ store.js              SQLite 数据访问
│  ├─ migrations.js         数据库迁移
│  ├─ agent-manager.js      Agent Run 生命周期
│  ├─ agent-provider.js     模型 Provider
│  ├─ providers.js          第三方能力适配层
│  └─ openapi.js            OpenAPI 3.1
├─ scripts/                 数据库检查与备份
├─ test/                    Node 原生测试
└─ .env.example             环境变量模板
```

## 启动

从仓库根目录执行：

```bash
npm run dev:backend
```

或直接运行：

```bash
npm --prefix backend start
```

默认地址为 `http://127.0.0.1:8787/api/v1`，默认数据库在 `backend/data/hackathon.sqlite`。目录和数据库会在首次启动时自动创建。

健康检查：

```text
GET http://127.0.0.1:8787/api/v1/health
```

OpenAPI：

```text
GET http://127.0.0.1:8787/api/v1/openapi.json
```

## 主要接口

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/health` | 健康状态 |
| `GET` | `/places` | 地点列表 |
| `GET` | `/routes` | 路线列表 |
| `POST` | `/imports/xiaohongshu` | 用户主动交接分享链接 |
| `POST` | `/trips` | 创建行程 |
| `GET` | `/trips/:tripId` | 读取行程 |
| `PUT` | `/trips/:tripId/schedule` | 保存带 revision 的排程 |
| `GET` | `/trips/:tripId/revisions` | 读取历史版本 |
| `POST` | `/trips/:tripId/agent-runs` | 创建 Agent Run |
| `GET` | `/trips/:tripId/agent-runs` | 读取 Agent Run |
| `POST` | `/trips/:tripId/execution-events` | 记录实时行程事件 |
| `GET` | `/trips/:tripId/booking-options` | 获取演示预订选项 |

所有接口均以 `/api/v1` 为前缀。

## 身份与生产接入

本地默认使用 `API_AUTH_MODE=demo`。生产环境应改为：

```dotenv
API_ENV=production
API_AUTH_MODE=service-token
API_SERVICE_TOKEN=<至少 32 字符的服务端密钥>
API_REQUIRE_IDEMPOTENCY=true
CORS_ORIGIN=https://your-frontend.example
```

生产流量应经过前端同源 Worker：

1. Worker 为浏览器创建签名 HttpOnly 会话；
2. Worker 在服务端附加 `API_SERVICE_TOKEN`；
3. Worker把匿名用户映射为受信任的 `X-User-Id`；
4. 后端按用户隔离 Trip、Import 和 Agent Run。

`API_SERVICE_TOKEN`、`SESSION_SIGNING_KEY` 和模型 API Key 绝不能放入 `VITE_*` 变量或浏览器代码。

## 行程 Agent

没有模型密钥时，后端仍可运行确定性规划逻辑。接入模型时只在 `backend/.env.local` 配置：

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-sol
OPENAI_AGENT_MODEL=
OPENAI_BASE_URL=
```

实际模型和兼容接口以部署环境为准。密钥不得提交到 GitHub。

## 第三方边界

- 小红书：只读取用户主动提供的官方 HTTPS 分享链接及有限公开 metadata；
- 百度：前端地图和后端 Provider 是两套能力，后端 POI/路线目前为演示估算；
- 美团：不查询真实库存、价格或订单，不进行真实支付跳转；
- 本项目不表示已获得这些平台的正式合作授权。

## 数据与测试

数据库检查：

```bash
npm --prefix backend run db:check
```

数据库备份：

```bash
npm --prefix backend run db:backup
```

运行后端测试：

```bash
npm run test:backend
```

测试使用临时 SQLite 文件，不污染本地演示数据库。
