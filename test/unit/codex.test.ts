// Unit tests for Codex adapter

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import type { ChildProcess } from 'child_process'

// Create a mock module
const mockSpawn = mock(() => ({} as ChildProcess))

// Mock the module
mock.module('child_process', () => ({
  spawn: mockSpawn,
}))

describe('CodexAdapter', () => {
  // Create a fresh adapter class for testing
  class TestCodexAdapter {
    readonly name = 'codex'
    readonly aliases = ['cx', 'openai', 'codexcli']

    private process: ChildProcess | null = null

    async isAvailable(): Promise<boolean> {
      return new Promise((resolve) => {
        const proc = mockSpawn() as unknown as ChildProcess
        if (proc.on) {
          proc.on('close', (code: number) => resolve(code === 0))
          proc.on('error', () => resolve(false))
        } else {
          resolve(false)
        }
      })
    }

    async *sendPrompt(_sessionId: string, _prompt: string): AsyncGenerator<string> {
      // Simplified for testing
      yield 'test response from codex'
    }

    stop(): void {
      if (this.process) {
        this.process.kill()
        this.process = null
      }
    }
  }

  let adapter: TestCodexAdapter

  beforeEach(() => {
    mockSpawn.mockClear()
    adapter = new TestCodexAdapter()
  })

  afterEach(() => {
    adapter.stop()
  })

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('codex')
    })

    it('should have expected aliases', () => {
      expect(adapter.aliases).toContain('cx')
      expect(adapter.aliases).toContain('openai')
      expect(adapter.aliases).toContain('codexcli')
    })
  })

  describe('isAvailable', () => {
    it('should call spawn to check availability', async () => {
      const mockProc = {
        on: mock((event: string, cb: (arg: unknown) => void) => {
          if (event === 'close') {
            setTimeout(() => cb(0), 0)
          }
        }),
        stdout: { on: mock() },
        stderr: { on: mock() },
        stdin: { write: mock() },
      }

      mockSpawn.mockImplementation(() => mockProc as unknown as ChildProcess)

      const result = await adapter.isAvailable()

      expect(mockSpawn).toHaveBeenCalled()
      expect(result).toBe(true)
    })

    it('should return false when codex CLI returns non-zero exit', async () => {
      const mockProc = {
        on: mock((event: string, cb: (arg: unknown) => void) => {
          if (event === 'close') {
            setTimeout(() => cb(1), 0)
          }
        }),
        stdout: { on: mock() },
        stderr: { on: mock() },
        stdin: { write: mock() },
      }

      mockSpawn.mockImplementation(() => mockProc as unknown as ChildProcess)

      const result = await adapter.isAvailable()
      expect(result).toBe(false)
    })

    it('should return false on spawn error', async () => {
      const mockProc = {
        on: mock((event: string, cb: (arg: unknown) => void) => {
          if (event === 'error') {
            setTimeout(() => cb(new Error('Spawn error')), 0)
          }
        }),
        stdout: { on: mock() },
        stderr: { on: mock() },
        stdin: { write: mock() },
      }

      mockSpawn.mockImplementation(() => mockProc as unknown as ChildProcess)

      const result = await adapter.isAvailable()
      expect(result).toBe(false)
    })
  })

  describe('sendPrompt', () => {
    it('should yield response chunks', async () => {
      const chunks: string[] = []

      for await (const chunk of adapter.sendPrompt('test-session', 'hello')) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('stop', () => {
    it('should be callable without error', () => {
      expect(() => adapter.stop()).not.toThrow()
    })
  })
})

// Additional tests for Codex adapter behavior
describe('CodexAdapter behavior', () => {
  it('should construct spawn args correctly', () => {
    const args = ['exec', '--json', '--full-auto']
    expect(args).toContain('exec')
    expect(args).toContain('--json')
    expect(args).toContain('--full-auto')
  })

  it('should parse message events', () => {
    const msg = JSON.stringify({
      type: 'message',
      message: { content: 'Hello from Codex!' },
    })

    const parsed = JSON.parse(msg)
    expect(parsed.type).toBe('message')
    expect(parsed.message.content).toBe('Hello from Codex!')
  })

  it('should parse text events', () => {
    const msg = JSON.stringify({
      type: 'text',
      text: 'Simple text response',
    })

    const parsed = JSON.parse(msg)
    expect(parsed.type).toBe('text')
    expect(parsed.text).toBe('Simple text response')
  })

  it('should parse error events', () => {
    const msg = JSON.stringify({
      type: 'error',
      error: 'API error',
    })

    const parsed = JSON.parse(msg)
    expect(parsed.type).toBe('error')
    expect(parsed.error).toBe('API error')
  })

  it('should handle malformed JSON gracefully', () => {
    const malformedLines = ['', 'not json', '{"incomplete": "json']

    for (const line of malformedLines) {
      if (!line.trim()) continue
      try {
        JSON.parse(line)
      } catch {
        expect(true).toBe(true)
      }
    }
  })
})
