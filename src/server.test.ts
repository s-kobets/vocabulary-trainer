import { strict as assert } from 'node:assert'
import test from 'node:test'
import { Telegraf } from 'telegraf'
import { start } from './server'
import { ReminderWorker } from './reminders/reminder.worker'

test('runtime starts health server without contacting Telegram and shuts down once', async () => {
  const previous = {
    databasePath: process.env.DATABASE_PATH,
    token: process.env.TELEGRAM_BOT_TOKEN,
    port: process.env.PORT,
  }
  const launch = Telegraf.prototype.launch
  const stop = Telegraf.prototype.stop
  let stopCalls = 0
  let stopReason: string | undefined

  process.env.DATABASE_PATH = ':memory:'
  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  process.env.PORT = '32123'
  ;(Telegraf.prototype as unknown as { launch: (onLaunch?: () => void) => Promise<void> }).launch = async () => undefined
  ;(Telegraf.prototype as unknown as { stop: (reason?: string) => void }).stop = function (reason?: string) {
    stopCalls++
    stopReason = reason
  }

  try {
    await start()
    const response = await fetch('http://127.0.0.1:32123/health')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok' })
    process.emit('SIGINT')
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(stopCalls, 1)
    assert.equal(stopReason, 'SIGINT')
  } finally {
    Telegraf.prototype.launch = launch
    Telegraf.prototype.stop = stop
    if (previous.databasePath === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = previous.databasePath
    if (previous.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = previous.token
    if (previous.port === undefined) delete process.env.PORT
    else process.env.PORT = previous.port
  }
})

test('runtime starts the health server while Telegram polling remains pending', async () => {
  const previous = {
    databasePath: process.env.DATABASE_PATH,
    token: process.env.TELEGRAM_BOT_TOKEN,
    port: process.env.PORT,
  }
  const launch = Telegraf.prototype.launch
  const stop = Telegraf.prototype.stop
  process.env.DATABASE_PATH = ':memory:'
  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  process.env.PORT = '32128'
  ;(Telegraf.prototype as unknown as { launch: (onLaunch?: () => void) => Promise<void> }).launch = () => new Promise<void>(() => undefined)
  ;(Telegraf.prototype as unknown as { stop: (reason?: string) => void }).stop = () => undefined

  try {
    await start()
    const response = await fetch('http://127.0.0.1:32128/health')
    assert.equal(response.status, 200)
    process.emit('SIGINT')
    await new Promise((resolve) => setTimeout(resolve, 25))
  } finally {
    process.emit('SIGINT')
    await new Promise((resolve) => setTimeout(resolve, 25))
    Telegraf.prototype.launch = launch
    Telegraf.prototype.stop = stop
    if (previous.databasePath === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = previous.databasePath
    if (previous.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = previous.token
    if (previous.port === undefined) delete process.env.PORT
    else process.env.PORT = previous.port
  }
})

test('runtime uses SIGTERM and does not stop twice', async () => {
  const previous = {
    databasePath: process.env.DATABASE_PATH,
    token: process.env.TELEGRAM_BOT_TOKEN,
    port: process.env.PORT,
  }
  const launch = Telegraf.prototype.launch
  const stop = Telegraf.prototype.stop
  let stopCalls = 0
  let stopReason: string | undefined

  process.env.DATABASE_PATH = ':memory:'
  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  process.env.PORT = '32124'
  ;(Telegraf.prototype as unknown as { launch: (onLaunch?: () => void) => Promise<void> }).launch = async () => undefined
  ;(Telegraf.prototype as unknown as { stop: (reason?: string) => void }).stop = function (reason?: string) {
    stopCalls++
    stopReason = reason
  }

  try {
    await start()
    process.emit('SIGTERM')
    process.emit('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(stopCalls, 1)
    assert.equal(stopReason, 'SIGTERM')
  } finally {
    Telegraf.prototype.launch = launch
    Telegraf.prototype.stop = stop
    if (previous.databasePath === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = previous.databasePath
    if (previous.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = previous.token
    if (previous.port === undefined) delete process.env.PORT
    else process.env.PORT = previous.port
  }
})

test('Telegram startup failure is propagated and cleans up resources', async () => {
  const previous = {
    databasePath: process.env.DATABASE_PATH,
    token: process.env.TELEGRAM_BOT_TOKEN,
    port: process.env.PORT,
  }
  const launch = Telegraf.prototype.launch
  const stop = Telegraf.prototype.stop
  let stopCalls = 0

  process.env.DATABASE_PATH = ':memory:'
  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  process.env.PORT = '32125'
  ;(Telegraf.prototype as unknown as { launch: (onLaunch?: () => void) => Promise<void> }).launch = async () => {
    throw new Error('launch failure')
  }
  ;(Telegraf.prototype as unknown as { stop: (reason?: string) => void }).stop = function () {
    stopCalls++
  }

  try {
    await assert.rejects(start(), /launch failure/)
    assert.equal(stopCalls, 1)
    await assert.rejects(fetch('http://127.0.0.1:32125/health'))
  } finally {
    Telegraf.prototype.launch = launch
    Telegraf.prototype.stop = stop
    if (previous.databasePath === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = previous.databasePath
    if (previous.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = previous.token
    if (previous.port === undefined) delete process.env.PORT
    else process.env.PORT = previous.port
  }
})

test('signal during Telegram polling shuts down the running HTTP server', async () => {
  const previous = {
    databasePath: process.env.DATABASE_PATH,
    token: process.env.TELEGRAM_BOT_TOKEN,
    port: process.env.PORT,
  }
  const launch = Telegraf.prototype.launch
  const stop = Telegraf.prototype.stop
  let stopCalls = 0

  process.env.DATABASE_PATH = ':memory:'
  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  process.env.PORT = '32127'
  ;(Telegraf.prototype as unknown as { launch: (onLaunch?: () => void) => Promise<void> }).launch = () => new Promise<void>(() => undefined)
  ;(Telegraf.prototype as unknown as { stop: (reason?: string) => void }).stop = () => {
    stopCalls++
  }

  try {
    const startPromise = start()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal((await fetch('http://127.0.0.1:32127/health')).status, 200)
    process.emit('SIGTERM')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(stopCalls, 1)
    await startPromise
    await assert.rejects(fetch('http://127.0.0.1:32127/health'))
  } finally {
    Telegraf.prototype.launch = launch
    Telegraf.prototype.stop = stop
    if (previous.databasePath === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = previous.databasePath
    if (previous.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = previous.token
    if (previous.port === undefined) delete process.env.PORT
    else process.env.PORT = previous.port
  }
})

test('runtime starts and stops the reminder worker with the application', async () => {
  const previous = {
    databasePath: process.env.DATABASE_PATH,
    token: process.env.TELEGRAM_BOT_TOKEN,
    port: process.env.PORT,
  }
  const launch = Telegraf.prototype.launch
  const stop = Telegraf.prototype.stop
  const reminderStart = ReminderWorker.prototype.start
  const reminderStop = ReminderWorker.prototype.stop
  let startCalls = 0
  let stopCalls = 0

  process.env.DATABASE_PATH = ':memory:'
  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  process.env.PORT = '32129'
  ;(Telegraf.prototype as unknown as { launch: (onLaunch?: () => void) => Promise<void> }).launch = async () => undefined
  ;(Telegraf.prototype as unknown as { stop: (reason?: string) => void }).stop = () => undefined
  ReminderWorker.prototype.start = function () { startCalls++ }
  ReminderWorker.prototype.stop = async function () { stopCalls++ }

  try {
    await start()
    assert.equal(startCalls, 1)
    process.emit('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(stopCalls, 1)
  } finally {
    process.emit('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 25))
    Telegraf.prototype.launch = launch
    Telegraf.prototype.stop = stop
    ReminderWorker.prototype.start = reminderStart
    ReminderWorker.prototype.stop = reminderStop
    if (previous.databasePath === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = previous.databasePath
    if (previous.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = previous.token
    if (previous.port === undefined) delete process.env.PORT
    else process.env.PORT = previous.port
  }
})
