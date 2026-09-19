import { strict as assert } from 'node:assert'
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

  return { db, users, telegramAccounts, service }
}

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
