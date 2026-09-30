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
  assert.equal(config.telegramBotUsername, undefined)
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
    TELEGRAM_BOT_USERNAME: '@vocabulary_test_bot',
    APP_URL: 'http://localhost:4310',
    SESSION_SECRET: 'secret',
    OPENAI_API_KEY: 'openai-key',
    OPENAI_MODEL: 'gpt-test',
  })

  assert.deepEqual(config, {
    nodeEnv: 'test',
    port: 4310,
    databasePath: ':memory:',
    telegramBotToken: 'token',
    telegramBotUsername: 'vocabulary_test_bot',
    appUrl: 'http://localhost:4310',
    sessionSecret: 'secret',
    openAiApiKey: 'openai-key',
    openAiModel: 'gpt-test',
  })
})
