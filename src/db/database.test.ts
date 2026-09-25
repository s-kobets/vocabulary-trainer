import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { isDatabaseHealthy, openDatabase, runMigrations } from './database'

const migrationDirectory = path.join(__dirname, 'migrations')

test('migrations create the schema and are idempotent', () => {
  const db = new Database(':memory:')

  runMigrations(db, migrationDirectory)
  runMigrations(db, migrationDirectory)

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  const migrations = db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]

  assert.deepEqual(tables.map((row) => row.name), [
    'language_pairs',
    'review_states',
    'reviews',
    'schema_migrations',
    'sessions',
    'telegram_accounts',
    'telegram_sessions',
    'user_settings',
    'users',
    'vocabulary_items',
  ])
  assert.deepEqual(migrations.map((row) => row.version), ['001', '002'])
  assert.equal(isDatabaseHealthy(db), true)
  db.close()
})

test('persistent session and enrichment migration preserves existing vocabulary', () => {
  const db = new Database(':memory:')
  runMigrations(db, migrationDirectory)

  const columns = db.prepare('PRAGMA table_info(vocabulary_items)').all() as { name: string }[]
  assert.ok(columns.some((column) => column.name === 'enrichment_status'))
  assert.ok(columns.some((column) => column.name === 'enrichment_attempts'))
  assert.ok(columns.some((column) => column.name === 'enrichment_last_error'))
  assert.ok(columns.some((column) => column.name === 'enriched_at'))

  db.prepare("INSERT INTO users (id, created_at) VALUES ('user', 'now')").run()
  db.prepare("INSERT INTO language_pairs (id, user_id, source_language, target_language, created_at) VALUES ('pair', 'user', 'en', 'ru', 'now')").run()
  db.prepare("INSERT INTO vocabulary_items (id, user_id, language_pair_id, text, normalized_text, item_type, translations_json, status, created_at, updated_at) VALUES ('item', 'user', 'pair', 'word', 'word', 'word', '[\"слово\"]', 'inbox', 'now', 'now')").run()

  const item = db.prepare('SELECT enrichment_status, enrichment_attempts FROM vocabulary_items WHERE id = ?').get('item') as { enrichment_status: string; enrichment_attempts: number }
  assert.deepEqual(item, { enrichment_status: 'ready', enrichment_attempts: 0 })
  assert.deepEqual(db.prepare('SELECT * FROM telegram_sessions').all(), [])
  db.close()
})

test('database opening creates parent directories and enables required pragmas', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vocabulary-trainer-'))
  const databasePath = path.join(temporaryDirectory, 'nested', 'vocabulary.db')
  const db = openDatabase(databasePath)

  assert.equal(fs.existsSync(path.dirname(databasePath)), true)
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal')

  db.close()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

test('schema enforces foreign keys, unique defaults, and checks', () => {
  const db = new Database(':memory:')
  runMigrations(db, migrationDirectory)

  assert.throws(
    () => db.prepare(
      "INSERT INTO telegram_accounts (id, user_id, telegram_user_id, created_at, updated_at) VALUES ('account', 'missing', 'telegram', 'now', 'now')",
    ).run(),
    /FOREIGN KEY constraint failed/,
  )

  db.prepare("INSERT INTO users (id, created_at) VALUES ('user', 'now')").run()
  db.prepare("INSERT INTO language_pairs (id, user_id, source_language, target_language, is_default, created_at) VALUES ('pair-1', 'user', 'en', 'ru', 1, 'now')").run()
  assert.throws(
    () => db.prepare("INSERT INTO language_pairs (id, user_id, source_language, target_language, is_default, created_at) VALUES ('pair-2', 'user', 'de', 'ru', 1, 'now')").run(),
    /UNIQUE constraint failed/,
  )
  assert.throws(
    () => db.prepare("INSERT INTO user_settings (user_id, daily_review_enabled) VALUES ('user', 2)").run(),
    /CHECK constraint failed/,
  )

  db.prepare("INSERT INTO users (id, created_at) VALUES ('other-user', 'now')").run()
  db.prepare("INSERT INTO language_pairs (id, user_id, source_language, target_language, created_at) VALUES ('other-pair', 'other-user', 'de', 'ru', 'now')").run()
  assert.throws(
    () => db.prepare(`
      INSERT INTO vocabulary_items
        (id, user_id, language_pair_id, text, normalized_text, item_type, status, created_at, updated_at)
      VALUES ('cross-item', 'user', 'other-pair', 'word', 'word', 'word', 'inbox', 'now', 'now')
    `).run(),
    /FOREIGN KEY constraint failed/,
  )
  db.prepare(`
    INSERT INTO vocabulary_items
      (id, user_id, language_pair_id, text, normalized_text, item_type, status, created_at, updated_at)
    VALUES ('owned-item', 'user', 'pair-1', 'word', 'word', 'word', 'inbox', 'now', 'now')
  `).run()
  assert.throws(
    () => db.prepare(`
      INSERT INTO review_states
        (id, user_id, vocabulary_item_id, next_review_at, created_at, updated_at)
      VALUES ('cross-state', 'other-user', 'owned-item', 'now', 'now', 'now')
    `).run(),
    /FOREIGN KEY constraint failed/,
  )
  assert.throws(
    () => db.prepare(`
      INSERT INTO reviews
        (id, user_id, vocabulary_item_id, direction, result, level_before, level_after, reviewed_at)
      VALUES ('cross-review', 'other-user', 'owned-item', 'source_to_target', 'correct', 0, 1, 'now')
    `).run(),
    /FOREIGN KEY constraint failed/,
  )

  db.close()
})

test('failed migrations roll back schema changes and migration records', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vocabulary-trainer-'))
  fs.writeFileSync(
    path.join(temporaryDirectory, '002_broken.sql'),
    'CREATE TABLE partial_table (id TEXT);\nCREATE TABLE broken_table (',
  )
  const db = new Database(':memory:')

  assert.throws(() => runMigrations(db, temporaryDirectory), /incomplete input/)
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_table'").get(),
    undefined,
  )
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations').all(), [])

  db.close()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

test('health reports false for a closed database', () => {
  const db = new Database(':memory:')
  db.close()

  assert.equal(isDatabaseHealthy(db), false)
})
