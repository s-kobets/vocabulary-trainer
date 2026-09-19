import { strict as assert } from 'node:assert'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { createHttpApp } from './http'
import { runMigrations } from './db/database'

const migrationDirectory = path.join(__dirname, 'db/migrations')

test('health reports database status and exposes no other routes', async (t) => {
  const db = new Database(':memory:')
  runMigrations(db, migrationDirectory)
  const app = createHttpApp(db)
  t.after(async () => {
    await app.close()
    db.close()
  })

  const health = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(health.statusCode, 200)
  assert.deepEqual(health.json(), { status: 'ok' })

  const notFound = await app.inject({ method: 'GET', url: '/anything-else' })
  assert.equal(notFound.statusCode, 404)
  assert.deepEqual(notFound.json(), { message: 'Something went wrong.' })
})

test('health returns 503 after database closes', async (t) => {
  const db = new Database(':memory:')
  runMigrations(db, migrationDirectory)
  const app = createHttpApp(db)
  t.after(() => app.close())
  db.close()

  const response = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(response.statusCode, 503)
  assert.deepEqual(response.json(), { status: 'error' })
})

test('HTTP failures return and log only sanitized metadata', async (t) => {
  const db = new Database(':memory:')
  runMigrations(db, migrationDirectory)
  const app = createHttpApp(db)
  const logs: unknown[][] = []
  app.addHook('onRequest', (request, _reply, done) => {
    request.log.error = (...args: unknown[]) => logs.push(args)
    done()
  })
  app.get('/boom', async () => {
    throw new Error('private message and stack')
  })
  t.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/boom' })
  assert.equal(response.statusCode, 500)
  assert.deepEqual(response.json(), { message: 'Something went wrong.' })
  assert.equal(JSON.stringify(logs).includes('private message and stack'), false)
  assert.equal(JSON.stringify(logs).includes('stack'), false)
})
