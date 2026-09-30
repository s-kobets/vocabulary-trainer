import crypto from 'node:crypto'
import type { SqliteDatabase } from '../db/database'

export class SessionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(userId: string, expiresAt: string): string {
    const id = crypto.randomBytes(32).toString('base64url')
    this.db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(id, userId, expiresAt, new Date().toISOString())
    return id
  }

  findUserId(sessionId: string, now = new Date().toISOString()): string | null {
    const row = this.db.prepare('SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?')
      .get(sessionId, now) as { user_id: string } | undefined
    if (!row) this.delete(sessionId)
    return row?.user_id ?? null
  }

  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  }
}
