import type { SqliteDatabase } from '../db/database'

export class UserSettingsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createDefaults(userId: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO user_settings
        (user_id, timezone, daily_review_enabled, daily_review_time)
      VALUES (?, 'UTC', 0, '09:00')
    `).run(userId)
  }
}
