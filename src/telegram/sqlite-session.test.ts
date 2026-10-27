import { strict as assert } from 'node:assert'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/database'
import { createSqliteSessionMiddleware } from './sqlite-session'
import type { BotContext } from './telegram.types'

function context(id: string, session?: unknown) {
  return { from: { id }, session } as unknown as BotContext
}

test('SQLite session middleware persists exact Telegram IDs and restores state', async () => {
  const db = new Database(':memory:')
  runMigrations(db, `${__dirname}/../db/migrations`)
  const middleware = createSqliteSessionMiddleware(db)

  const first = context('9007199254740993')
  await middleware(first, async () => {
    first.session = { onboarding: { step: 'source' } }
  })

  const second = context('9007199254740993')
  await middleware(second, async () => {
    assert.deepEqual(second.session, { onboarding: { step: 'source' } })
  })

  const row = db.prepare('SELECT telegram_user_id FROM telegram_sessions').get() as { telegram_user_id: string }
  assert.equal(row.telegram_user_id, '9007199254740993')
  db.close()
})

test('SQLite session middleware removes expired and malformed sessions', async () => {
  const db = new Database(':memory:')
  runMigrations(db, `${__dirname}/../db/migrations`)
  db.prepare('INSERT INTO telegram_sessions (telegram_user_id, session_json, updated_at, expires_at) VALUES (?, ?, ?, ?)')
    .run('expired', '{"review":{}}', 'now', new Date(Date.now() - 1).toISOString())
  db.prepare('INSERT INTO telegram_sessions (telegram_user_id, session_json, updated_at, expires_at) VALUES (?, ?, ?, ?)')
    .run('malformed', '{', 'now', null)
  const middleware = createSqliteSessionMiddleware(db)

  const expired = context('expired')
  await middleware(expired, async () => assert.equal(expired.session, undefined))
  const malformed = context('malformed')
  await middleware(malformed, async () => assert.equal(malformed.session, undefined))

  const count = db.prepare('SELECT COUNT(*) AS count FROM telegram_sessions').get() as { count: number }
  assert.equal(count.count, 0)
  db.close()
})

test('concurrent updates preserve session progress for the same user without blocking other users', { timeout: 2000 }, async (t) => {
  const db = new Database(':memory:')
  t.after(() => db.close())
  runMigrations(db, `${__dirname}/../db/migrations`)
  const middleware = createSqliteSessionMiddleware(db)
  const seed = context('42')
  await middleware(seed, async () => {
    seed.session = { review: { itemIds: ['a', 'b', 'c'], index: 0, revealed: false } }
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const first = context('42')
  const second = context('42')
  const firstUpdate = middleware(first, async () => { first.session!.review!.index++; await gate })
  const secondUpdate = middleware(second, async () => { second.session!.review!.index++ })
  await middleware(context('other-user'), async () => undefined)
  release()
  await Promise.all([firstUpdate, secondUpdate])
  const restored = context('42')
  await middleware(restored, async () => assert.equal(restored.session?.review?.index, 2))
})

test('session changes survive handler failure and the next update can proceed', async (t) => {
  const db = new Database(':memory:')
  t.after(() => db.close())
  runMigrations(db, `${__dirname}/../db/migrations`)
  const middleware = createSqliteSessionMiddleware(db)
  const failed = context('42')
  await assert.rejects(async () => {
    await middleware(failed, async () => {
      failed.session = { review: { itemIds: ['a'], index: 1, revealed: false } }
      throw new Error('Telegram response failed after recording the answer')
    })
  }, /Telegram response failed/)
  const restored = context('42')
  await middleware(restored, async () => assert.equal(restored.session?.review?.index, 1))
})
