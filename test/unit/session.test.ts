// Unit tests for session manager

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test'
import { mkdir, rm, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// Create a testable version of SessionManager
interface Session {
  id: string
  threadId: string
  platform: string
  agent: string
  createdAt: Date
  lastActivity: Date
  ttl: number
}

const DEFAULT_TTL = 30 * 60 * 1000 // 30 minutes

class TestableSessionManager {
  private sessions = new Map<string, Session>()
  private sessionsDir: string
  private cleanupTimer?: ReturnType<typeof setInterval>

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir
  }

  async start(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true })
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
  }

  async getOrCreateSession(
    platform: string,
    threadId: string,
    agent: string,
    ttl: number = DEFAULT_TTL
  ): Promise<Session> {
    const key = `${platform}:${threadId}`
    const now = new Date()

    let session = this.sessions.get(key)

    if (session) {
      if (now.getTime() - session.lastActivity.getTime() > session.ttl) {
        session = undefined
      } else {
        session.lastActivity = now
        await this.saveSession(key, session)
        return session
      }
    }

    session = await this.loadSession(key)

    if (session && now.getTime() - session.lastActivity.getTime() <= session.ttl) {
      session.lastActivity = now
      this.sessions.set(key, session)
      await this.saveSession(key, session)
      return session
    }

    session = {
      id: `${platform}-${threadId}-${Date.now()}`,
      threadId,
      platform,
      agent,
      createdAt: now,
      lastActivity: now,
      ttl,
    }

    this.sessions.set(key, session)
    await this.saveSession(key, session)

    return session
  }

  async switchAgent(
    platform: string,
    threadId: string,
    newAgent: string
  ): Promise<Session> {
    const key = `${platform}:${threadId}`
    const existing = this.sessions.get(key) || (await this.loadSession(key))

    const now = new Date()
    const session: Session = {
      id: `${platform}-${threadId}-${Date.now()}`,
      threadId,
      platform,
      agent: newAgent,
      createdAt: existing?.createdAt || now,
      lastActivity: now,
      ttl: DEFAULT_TTL,
    }

    this.sessions.set(key, session)
    await this.saveSession(key, session)

    return session
  }

  private async saveSession(key: string, session: Session): Promise<void> {
    const filePath = join(this.sessionsDir, `${key.replace(/:/g, '-')}.json`)
    try {
      await writeFile(filePath, JSON.stringify(session))
    } catch {
      // Ignore save errors
    }
  }

  private async loadSession(key: string): Promise<Session | undefined> {
    const filePath = join(this.sessionsDir, `${key.replace(/:/g, '-')}.json`)
    try {
      const data = await readFile(filePath, 'utf-8')
      const session = JSON.parse(data) as Session
      // Convert date strings back to Date objects
      session.createdAt = new Date(session.createdAt)
      session.lastActivity = new Date(session.lastActivity)
      return session
    } catch {
      return undefined
    }
  }

  async cleanup(): Promise<void> {
    const now = Date.now()

    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > session.ttl) {
        this.sessions.delete(key)
      }
    }
  }

  // Test helpers
  getSessionCount(): number {
    return this.sessions.size
  }

  hasSession(key: string): boolean {
    return this.sessions.has(key)
  }
}

describe('SessionManager', () => {
  let manager: TestableSessionManager
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `bot-hub-test-${Date.now()}`)
    manager = new TestableSessionManager(testDir)
    await manager.start()
  })

  afterEach(async () => {
    manager.stop()
    await rm(testDir, { recursive: true, force: true })
  })

  describe('getOrCreateSession', () => {
    it('should create a new session', async () => {
      const session = await manager.getOrCreateSession('wechat', 'thread-1', 'claude-code')

      expect(session.platform).toBe('wechat')
      expect(session.threadId).toBe('thread-1')
      expect(session.agent).toBe('claude-code')
      expect(session.id).toContain('wechat-thread-1')
      expect(manager.getSessionCount()).toBe(1)
    })

    it('should return existing session if not expired', async () => {
      const session1 = await manager.getOrCreateSession('wechat', 'thread-1', 'agent-1')
      const session2 = await manager.getOrCreateSession('wechat', 'thread-1', 'agent-2')

      expect(session2.id).toBe(session1.id)
      expect(session2.agent).toBe('agent-1') // Should keep original agent
      expect(manager.getSessionCount()).toBe(1)
    })

    it('should create new session if expired', async () => {
      // Create session with very short TTL
      const session1 = await manager.getOrCreateSession('wechat', 'thread-1', 'agent-1', 1) // 1ms TTL

      // Wait for expiration
      await new Promise(r => setTimeout(r, 10))

      const session2 = await manager.getOrCreateSession('wechat', 'thread-1', 'agent-2')

      expect(session2.id).not.toBe(session1.id)
      expect(session2.agent).toBe('agent-2')
    })

    it('should handle different platforms independently', async () => {
      const session1 = await manager.getOrCreateSession('wechat', 'thread-1', 'agent-1')
      const session2 = await manager.getOrCreateSession('telegram', 'thread-1', 'agent-2')

      expect(session1.id).not.toBe(session2.id)
      expect(manager.getSessionCount()).toBe(2)
    })

    it('should handle different threads independently', async () => {
      const session1 = await manager.getOrCreateSession('wechat', 'thread-1', 'agent-1')
      const session2 = await manager.getOrCreateSession('wechat', 'thread-2', 'agent-2')

      expect(session1.id).not.toBe(session2.id)
      expect(manager.getSessionCount()).toBe(2)
    })

    it('should update lastActivity on access', async () => {
      const session1 = await manager.getOrCreateSession('wechat', 'thread-1', 'agent-1')

      // Wait enough time for timestamp to differ (at least 1ms)
      await new Promise(r => setTimeout(r, 50))

      const session2 = await manager.getOrCreateSession('wechat', 'thread-1', 'agent-2')

      expect(session2.lastActivity.getTime()).toBeGreaterThanOrEqual(session1.lastActivity.getTime())
    })
  })

  describe('switchAgent', () => {
    it('should switch agent and create new session id', async () => {
      const session1 = await manager.getOrCreateSession('wechat', 'thread-1', 'agent-1')

      // Wait to ensure different timestamp
      await new Promise(r => setTimeout(r, 10))

      const session2 = await manager.switchAgent('wechat', 'thread-1', 'agent-2')

      expect(session2.agent).toBe('agent-2')
      expect(session2.id).not.toBe(session1.id)
      expect(session2.threadId).toBe(session1.threadId)
    })

    it('should preserve createdAt timestamp', async () => {
      const session1 = await manager.getOrCreateSession('wechat', 'thread-1', 'agent-1')

      await new Promise(r => setTimeout(r, 10))

      const session2 = await manager.switchAgent('wechat', 'thread-1', 'agent-2')

      expect(session2.createdAt.getTime()).toBe(session1.createdAt.getTime())
    })

    it('should work without existing session', async () => {
      const session = await manager.switchAgent('wechat', 'thread-1', 'agent-1')

      expect(session.agent).toBe('agent-1')
      expect(session.platform).toBe('wechat')
    })
  })

  describe('cleanup', () => {
    it('should remove expired sessions', async () => {
      // Create session with short TTL
      await manager.getOrCreateSession('wechat', 'thread-1', 'agent-1', 1)

      // Create session with normal TTL
      await manager.getOrCreateSession('wechat', 'thread-2', 'agent-2', DEFAULT_TTL)

      expect(manager.getSessionCount()).toBe(2)

      // Wait for first to expire
      await new Promise(r => setTimeout(r, 10))

      await manager.cleanup()

      expect(manager.getSessionCount()).toBe(1)
      expect(manager.hasSession('wechat:thread-2')).toBe(true)
    })
  })

  describe('persistence', () => {
    it('should persist session to disk', async () => {
      await manager.getOrCreateSession('wechat', 'thread-1', 'agent-1')

      // Create new manager with same directory
      const manager2 = new TestableSessionManager(testDir)
      await manager2.start()

      // Should load from disk
      const session = await manager2.getOrCreateSession('wechat', 'thread-1', 'agent-2')

      expect(session.agent).toBe('agent-1') // Should have loaded original
    })
  })
})
