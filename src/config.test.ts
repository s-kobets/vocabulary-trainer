import { strict as assert } from 'node:assert'
import test from 'node:test'
import { loadConfig } from './config'

test('loadConfig applies development defaults', () => {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: 'token',
  })

  assert.equal(config.nodeEnv, 'development')
  assert.equal(config.port, 3000)
  assert.equal(config.databasePath, './data/vocabulary.db')
  assert.equal(config.telegramBotToken, 'token')
})

test('loadConfig fails with the missing required token name', () => {
  assert.throws(
    () => loadConfig({}),
    /Missing required environment variable: TELEGRAM_BOT_TOKEN/,
  )
})

test('loadConfig parses explicit values and preserves optional web settings', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '4310',
    DATABASE_PATH: ':memory:',
    TELEGRAM_BOT_TOKEN: 'token',
    APP_URL: 'http://localhost:4310',
    SESSION_SECRET: 'secret',
  })

  assert.deepEqual(config, {
    nodeEnv: 'test',
    port: 4310,
    databasePath: ':memory:',
    telegramBotToken: 'token',
    appUrl: 'http://localhost:4310',
    sessionSecret: 'secret',
  })
})
