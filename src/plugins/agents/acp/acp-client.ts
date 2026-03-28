// ACP HTTP client — communicates with remote ACP-compatible agents
//
// ACP convention for endpoint paths (per OpenAPI spec):
//   GET  /agent/card    → Agent Manifest
//   POST /tasks         → Create task (sync or stream)
//   GET  /tasks/{id}    → Get task status
//
// The user provides the base URL. We append these standard paths.

import type { ChatMessage } from '../../../core/types.js'
import type { ACPAgentConfig, ACPManifest, ACPCreateTaskRequest, ACPTaskResponse } from './types.js'

/**
 * Build auth headers from ACP config. Extracted as a shared helper
 * so both ACPClient and CLI config validation use the same logic.
 */
export function buildAuthHeaders(config: { auth?: ACPAgentConfig['auth'] }): Record<string, string> | undefined {
  if (!config.auth || config.auth.type === 'none') return undefined
  if (!config.auth.token) return undefined
  if (config.auth.type === 'bearer') return { Authorization: `Bearer ${config.auth.token}` }
  if (config.auth.type === 'apikey') return { 'X-API-Key': config.auth.token }
  return undefined
}

export class ACPClient {
  private baseUrl: string
  private authHeaders?: Record<string, string>
  private manifest?: ACPManifest

  constructor(config: ACPAgentConfig) {
    this.baseUrl = config.endpoint.replace(/\/$/, '')
    this.authHeaders = buildAuthHeaders(config)
  }

  /** Fetch and cache the Agent Manifest (GET /agent/card) */
  async fetchManifest(): Promise<ACPManifest> {
    const res = await fetch(`${this.baseUrl}/agent/card`, {
      headers: { ...this.authHeaders, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch manifest: ${res.status} ${res.statusText}`)
    }

    this.manifest = (await res.json()) as ACPManifest
    return this.manifest
  }

  /** Check if the agent endpoint is reachable */
  async healthCheck(): Promise<boolean> {
    try {
      const manifest = await this.fetchManifest()
      return !!manifest.name
    } catch {
      return false
    }
  }

  /**
   * Send prompt and stream response chunks via SSE.
   * Parses Server-Sent Events per the W3C spec:
   * - Multiple `data:` lines for a single event are joined with newlines
   * - Events separated by blank lines
   */
  async *streamPrompt(prompt: string, history?: ChatMessage[]): AsyncGenerator<string> {
    const body: ACPCreateTaskRequest = {
      input: {
        prompt,
        history: history?.map((m) => ({ role: m.role, content: m.content })),
      },
      mode: 'stream',
    }

    const res = await fetch(`${this.baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000), // 5min timeout for long tasks
    })

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'unknown error')
      throw new Error(`ACP task failed: ${res.status} ${errorBody}`)
    }

    // Parse SSE stream (W3C spec compliant)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body for streaming')

    const decoder = new TextDecoder()
    let buffer = ''
    let eventDataLines: string[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete lines
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '')
        buffer = buffer.slice(newlineIdx + 1)

        if (line === '') {
          // Empty line = end of event. Process accumulated data.
          if (eventDataLines.length > 0) {
            const data = eventDataLines.join('\n')
            eventDataLines = []

            if (data === '[DONE]') return

            try {
              const event = JSON.parse(data)
              if (event.output?.content) {
                yield event.output.content
              } else if (event.error) {
                throw new Error(`ACP error: ${event.error.message}`)
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue
              throw e
            }
          }
        } else if (line.startsWith('data: ')) {
          eventDataLines.push(line.slice(6))
        } else if (line.startsWith('data:')) {
          eventDataLines.push(line.slice(5).trimStart())
        }
        // Ignore comment lines (starting with ':') and other SSE fields
      }
    }

    // Process any remaining data in buffer
    if (eventDataLines.length > 0) {
      const data = eventDataLines.join('\n')
      if (data !== '[DONE]') {
        try {
          const event = JSON.parse(data)
          if (event.output?.content) yield event.output.content
        } catch {
          /* ignore trailing malformed data */
        }
      }
    }
  }

  /** Send prompt and wait for complete response (non-streaming fallback) */
  async sendPromptSync(prompt: string, history?: ChatMessage[]): Promise<string> {
    const body: ACPCreateTaskRequest = {
      input: {
        prompt,
        history: history?.map((m) => ({ role: m.role, content: m.content })),
      },
      mode: 'sync',
    }

    const res = await fetch(`${this.baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    })

    if (!res.ok) {
      throw new Error(`ACP task failed: ${res.status}`)
    }

    const task = (await res.json()) as ACPTaskResponse
    return task.output?.content || ''
  }
}
