import type { SqliteDatabase } from '../db/database'

export type ReminderSettings = {
  userId: string
  timezone: string
  dailyReviewEnabled: boolean
  dailyReviewTime: string
  lastDailyNotificationAt: string | null
  deliveredDate: string | null
  attemptDate: string | null
  attemptCount: number
  lastAttemptAt: string | null
}

type SettingsRow = {
  user_id: string
  timezone: string
  daily_review_enabled: number
  daily_review_time: string
  last_daily_notification_at: string | null
  daily_review_delivered_date: string | null
  daily_review_attempt_date: string | null
  daily_review_attempt_count: number
  daily_review_last_attempt_at: string | null
}

type EnabledSettingsRow = SettingsRow & { telegram_user_id: string }

function mapSettings(row: SettingsRow): ReminderSettings {
  return {
    userId: row.user_id,
    timezone: row.timezone,
    dailyReviewEnabled: row.daily_review_enabled === 1,
    dailyReviewTime: row.daily_review_time,
    lastDailyNotificationAt: row.last_daily_notification_at,
    deliveredDate: row.daily_review_delivered_date,
    attemptDate: row.daily_review_attempt_date,
    attemptCount: row.daily_review_attempt_count,
    lastAttemptAt: row.daily_review_last_attempt_at,
  }
}

const settingsColumns = `
  user_settings.user_id AS user_id, user_settings.timezone AS timezone,
  user_settings.daily_review_enabled AS daily_review_enabled,
  user_settings.daily_review_time AS daily_review_time,
  user_settings.last_daily_notification_at AS last_daily_notification_at,
  user_settings.daily_review_delivered_date AS daily_review_delivered_date,
  user_settings.daily_review_attempt_date AS daily_review_attempt_date,
  user_settings.daily_review_attempt_count AS daily_review_attempt_count,
  user_settings.daily_review_last_attempt_at AS daily_review_last_attempt_at
`

export class UserSettingsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createDefaults(userId: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO user_settings
        (user_id, timezone, daily_review_enabled, daily_review_time)
      VALUES (?, 'UTC', 0, '09:00')
    `).run(userId)
  }

  getForUser(userId: string): ReminderSettings | null {
    const row = this.db.prepare(`SELECT ${settingsColumns} FROM user_settings WHERE user_id = ?`)
      .get(userId) as SettingsRow | undefined
    return row ? mapSettings(row) : null
  }

  updatePreferences(
    userId: string,
    patch: { dailyReviewEnabled?: boolean; dailyReviewTime?: string; timezone?: string },
  ): ReminderSettings | null {
    const fields: string[] = []
    const values: unknown[] = []
    if (patch.dailyReviewEnabled !== undefined) {
      fields.push('daily_review_enabled = ?')
      values.push(patch.dailyReviewEnabled ? 1 : 0)
    }
    if (patch.dailyReviewTime !== undefined) {
      fields.push('daily_review_time = ?')
      values.push(patch.dailyReviewTime)
    }
    if (patch.timezone !== undefined) {
      fields.push('timezone = ?')
      values.push(patch.timezone)
    }
    if (fields.length > 0) this.db.prepare(`UPDATE user_settings SET ${fields.join(', ')} WHERE user_id = ?`)
      .run(...values, userId)
    return this.getForUser(userId)
  }

  listEnabled(): Array<ReminderSettings & { telegramUserId: string }> {
    const rows = this.db.prepare(`
      SELECT ${settingsColumns}, telegram_accounts.telegram_user_id
      FROM user_settings
      JOIN telegram_accounts ON telegram_accounts.user_id = user_settings.user_id
      WHERE user_settings.daily_review_enabled = 1
    `).all() as EnabledSettingsRow[]
    return rows.map((row) => ({ ...mapSettings(row), telegramUserId: row.telegram_user_id }))
  }

  claimAttempt(userId: string, localDate: string, now: Date): number | null {
    return this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT daily_review_enabled, daily_review_delivered_date, daily_review_attempt_date,
               daily_review_attempt_count, daily_review_last_attempt_at
        FROM user_settings WHERE user_id = ?
      `).get(userId) as Pick<SettingsRow,
        'daily_review_enabled' | 'daily_review_delivered_date' | 'daily_review_attempt_date'
        | 'daily_review_attempt_count' | 'daily_review_last_attempt_at'> | undefined
      if (!row || row.daily_review_enabled !== 1 || row.daily_review_delivered_date === localDate) return null

      const sameDay = row.daily_review_attempt_date === localDate
      const count = sameDay ? row.daily_review_attempt_count : 0
      const lastAttempt = sameDay && row.daily_review_last_attempt_at
        ? Date.parse(row.daily_review_last_attempt_at)
        : Number.NaN
      if (count >= 3 || (Number.isFinite(lastAttempt) && now.getTime() - lastAttempt < 15 * 60_000)) return null

      const attemptCount = count + 1
      this.db.prepare(`
        UPDATE user_settings
        SET daily_review_attempt_date = ?, daily_review_attempt_count = ?, daily_review_last_attempt_at = ?
        WHERE user_id = ? AND daily_review_enabled = 1
      `).run(localDate, attemptCount, now.toISOString(), userId)
      return attemptCount
    })()
  }

  markDelivered(userId: string, localDate: string, now: Date): void {
    this.db.prepare(`
      UPDATE user_settings
      SET last_daily_notification_at = ?, daily_review_delivered_date = ?
      WHERE user_id = ?
    `).run(now.toISOString(), localDate, userId)
  }
}
