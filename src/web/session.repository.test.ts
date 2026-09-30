import { strict as assert } from 'node:assert'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/database'
import { SessionRepository } from './session.repository'

test('session IDs resolve only before expiry and can be deleted', () => {
  const db = new Database(':memory:')
  runMigrations(db, path.join(__dirname, '../db/migrations'))
  db.prepare("INSERT INTO users (id, created_at) VALUES ('user', '2025-01-01')").run()
  const sessions = new SessionRepository(db)
  const id = sessions.create('user', '2025-01-02T00:00:00.000Z')

  assert.equal(sessions.findUserId(id, '2025-01-01T00:00:00.000Z'), 'user')
  assert.equal(sessions.findUserId(id, '2025-01-02T00:00:00.000Z'), null)
  assert.equal(sessions.findUserId(id, '2025-01-01T00:00:00.000Z'), null)
  db.close()
})
