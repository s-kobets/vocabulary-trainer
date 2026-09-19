import { strict as assert } from 'node:assert'
import test from 'node:test'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../db/database'
import { getLanguages } from './languages'
import { LanguagePairRepository } from './language-pair.repository'
import { LanguagePairService } from './language-pair.service'

function createLanguagePairs() {
  const db = new Database(':memory:')
  runMigrations(db, path.join(__dirname, '../db/migrations'))
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?), (?, ?)')
    .run('user-a', new Date().toISOString(), 'user-b', new Date().toISOString())
  const repository = new LanguagePairRepository(db)
  const service = new LanguagePairService(db, repository)
  return { db, repository, service }
}

test('returns the static language catalog in its configured order', () => {
  assert.deepEqual(getLanguages().map((language) => language.code), [
    'en', 'ru', 'ka', 'de', 'fr', 'es', 'it', 'pt',
  ])
})

test('creates and replaces a user default without affecting another user', () => {
  const { db, repository, service } = createLanguagePairs()
  const userA = 'user-a'
  const userB = 'user-b'

  const first = service.createDefault(userA, 'en', 'ru')
  const second = service.createDefault(userA, 'de', 'ru')

  assert.equal(repository.findDefaultForUser(userA)?.id, second.id)
  assert.equal(repository.findByIdForUser(userA, first.id)?.isDefault, false)
  assert.equal(repository.findDefaultForUser(userB), null)
  assert.equal(repository.findByIdForUser(userB, first.id), null)
  assert.deepEqual(
    new Set(repository.findForUser(userA).map((pair) => pair.id)),
    new Set([first.id, second.id]),
  )
  db.close()
})

test('reusing the same pair is idempotent and makes it default', () => {
  const { db, repository, service } = createLanguagePairs()

  const first = service.createDefault('user-a', 'en', 'ru')
  const second = service.createDefault('user-a', 'en', 'ru')

  assert.equal(second.id, first.id)
  assert.equal(repository.findForUser('user-a').length, 1)
  assert.equal(repository.findDefaultForUser('user-a')?.id, first.id)
  db.close()
})

test('rejects unknown language codes before creating a pair', () => {
  const { db, repository, service } = createLanguagePairs()

  assert.throws(() => service.createDefault('user-a', 'xx', 'ru'), /Unknown language: xx/)
  assert.throws(() => service.createDefault('user-a', 'en', 'xx'), /Unknown language: xx/)
  assert.deepEqual(repository.findForUser('user-a'), [])
  db.close()
})

test('setDefault rejects a pair owned by another user', () => {
  const { db, repository, service } = createLanguagePairs()
  const pair = service.createDefault('user-a', 'en', 'ru')

  assert.throws(() => repository.setDefault('user-b', pair.id), /does not belong to user/)
  assert.equal(repository.findDefaultForUser('user-a')?.id, pair.id)
  db.close()
})
