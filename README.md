# im-hub

[中文文档](README.zh-CN.md)

**Universal messenger-to-agent bridge** — connect WeChat/Feishu/Telegram to Claude Code/Codex/Copilot/OpenCode, **or any custom agent via ACP**.

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
  <b>Telegram</b> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <b>WeChat</b>
</p>

```
npm install -g im-hub
im-hub config wechat   # Scan QR to login
im-hub start           # Start the bridge
```

## Web Chat

im-hub includes a built-in web interface for chatting with your agents directly from the browser.

```
im-hub start           # Starts web UI at http://localhost:3000
```

Features:
- Real-time streaming responses via WebSocket
- Agent switching and chat history
- Settings page for managing agents, messengers, and ACP connections
- Bilingual UI (English / Chinese) — auto-detects your browser language

## Features

- **Universal multiplexer** — one instance, multiple messengers, multiple agents
- **Custom agent support** — connect *any* agent via [ACP](https://agentcommunicationprotocol.dev) with `im-hub config agent`
- **Plugin architecture** — easy to add new messengers/agents
- **TypeScript native** — no Go/Docker required
- **JSONL streaming** — real-time agent responses

## Installation

```bash
# Install globally
npm install -g im-hub
```

## Quick Start

```bash
# 1. Configure WeChat
im-hub config wechat
# Scan the QR code with WeChat

# OR configure Feishu (WebSocket long polling - no webhook needed!)
im-hub config feishu
# Enter App ID and App Secret from Feishu Open Platform

# OR configure Telegram
im-hub config telegram
# Get bot token from @BotFather

# 2. Configure Claude Code (optional, auto-detected)
im-hub config claude

# 3. Start the bridge
im-hub start
```

### Feishu Setup (WebSocket Long Polling)

Feishu uses WebSocket long polling mode, which means:
- ✅ No webhook configuration needed
- ✅ No public IP or domain required
- ✅ No ngrok or similar tools needed
- ✅ Works directly from localhost

Just configure your App ID and App Secret, then start the bridge. The bot will automatically connect to Feishu servers via WebSocket.

### Connect Your Own Agent

im-hub speaks **ACP (Agent Communication Protocol)**, so you can plug in any agent that exposes a standard HTTP endpoint — your own business bots, internal tools, cloud services, anything.

```bash
im-hub config agent
# Interactive setup: name, endpoint URL, auth (none / Bearer / API key)
# Connection is validated automatically
```

After setup, chat with it the same way as built-in agents:

```
/myagent analyze the Q1 sales report    # Switch to your custom agent
```

## Commands

```
im-hub                 # Same as 'start'
im-hub start           # Start the bridge
im-hub config wechat   # Configure WeChat
im-hub config feishu   # Configure Feishu
im-hub config telegram # Configure Telegram
im-hub config claude   # Configure Claude Code
im-hub config agent    # Connect a custom ACP agent
im-hub agents          # List available agents
im-hub messengers      # List available messengers
im-hub help
```

## Chat Commands

Send these as messages to the bot:

```
hello                  # Send to default agent (context preserved)
/status                # Show connection status
/help                  # Show available commands
/agents                # List available agents
/new                   # Start a new conversation (clear context)
/cc explain this code  # Switch to Claude Code
/cx explain this code  # Switch to Codex
/co explain this code  # Switch to Copilot
/oc explain this code  # Switch to OpenCode
```

## Architecture

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

## Project Structure

```
im-hub/
├── src/
│   ├── core/
│   │   ├── types.ts              # Plugin interfaces
│   │   ├── registry.ts           # Plugin registration
│   │   ├── router.ts             # Message routing
│   │   └── session.ts            # Session management
│   ├── plugins/
│   │   ├── messengers/
│   │   │   └── wechat/           # WeChat adapter
│   │   └── agents/
│   │       ├── claude-code/      # Claude Code adapter
│   │       ├── codex/            # OpenAI Codex adapter
│   │       ├── copilot/          # GitHub Copilot adapter
│   │       └── opencode/         # OpenCode adapter
│   ├── index.ts                  # Main entry
│   ├── cli.ts                    # CLI commands
│   └── web/
│       ├── server.ts             # Web chat HTTP + WebSocket server
│       └── public/
│           ├── index.html         # Chat UI (bilingual)
│           └── settings.html      # Settings UI (bilingual)
├── package.json
├── tsconfig.json
└── README.md
```

## Configuration

Config file: `~/.im-hub/config.json`

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

## Requirements

- **Node.js 18+**
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`

## Development

```bash
# Clone
git clone https://github.com/ceociocto/im-hub
cd im-hub

# Install deps
npm install

# Build
npm run build

# Run in dev mode (watch)
npm run dev

# Run
npm start
```

## Roadmap

### v0.1.x (MVP)
- [x] WeChat adapter with QR login
- [x] Claude Code agent integration
- [x] Codex agent
- [x] Copilot agent
- [x] OpenCode agent
- [x] Basic command routing

### v0.2.0
- [x] Feishu adapter
- [x] Telegram adapter
- [x] Session persistence with conversation history
- [x] ACP custom agent support

### v0.2.x
- [x] Web Chat UI — browser-based agent chat with streaming responses
- [x] Settings page — configure agents, messengers, and ACP from the browser
- [x] Bilingual UI — English/Chinese with automatic browser language detection

### v0.3.0
- [ ] DingTalk adapter
- [ ] Slack adapter

## Community <a name="wechat-group"></a>

Questions? Feel free to reach out on [X](https://x.com/lijieisme) or join the Discord.

<p align="center">
  <a href="https://discord.gg/R83CXYz5">
    <img src="https://img.shields.io/badge/Join_Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join Discord">
  </a>
  &nbsp;
  <a href="https://x.com/lijieisme">
    <img src="https://img.shields.io/badge/Follow_on_X-000000?style=for-the-badge&logo=x&logoColor=white" alt="X">
  </a>
</p>

<p align="center">
  <img src="assets/wechat-group" alt="WeChat Group" width="180">
</p>

## License

MIT
