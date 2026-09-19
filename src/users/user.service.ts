import type { SqliteDatabase } from '../db/database'
import { TelegramAccountRepository, type TelegramProfile } from './telegram-account.repository'
import { UserRepository, type User } from './user.repository'
import { UserSettingsRepository } from './user-settings.repository'

export class UserService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly users: UserRepository,
    private readonly telegramAccounts: TelegramAccountRepository,
    private readonly userSettings: UserSettingsRepository,
  ) {}

  findByTelegramUserId(telegramUserId: string): User | null {
    const account = this.telegramAccounts.findByTelegramUserId(telegramUserId)
    return account ? this.users.findUserById(account.userId) : null
  }

  ensureFromTelegram(profile: TelegramProfile): User {
    const existing = this.telegramAccounts.findByTelegramUserId(profile.telegramUserId)
    if (existing) {
      this.telegramAccounts.updateTelegramProfile(
        existing.userId,
        profile.telegramUserId,
        profile,
      )
      const user = this.users.findUserById(existing.userId)
      if (!user) throw new Error(`User not found: ${existing.userId}`)
      return user
    }

    return this.db.transaction(() => {
      const user = this.users.createUser()
      this.telegramAccounts.createTelegramAccount({ ...profile, userId: user.id })
      this.userSettings.createDefaults(user.id)
      return user
    })()
  }
}
