import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/database'
import { TelegramAccountRepository } from './telegram-account.repository'
import { UserRepository } from './user.repository'
import { UserService } from './user.service'
import { UserSettingsRepository } from './user-settings.repository'

function createUsers() {
  const db = new Database(':memory:')
  runMigrations(db, path.join(__dirname, '../db/migrations'))
  const users = new UserRepository(db)
  const telegramAccounts = new TelegramAccountRepository(db)
  const userSettings = new UserSettingsRepository(db)
  const service = new UserService(db, users, telegramAccounts, userSettings)

  return { db, users, telegramAccounts, userSettings, service }
}

test('reminder preferences default disabled and can be updated independently', () => {
  const { db, service, userSettings } = createUsers()
  const user = service.ensureFromTelegram({ telegramUserId: 'telegram-owner' })
  const settings = userSettings as unknown as {
    getForUser: (userId: string) => Record<string, unknown> | null
    updatePreferences: (userId: string, patch: Record<string, unknown>) => Record<string, unknown> | null
    listEnabled: () => Array<Record<string, unknown>>
  }

  assert.deepEqual(settings.getForUser(user.id), {
    userId: user.id,
    timezone: 'UTC',
    dailyReviewEnabled: false,
    dailyReviewTime: '09:00',
    lastDailyNotificationAt: null,
    deliveredDate: null,
    attemptDate: null,
    attemptCount: 0,
    lastAttemptAt: null,
  })
  settings.updatePreferences(user.id, { dailyReviewTime: '08:30', timezone: 'Europe/Moscow' })
  assert.equal(settings.getForUser(user.id)?.dailyReviewTime, '08:30')
  assert.equal(settings.getForUser(user.id)?.timezone, 'Europe/Moscow')
  assert.equal(settings.getForUser(user.id)?.dailyReviewEnabled, false)
  settings.updatePreferences(user.id, { dailyReviewEnabled: true })
  assert.deepEqual(settings.listEnabled().map(({ telegramUserId }) => telegramUserId), ['telegram-owner'])
  db.close()
})

test('reminder delivery attempts persist limits, retry delay, and per-day reset', () => {
  const { db, service, userSettings } = createUsers()
  const user = service.ensureFromTelegram({ telegramUserId: 'telegram-attempts' })
  const settings = userSettings as unknown as {
    updatePreferences: (userId: string, patch: Record<string, unknown>) => void
    claimAttempt: (userId: string, localDate: string, now: Date) => number | null
    markDelivered: (userId: string, localDate: string, now: Date) => void
  }
  settings.updatePreferences(user.id, { dailyReviewEnabled: true })
  const firstAttempt = new Date('2026-09-29T06:00:00.000Z')

  assert.equal(settings.claimAttempt(user.id, '2026-09-29', firstAttempt), 1)
  assert.equal(settings.claimAttempt(user.id, '2026-09-29', new Date(firstAttempt.getTime() + 60_000)), null)
  assert.equal(settings.claimAttempt(user.id, '2026-09-29', new Date(firstAttempt.getTime() + 15 * 60_000)), 2)
  assert.equal(settings.claimAttempt(user.id, '2026-09-29', new Date(firstAttempt.getTime() + 30 * 60_000)), 3)
  assert.equal(settings.claimAttempt(user.id, '2026-09-29', new Date(firstAttempt.getTime() + 45 * 60_000)), null)
  assert.equal(settings.claimAttempt(user.id, '2026-09-30', new Date(firstAttempt.getTime() + 24 * 60 * 60_000)), 1)
  settings.markDelivered(user.id, '2026-09-30', new Date(firstAttempt.getTime() + 24 * 60 * 60_000))
  assert.equal(settings.claimAttempt(user.id, '2026-09-30', new Date(firstAttempt.getTime() + 24 * 60 * 60_000 + 15 * 60_000)), null)
  db.close()
})

test('reminder retry limits survive closing and reopening the SQLite database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vocabulary-reminder-'))
  const databasePath = path.join(directory, 'reminders.sqlite')
  const now = new Date('2026-09-29T06:00:00.000Z')
  const db = new Database(databasePath)
  runMigrations(db, path.join(__dirname, '../db/migrations'))
  const users = new UserRepository(db)
  const telegramAccounts = new TelegramAccountRepository(db)
  const settings = new UserSettingsRepository(db)
  const service = new UserService(db, users, telegramAccounts, settings)
  const user = service.ensureFromTelegram({ telegramUserId: 'telegram-restart' })
  settings.updatePreferences(user.id, { dailyReviewEnabled: true })
  assert.equal(settings.claimAttempt(user.id, '2026-09-29', now), 1)
  db.close()

  try {
    const restartedDb = new Database(databasePath)
    runMigrations(restartedDb, path.join(__dirname, '../db/migrations'))
    const restartedSettings = new UserSettingsRepository(restartedDb)
    assert.equal(restartedSettings.getForUser(user.id)?.attemptCount, 1)
    assert.equal(restartedSettings.claimAttempt(user.id, '2026-09-29', new Date(now.getTime() + 60_000)), null)
    assert.equal(restartedSettings.claimAttempt(user.id, '2026-09-29', new Date(now.getTime() + 15 * 60_000)), 2)
    restartedDb.close()
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('ensureFromTelegram creates all three identity rows once', () => {
  const { db, telegramAccounts, service } = createUsers()

  const first = service.ensureFromTelegram({
    telegramUserId: '9007199254740993',
    username: 'learner',
    firstName: 'Ada',
    lastName: 'Lovelace',
  })
  const second = service.ensureFromTelegram({
    telegramUserId: '9007199254740993',
    username: 'learner-updated',
    firstName: 'Ada',
    lastName: 'Lovelace',
  })

  assert.equal(first.id, second.id)
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count, 1)
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM telegram_accounts').get() as { count: number }).count, 1)
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM user_settings').get() as { count: number }).count, 1)
  assert.equal(telegramAccounts.findByTelegramUserId('9007199254740993')?.telegramUserId, '9007199254740993')
  assert.equal(telegramAccounts.findByTelegramUserId('9007199254740993')?.username, 'learner-updated')

  db.close()
})

test('Telegram IDs remain exact text values', () => {
  const { telegramAccounts, service, db } = createUsers()

  const user = service.ensureFromTelegram({
    telegramUserId: '9007199254740993',
    username: 'learner',
  })
  const account = telegramAccounts.findByTelegramUserId('9007199254740993')

  assert.equal(account?.telegramUserId, '9007199254740993')
  assert.equal(account?.userId, user.id)
  db.close()
})

test('findUserById returns only the requested row and null for missing IDs', () => {
  const { users, db } = createUsers()
  const first = users.createUser()
  const second = users.createUser()

  assert.deepEqual(users.findUserById(first.id), first)
  assert.notDeepEqual(users.findUserById(first.id), second)
  assert.equal(users.findUserById('missing-user'), null)
  db.close()
})

test('profile updates require both owning user and Telegram ID', () => {
  const { users, telegramAccounts, db } = createUsers()
  const owner = users.createUser()
  const other = users.createUser()
  telegramAccounts.createTelegramAccount({
    userId: owner.id,
    telegramUserId: 'telegram-id',
    username: 'before',
  })

  telegramAccounts.updateTelegramProfile(other.id, 'telegram-id', { username: 'not-owner' })
  assert.equal(telegramAccounts.findByTelegramUserId('telegram-id')?.username, 'before')

  telegramAccounts.updateTelegramProfile(owner.id, 'telegram-id', { username: 'after' })
  assert.equal(telegramAccounts.findByTelegramUserId('telegram-id')?.username, 'after')
  db.close()
})
