# bot-hub

**Universal messenger-to-agent bridge** — connect WeChat/Feishu/Telegram to Claude Code/Codex/Copilot/OpenCode.

```
npm install -g bot-hub
bot-hub config wechat   # Scan QR to login
bot-hub start           # Start the bridge
```

## Features

- **Universal multiplexer** — one instance, multiple messengers, multiple agents
- **Plugin architecture** — easy to add new messengers/agents
- **TypeScript native** — no Go/Docker required
- **JSONL streaming** — real-time agent responses

## Installation

```bash
# Install globally
npm install -g bot-hub
```

## Quick Start

```bash
# 1. Configure WeChat
bot-hub config wechat
# Scan the QR code with WeChat

# 2. Configure Claude Code (optional, auto-detected)
bot-hub config claude

# 3. Start the bridge
bot-hub start
```

## Commands

```
bot-hub                 # Same as 'start'
bot-hub start           # Start the bridge
bot-hub config wechat   # Configure WeChat
bot-hub config claude   # Configure Claude Code
bot-hub agents          # List available agents
bot-hub messengers      # List available messengers
bot-hub help
```

## Chat Commands

Send these as messages to the bot:

```
hello                  # Send to default agent
/status                # Show connection status
/help                  # Show available commands
/agents                # List available agents
/cc explain this code  # Switch to Claude Code
/cx explain this code  # Switch to Codex
/co explain this code  # Switch to Copilot
/oc explain this code  # Switch to OpenCode
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        bot-hub core                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Plugin      │  │ Message     │  │ Session Manager     │  │
│  │ Registry    │  │ Router      │  │ (per conversation)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐      ┌─────────────────┐
│ Messenger Plugins│      │  Agent Plugins  │
│ • wechat         │      │ • claude-code    │
│ • feishu (v2)    │      │ • codex          │
│ • telegram (v2)  │      │ • copilot        │
│                  │      │ • opencode       │
└─────────────────┘      └─────────────────┘
```

## Project Structure

```
bot-hub/
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
│   └── cli.ts                    # CLI commands
├── package.json
├── tsconfig.json
└── README.md
```

## Configuration

Config file: `~/.bot-hub/config.json`

```json
{
  "messengers": ["wechat"],
  "agents": ["claude-code"],
  "defaultAgent": "claude-code"
}
```

## Requirements

- **Node.js 18+**
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`

## Development

```bash
# Clone
git clone https://github.com/ceociocto/bot-hub
cd bot-hub

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
- [ ] Feishu adapter
- [ ] Telegram adapter
- [ ] Session persistence

## License

MIT
