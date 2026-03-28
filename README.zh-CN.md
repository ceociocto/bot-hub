# im-hub

[English](README.md)

**IM 到 AI Agent 的万能桥梁** — 将微信/飞书/Telegram 接入 Claude Code/Codex/Copilot/OpenCode，**或通过 ACP 接入任意自定义 Agent**。

<p align="center">
  <img src="assets/banner.jpg" alt="im-hub banner" width="800">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/im-hub"><img src="https://img.shields.io/npm/dw/im-hub?style=for-the-badge&logo=npm&color=green"></a>
  <a href="https://github.com/ceociocto/im-hub/actions/workflows/release.yml?query=branch%3Amain"><img src="https://img.shields.io/github/actions/workflow/status/ceociocto/im-hub/release.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://www.npmjs.com/package/im-hub"><img src="https://img.shields.io/npm/v/im-hub?style=for-the-badge" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://discord.gg/R83CXYz5"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  &nbsp;
  <a href="https://x.com/lijieisme"><img src="https://img.shields.io/badge/X-000000?style=for-the-badge&logo=x&logoColor=white" alt="X"></a>
</p>

<p align="center">
  <img src="assets/screenshot-telegram.png" alt="Telegram" width="400">
  &nbsp;&nbsp;
  <img src="assets/screenshot-wechat.png" alt="WeChat" width="400">
</p>

<p align="center">
  <b>Telegram</b> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <b>微信</b>
</p>

```
npm install -g im-hub
im-hub config wechat   # 扫码登录微信
im-hub start           # 启动桥接
```

## 核心特性

- **多路复用** — 一个实例，同时对接多个 IM 和多个 Agent
- **自定义 Agent 接入** — 通过 [ACP 协议](https://agentcommunicationprotocol.dev)连接任意 Agent，只需 `im-hub config agent`
- **插件架构** — 轻松扩展新的 IM 通道或 Agent
- **原生 TypeScript** — 无需 Go 或 Docker
- **JSONL 流式输出** — 实时接收 Agent 响应

## 安装

```bash
npm install -g im-hub
```

## 快速开始

```bash
# 1. 配置微信
im-hub config wechat
# 扫描二维码登录

# 或配置飞书（WebSocket 长连接，无需 webhook！）
im-hub config feishu
# 输入飞书开放平台的 App ID 和 App Secret

# 或配置 Telegram
im-hub config telegram
# 从 @BotFather 获取 Bot Token

# 2. 配置 Claude Code（可选，自动检测）
im-hub config claude

# 3. 启动桥接
im-hub start
```

### 飞书配置（WebSocket 长连接）

飞书使用 WebSocket 长连接模式，这意味着：
- 无需配置 webhook
- 无需公网 IP 或域名
- 无需 ngrok 等内网穿透工具
- 直接从本地运行

配置好 App ID 和 App Secret 后启动即可，Bot 会自动通过 WebSocket 连接到飞书服务器。

### 接入你自己的 Agent

im-hub 支持 **ACP（Agent Communication Protocol）**，只需你的 Agent 暴露标准 HTTP 端点，就能接入——不管是业务机器人、内部工具还是云服务，都可以。

```bash
im-hub config agent
# 交互式配置：名称、端点 URL、认证方式（无 / Bearer / API Key）
# 自动验证连接
```

配置完成后，和内置 Agent 一样使用：

```
/myagent 分析一下一季度的销售报告    # 切换到你的自定义 Agent
```

## 命令

```
im-hub                 # 等同于 start
im-hub start           # 启动桥接
im-hub config wechat   # 配置微信
im-hub config feishu   # 配置飞书
im-hub config telegram # 配置 Telegram
im-hub config claude   # 配置 Claude Code
im-hub config agent    # 接入自定义 ACP Agent
im-hub agents          # 列出可用的 Agent
im-hub messengers      # 列出可用的 IM 通道
im-hub help
```

## 聊天命令

在 IM 中直接发送：

```
hello                  # 发送给默认 Agent（保留上下文）
/status                # 查看连接状态
/help                  # 查看可用命令
/agents                # 列出可用的 Agent
/new                   # 开始新对话（清除上下文）
/cc 解释这段代码        # 切换到 Claude Code
/cx 解释这段代码        # 切换到 Codex
/co 解释这段代码        # 切换到 Copilot
/oc 解释这段代码        # 切换到 OpenCode
```

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                        im-hub core                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Plugin      │  │ Message     │  │ Session Manager     │  │
│  │ Registry    │  │ Router      │  │ (per conversation)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐      ┌─────────────────────┐
│ Messenger Plugins│      │  Agent Plugins      │
│ • wechat         │      │ • claude-code        │
│ • feishu ✓        │      │ • codex              │
│ • telegram ✓      │      │ • copilot            │
│                  │      │ • opencode           │
│                  │      │ • your-agent (ACP) ✨ │
└─────────────────┘      └─────────────────────┘
```

## 项目结构

```
im-hub/
├── src/
│   ├── core/
│   │   ├── types.ts              # 插件接口
│   │   ├── registry.ts           # 插件注册
│   │   ├── router.ts             # 消息路由
│   │   └── session.ts            # 会话管理
│   ├── plugins/
│   │   ├── messengers/
│   │   │   └── wechat/           # 微信适配器
│   │   └── agents/
│   │       ├── claude-code/      # Claude Code 适配器
│   │       ├── codex/            # Codex 适配器
│   │       ├── copilot/          # Copilot 适配器
│   │       └── opencode/         # OpenCode 适配器
│   ├── index.ts                  # 主入口
│   └── cli.ts                    # CLI 命令
├── package.json
├── tsconfig.json
└── README.md
```

## 配置

配置文件：`~/.im-hub/config.json`

```json
{
  "messengers": ["wechat"],
  "agents": ["claude-code"],
  "defaultAgent": "claude-code",
  "acpAgents": [
    {
      "name": "my-agent",
      "aliases": ["ma"],
      "endpoint": "https://api.example.com",
      "auth": { "type": "bearer", "token": "***" },
      "enabled": true
    }
  ]
}
```

## 环境要求

- **Node.js 18+**
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`

## 开发

```bash
# 克隆
git clone https://github.com/ceociocto/im-hub
cd im-hub

# 安装依赖
npm install

# 构建
npm run build

# 开发模式（监听文件变化）
npm run dev

# 运行
npm start
```

## 路线图

### v0.1.x (MVP)
- [x] 微信适配器（扫码登录）
- [x] Claude Code Agent 集成
- [x] Codex Agent
- [x] Copilot Agent
- [x] OpenCode Agent
- [x] 基础命令路由

### v0.2.0
- [x] 飞书适配器
- [x] Telegram 适配器
- [x] 会话持久化与对话历史
- [x] ACP 自定义 Agent 接入

### v0.3.0
- [ ] 钉钉适配器
- [ ] Slack 适配器

## 社区 <a name="wechat-group"></a>

有问题？欢迎在 [X](https://x.com/lijieisme) 或 Discord 上交流。

<p align="center">
  <a href="https://discord.gg/R83CXYz5">
    <img src="https://img.shields.io/badge/加入_Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join Discord">
  </a>
  &nbsp;
  <a href="https://x.com/lijieisme">
    <img src="https://img.shields.io/badge/关注_X-000000?style=for-the-badge&logo=x&logoColor=white" alt="X">
  </a>
</p>

<p align="center">
  <img src="assets/wechat-group" alt="微信群" width="180">
</p>

## 许可证

MIT
