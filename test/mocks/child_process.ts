// Mock child_process for testing Claude Code adapter

export interface MockProcessOptions {
  chunks?: string[]
  delay?: number
  exitCode?: number
  shouldError?: boolean
  shouldTimeout?: boolean
}

export function createMockClaudeProcess(options: MockProcessOptions = {}) {
  const {
    chunks = ['Hello', ' World'],
    delay = 100,
    exitCode = 0,
    shouldError = false,
    shouldTimeout = false,
  } = options

  const stdoutListeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const stderrListeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const processListeners = new Map<string, Set<(...args: unknown[]) => void>>()

  let stdinBuffer = ''

  const mockProcess = {
    pid: 12345,

    stdin: {
      write: vi.fn().mockImplementation((data: string) => {
        stdinBuffer += data

        // Simulate response after receiving input
        if (!shouldTimeout) {
          setTimeout(() => {
            const dataHandlers = stdoutListeners.get('data') || new Set()

            // Send JSONL chunks
            chunks.forEach((chunk, i) => {
              setTimeout(() => {
                const msg = JSON.stringify({
                  type: 'assistant',
                  message: { content: chunk, role: 'assistant' },
                })
                dataHandlers.forEach(h => h(Buffer.from(msg + '\n')))
              }, delay * (i + 1))
            })

            // Send result message
            setTimeout(() => {
              const msg = JSON.stringify({ type: 'result' })
              dataHandlers.forEach(h => h(Buffer.from(msg + '\n')))

              // Close after result
              setTimeout(() => {
                const closeHandlers = processListeners.get('close') || new Set()
                closeHandlers.forEach(h => h(exitCode))
              }, delay)
            }, delay * (chunks.length + 1))
          }, delay)
        }
      }),
      end: vi.fn(),
      destroy: vi.fn(),
    },

    stdout: {
      on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (!stdoutListeners.has(event)) {
          stdoutListeners.set(event, new Set())
        }
        stdoutListeners.get(event)!.add(handler)
      }),
      destroy: vi.fn(),
    },

    stderr: {
      on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (!stderrListeners.has(event)) {
          stderrListeners.set(event, new Set())
        }
        stderrListeners.get(event)!.add(handler)
      }),
      destroy: vi.fn(),
    },

    on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (!processListeners.has(event)) {
        processListeners.set(event, new Set())
      }
      processListeners.get(event)!.add(handler)

      // Immediately emit error if configured
      if (event === 'error' && shouldError) {
        setTimeout(() => handler(new Error('Process failed')), 0)
      }
    }),

    kill: vi.fn().mockImplementation(() => {
      const closeHandlers = processListeners.get('close') || new Set()
      closeHandlers.forEach(h => h(0))
    }),

    // Expose for assertions
    _mocks: {
      stdoutListeners,
      stderrListeners,
      processListeners,
      stdinBuffer,
    },
  }

  return mockProcess
}

// Mock spawn function
export function createMockSpawn(options: MockProcessOptions = {}) {
  const mockProcess = createMockClaudeProcess(options)

  const spawn = vi.fn().mockImplementation(() => mockProcess)

  return {
    spawn,
    _mockProcess: mockProcess,
  }
}
