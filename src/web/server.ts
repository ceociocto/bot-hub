// Web chat server — HTTP + WebSocket for browser-based agent interaction

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer, type WebSocket } from 'ws'
import { parseMessage, routeMessage } from '../core/router.js'
import { sessionManager } from '../core/session.js'
import { registry } from '../core/registry.js'
import {
  isAgentAvailableCached,
  loadConfig,
  saveConfig,
  type Config,
} from '../core/onboarding.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, 'public')
const DEFAULT_PORT = 3000

interface ClientConnection {
  ws: WebSocket
  id: string
  agent: string
}

/**
 * Start the web chat server
 */
export async function startWebServer(options: {
  port?: number
  defaultAgent: string
}): Promise<{ close: () => void; port: number }> {
  const port = options.port || DEFAULT_PORT
  const clients = new Map<string, ClientConnection>()

  // HTTP request handler — static files + REST API
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)

    // Static pages
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveStatic(res, join(PUBLIC_DIR, 'index.html'), 'text/html')
    }
    if (url.pathname === '/settings' || url.pathname === '/settings.html') {
      return serveStatic(res, join(PUBLIC_DIR, 'settings.html'), 'text/html')
    }

    // REST API
    if (url.pathname === '/api/config' && req.method === 'GET') {
      return handleGetConfig(req, res)
    }
    if (url.pathname === '/api/config' && req.method === 'PUT') {
      return handlePutConfig(req, res)
    }
    if (url.pathname === '/api/agents/status' && req.method === 'GET') {
      return handleAgentsStatus(req, res)
    }
    if (url.pathname === '/api/agents/acp/test' && req.method === 'POST') {
      return handleAcpTest(req, res)
    }

    res.writeHead(404)
    res.end('Not found')
  })

  // WebSocket server
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws: WebSocket) => {
    const clientId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const client: ClientConnection = { ws, id: clientId, agent: options.defaultAgent }
    clients.set(clientId, client)

    console.log(`[Web] Client connected: ${clientId}`)

    // Send available agents list
    sendToClient(ws, {
      type: 'init',
      agents: registry.listAgents(),
      defaultAgent: options.defaultAgent,
      clientId,
    })

    // Load existing session history if available
    sendSessionHistory(ws, clientId, options.defaultAgent)

    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString())
        await handleClientMessage(client, msg, options.defaultAgent)
      } catch (err) {
        console.error('[Web] Error parsing message:', err)
        sendToClient(ws, { type: 'error', message: 'Invalid message format' })
      }
    })

    ws.on('close', () => {
      console.log(`[Web] Client disconnected: ${clientId}`)
      clients.delete(clientId)
    })

    ws.on('error', (err) => {
      console.error(`[Web] Client error: ${clientId}`, err)
      clients.delete(clientId)
    })
  })

  // Start listening
  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', reject)
    httpServer.listen(port, () => resolve())
  })

  console.log(`[Web] Chat UI available at http://localhost:${port}`)

  return {
    port,
    close: () => {
      // Close all WebSocket connections
      for (const [id, client] of clients) {
        client.ws.close()
        clients.delete(id)
      }
      wss.close()
      httpServer.close()
    },
  }
}

// ============================================
// REST API handlers
// ============================================

async function handleGetConfig(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const config = await loadConfig()
    const agentStatus = await getAgentStatuses()

    sendJson(res, 200, {
      messengers: config.messengers,
      agents: config.agents,
      defaultAgent: config.defaultAgent,
      telegram: config.telegram
        ? { botToken: mask(config.telegram.botToken), channelId: config.telegram.channelId }
        : undefined,
      feishu: config.feishu
        ? { appId: config.feishu.appId, appSecret: mask(config.feishu.appSecret) }
        : undefined,
      acpAgents: config.acpAgents?.map(a => ({
        ...a,
        auth: a.auth
          ? { ...a.auth, token: a.auth.token ? mask(a.auth.token) : undefined }
          : undefined,
      })),
      webPort: config.webPort,
      agentStatus,
    })
  } catch (err) {
    sendJson(res, 500, { error: 'Failed to load config' })
  }
}

async function handlePutConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req)
    const incoming = JSON.parse(body) as Config

    // Merge with existing config — only overwrite fields that are present
    const existing = await loadConfig()

    // Simple merge: incoming fields overwrite existing
    const merged: Config = {
      ...existing,
      ...incoming,
    }

    await saveConfig(merged)
    sendJson(res, 200, { ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    sendJson(res, 400, { error: msg })
  }
}

async function handleAgentsStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const agentStatus = await getAgentStatuses()
    sendJson(res, 200, agentStatus)
  } catch (err) {
    sendJson(res, 500, { error: 'Failed to check agents' })
  }
}

async function handleAcpTest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req)
    const { endpoint, auth } = JSON.parse(body)

    // Dynamic import to avoid circular deps
    const { ACPClient } = await import('../plugins/agents/acp/acp-client.js')
    const client = new ACPClient({ name: 'test', endpoint, auth })
    const manifest = await client.fetchManifest()

    sendJson(res, 200, {
      ok: true,
      name: manifest.name,
      description: manifest.description,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    sendJson(res, 400, { ok: false, error: msg })
  }
}

// ============================================
// Helpers
// ============================================

async function getAgentStatuses(): Promise<Record<string, boolean>> {
  const agents = registry.listAgents()
  const status: Record<string, boolean> = {}
  await Promise.all(
    agents.map(async (name) => {
      const agent = registry.findAgent(name)
      if (agent) {
        try {
          status[name] = await agent.isAvailable()
        } catch {
          status[name] = false
        }
      }
    })
  )
  return status
}

function mask(value: string | undefined): string {
  if (!value) return ''
  if (value.length <= 4) return '****'
  return value.slice(0, 2) + '****' + value.slice(-2)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// ============================================
// WebSocket chat handlers
// ============================================

/**
 * Handle a message from a web client
 */
async function handleClientMessage(
  client: ClientConnection,
  msg: { type: string; text?: string; agent?: string },
  defaultAgent: string
): Promise<void> {
  const { ws, id: clientId } = client

  switch (msg.type) {
    case 'message': {
      if (!msg.text?.trim()) return

      const text = msg.text.trim()

      // Handle agent switch request
      if (msg.agent && msg.agent !== client.agent) {
        client.agent = msg.agent
      }

      // Parse and route through existing router
      const parsed = parseMessage(text)

      try {
        const result = await routeMessage(parsed, {
          threadId: clientId,
          channelId: 'web',
          platform: 'web',
          defaultAgent: client.agent,
        })

        // String response (built-in commands, errors)
        if (typeof result === 'string') {
          sendToClient(ws, { type: 'done', text: result })
          return
        }

        // Streaming response (agent responses)
        let fullText = ''
        for await (const chunk of result) {
          fullText += chunk
          sendToClient(ws, { type: 'chunk', text: chunk })
        }
        sendToClient(ws, { type: 'done', text: fullText })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error('[Web] Error handling message:', errorMsg)
        sendToClient(ws, { type: 'error', message: `Agent error: ${errorMsg}` })
      }
      break
    }

    case 'switch-agent': {
      if (!msg.agent) return
      const agent = registry.findAgent(msg.agent)
      if (!agent) {
        sendToClient(ws, { type: 'error', message: `Agent "${msg.agent}" not found` })
        return
      }
      if (!(await isAgentAvailableCached(agent.name))) {
        sendToClient(ws, { type: 'error', message: `Agent "${agent.name}" is not available` })
        return
      }
      client.agent = agent.name
      await sessionManager.switchAgent('web', 'web', clientId, agent.name)
      sendToClient(ws, { type: 'agent-switched', agent: agent.name })
      break
    }

    case 'get-agents': {
      const agents = registry.listAgents()
      sendToClient(ws, { type: 'agents', agents })
      break
    }

    case 'get-history': {
      await sendSessionHistory(ws, clientId, defaultAgent)
      break
    }
  }
}

/**
 * Send session history to a client
 */
async function sendSessionHistory(ws: WebSocket, clientId: string, defaultAgent: string): Promise<void> {
  const history = await sessionManager.getSessionWithHistory('web', 'web', clientId)
  if (history && history.messages.length > 0) {
    sendToClient(ws, {
      type: 'history',
      messages: history.messages,
      agent: history.session.agent,
    })
  }
}

/**
 * Send a JSON message to a WebSocket client
 */
function sendToClient(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

/**
 * Serve a static file
 */
function serveStatic(res: ServerResponse, filePath: string, contentType: string): void {
  if (!existsSync(filePath)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const content = readFileSync(filePath)
  res.writeHead(200, { 'Content-Type': contentType })
  res.end(content)
}
