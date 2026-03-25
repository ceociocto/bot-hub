// Claude Code agent adapter
// Uses --print --output-format stream-json for programmatic interaction

import { spawn, ChildProcess } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import type { AgentAdapter } from '../../../core/types.js'

const SESSIONS_DIR = join(homedir(), '.bot-hub', 'claude-sessions')

interface ClaudeMessage {
  type: string
  subtype?: string
  message?: {
    content: string
    role: string
    partial?: boolean
  }
  result?: string
  error?: string
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code'
  readonly aliases = ['cc', 'claude', 'claudecode']

  private process: ChildProcess | null = null
  private requestId = 0
  private pendingResponses = new Map<number, {
    resolve: (value: string) => void
    reject: (error: Error) => void
    chunks: string[]
  }>()

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('claude', ['--version'], { stdio: 'ignore' })
      proc.on('close', (code) => resolve(code === 0))
      proc.on('error', () => resolve(false))
    })
  }

  async *sendPrompt(sessionId: string, prompt: string): AsyncGenerator<string> {
    // Ensure sessions directory exists
    await mkdir(SESSIONS_DIR, { recursive: true })

    // Start Claude Code process if not running
    if (!this.process) {
      await this.startProcess()
    }

    // Build request
    this.requestId++
    const requestId = this.requestId

    // Send prompt via stdin (JSONL format)
    const request = JSON.stringify({
      type: 'user_message',
      content: prompt,
      session_id: sessionId,
    }) + '\n'

    this.process!.stdin!.write(request)

    // Collect response chunks
    let fullResponse = ''
    let done = false

    while (!done) {
      const chunk = await this.waitForChunk(requestId)
      if (chunk === null) {
        done = true
      } else {
        fullResponse += chunk
        yield chunk
      }
    }
  }

  private startProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn('claude', [
        '--print',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let buffer = ''

      this.process.stdout!.on('data', (data: Buffer) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const msg: ClaudeMessage = JSON.parse(line)
            this.handleMessage(msg)
          } catch {
            // Skip malformed JSON
          }
        }
      })

      this.process.stderr!.on('data', (data: Buffer) => {
        console.error('[Claude Code stderr]', data.toString())
      })

      this.process.on('error', (err) => {
        reject(err)
      })

      this.process.on('close', (code) => {
        this.process = null
        if (code !== 0) {
          reject(new Error(`Claude Code exited with code ${code}`))
        }
      })

      // Process started
      resolve()
    })
  }

  private handleMessage(msg: ClaudeMessage): void {
    if (msg.type === 'assistant' && msg.message) {
      // Stream response - we don't track request IDs in Claude Code
      // Just broadcast to all pending
      for (const pending of this.pendingResponses.values()) {
        pending.chunks.push(msg.message.content)
      }
    }

    if (msg.type === 'result') {
      // Response complete
      for (const [id, pending] of this.pendingResponses.entries()) {
        pending.resolve(pending.chunks.join(''))
        this.pendingResponses.delete(id)
      }
    }

    if (msg.type === 'error' || msg.error) {
      for (const [id, pending] of this.pendingResponses.entries()) {
        pending.reject(new Error(msg.error || 'Unknown error'))
        this.pendingResponses.delete(id)
      }
    }
  }

  private waitForChunk(_requestId: number): Promise<string | null> {
    return new Promise((resolve, reject) => {
      // For now, use a simple timeout
      // TODO: Implement proper request/response tracking
      const timeout = setTimeout(() => {
        resolve(null) // Done
      }, 60000) // 60s timeout

      this.pendingResponses.set(_requestId, {
        resolve: (value) => {
          clearTimeout(timeout)
          resolve(value)
        },
        reject: (err) => {
          clearTimeout(timeout)
          reject(err)
        },
        chunks: [],
      })
    })
  }

  stop(): void {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }
}

// Singleton instance
export const claudeCodeAdapter = new ClaudeCodeAdapter()
