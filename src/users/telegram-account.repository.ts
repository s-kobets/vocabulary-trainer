import crypto from 'node:crypto'
import type { SqliteDatabase } from '../db/database'

export type TelegramProfile = {
  telegramUserId: string
  username?: string
  firstName?: string
  lastName?: string
}

export type TelegramAccount = {
  id: string
  userId: string
  telegramUserId: string
  username?: string
  firstName?: string
  lastName?: string
  createdAt: string
  updatedAt: string
}

type TelegramAccountInput = TelegramProfile & { userId: string }

type TelegramAccountRow = {
  id: string
  user_id: string
  telegram_user_id: string
  username: string | null
  first_name: string | null
  last_name: string | null
  created_at: string
  updated_at: string
}

function mapAccount(row: TelegramAccountRow): TelegramAccount {
  return {
    id: row.id,
    userId: row.user_id,
    telegramUserId: row.telegram_user_id,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class TelegramAccountRepository {
  constructor(private readonly db: SqliteDatabase) {}

  findByTelegramUserId(telegramUserId: string): TelegramAccount | null {
    const row = this.db.prepare(`
      SELECT id, user_id, telegram_user_id, username, first_name, last_name,
             created_at, updated_at
      FROM telegram_accounts
      WHERE telegram_user_id = ?
    `).get(telegramUserId) as TelegramAccountRow | undefined
    return row ? mapAccount(row) : null
  }

  createTelegramAccount(input: TelegramAccountInput): TelegramAccount {
    const now = new Date().toISOString()
    const account = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    }
    this.db.prepare(`
      INSERT INTO telegram_accounts
        (id, user_id, telegram_user_id, username, first_name, last_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      account.id,
      account.userId,
      account.telegramUserId,
      account.username ?? null,
      account.firstName ?? null,
      account.lastName ?? null,
      account.createdAt,
      account.updatedAt,
    )
    return account
  }

  updateTelegramProfile(
    userId: string,
    telegramUserId: string,
    profile: Omit<TelegramProfile, 'telegramUserId'>,
  ): void {
    this.db.prepare(`
      UPDATE telegram_accounts
      SET username = ?, first_name = ?, last_name = ?, updated_at = ?
      WHERE user_id = ? AND telegram_user_id = ?
    `).run(
      profile.username ?? null,
      profile.firstName ?? null,
      profile.lastName ?? null,
      new Date().toISOString(),
      userId,
      telegramUserId,
    )
  }
}
