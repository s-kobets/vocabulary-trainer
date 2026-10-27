import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runMigrations } from './database'

function sandbox(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vocabulary-backup-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const databasePath = path.join(directory, 'live.sqlite')
  const db = new Database(databasePath)
  runMigrations(db, path.join(__dirname, 'migrations'))
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('original-user', new Date().toISOString())
  db.close()
  return { directory, databasePath }
}

function script(name: string, ...args: string[]) {
  const result = spawnSync('bash', [path.join(__dirname, '../../scripts', name), ...args], { encoding: 'utf8' })
  if (result.error) throw result.error
  return result
}

test('restore rejects missing and empty backups without changing the target database', (t) => {
  const { directory, databasePath } = sandbox(t)
  const missing = path.join(directory, 'missing.sqlite')
  const empty = path.join(directory, 'empty.sqlite')
  new Database(empty).close()
  for (const source of [missing, empty]) {
    const result = script('restore-sqlite.sh', source, databasePath)
    assert.notEqual(result.status, 0, `accepted invalid backup: ${source}`)
    const db = new Database(databasePath, { readonly: true })
    assert.deepEqual(db.prepare('SELECT id FROM users').all(), [{ id: 'original-user' }])
    db.close()
  }
  assert.equal(fs.existsSync(missing), false)
})

test('backup rejects a missing source instead of creating an empty successful backup', (t) => {
  const { directory } = sandbox(t)
  const missing = path.join(directory, 'missing.sqlite')
  const backups = path.join(directory, 'backups')
  const result = script('backup-sqlite.sh', missing, backups)
  assert.notEqual(result.status, 0)
  assert.equal(fs.existsSync(missing), false)
  assert.deepEqual(fs.existsSync(backups) ? fs.readdirSync(backups) : [], [])
})

test('backup and restore preserve application data', (t) => {
  const { directory, databasePath } = sandbox(t)
  const backup = script('backup-sqlite.sh', databasePath, path.join(directory, 'backups'))
  assert.equal(backup.status, 0, backup.stderr)
  const db = new Database(databasePath)
  db.prepare('DELETE FROM users').run()
  db.close()
  const restored = script('restore-sqlite.sh', backup.stdout.trim(), databasePath)
  assert.equal(restored.status, 0, restored.stderr)
  const result = new Database(databasePath, { readonly: true })
  assert.deepEqual(result.prepare('SELECT id FROM users').all(), [{ id: 'original-user' }])
  result.close()
})
