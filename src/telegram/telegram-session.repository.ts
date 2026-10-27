import type { SqliteDatabase } from '../db/database'
import type { BotSession } from './telegram.types'

export class TelegramSessionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  find(telegramUserId: string): BotSession | undefined {
    const row = this.db.prepare('SELECT session_json, expires_at FROM telegram_sessions WHERE telegram_user_id = ?')
      .get(telegramUserId) as { session_json: string; expires_at: string | null } | undefined
    if (!row) return undefined
    if (!row.expires_at || Date.parse(row.expires_at) > Date.now()) {
      try {
        const session: unknown = JSON.parse(row.session_json)
        if (session && typeof session === 'object' && !Array.isArray(session)) return session as BotSession
      } catch { /* Invalid stored sessions expire like missing sessions. */ }
    }
    this.delete(telegramUserId)
    return undefined
  }

  save(telegramUserId: string, session: BotSession | undefined, ttlMs: number): void {
    if (!session || Object.keys(session).length === 0) {
      this.delete(telegramUserId)
      return
    }
    const now = new Date()
    this.db.prepare(`
      INSERT INTO telegram_sessions (telegram_user_id, session_json, updated_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        session_json = excluded.session_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `).run(telegramUserId, JSON.stringify(session), now.toISOString(), new Date(now.getTime() + ttlMs).toISOString())
  }

  private delete(telegramUserId: string): void {
    this.db.prepare('DELETE FROM telegram_sessions WHERE telegram_user_id = ?').run(telegramUserId)
  }
}
