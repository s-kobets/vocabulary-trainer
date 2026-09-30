import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { Telegraf } from 'telegraf'
import type { ReminderSettings } from '../users/user-settings.repository'
import { registerReminderHandlers } from './reminder.handlers'
import type { BotContext, BotDependencies } from './telegram.types'

type Handler = (ctx: BotContext) => Promise<void> | void

const user = { id: 'user-1', createdAt: '2026-09-29T00:00:00.000Z' }

function createHarness(currentUser: typeof user | null = user) {
  const handlers = new Map<string, Handler>()
  const replies: string[] = []
  const settings: ReminderSettings = {
    userId: user.id,
    timezone: 'UTC',
    dailyReviewEnabled: false,
    dailyReviewTime: '09:00',
    lastDailyNotificationAt: null,
    deliveredDate: null,
    attemptDate: null,
    attemptCount: 0,
    lastAttemptAt: null,
  }
  const dependencies = {
    userService: { findByTelegramUserId: () => currentUser },
    userSettingsRepository: {
      getForUser: () => ({ ...settings }),
      updatePreferences: (_userId: string, patch: Partial<ReminderSettings>) => {
        Object.assign(settings, patch)
        return { ...settings }
      },
    },
  } as unknown as BotDependencies
  const bot = {
    command: (name: string, handler: Handler) => handlers.set(`command:${name}`, handler),
  } as unknown as Telegraf<BotContext>
  registerReminderHandlers(bot, dependencies)
  const run = async (command: 'reminder' | 'timezone', text: string) => {
    await handlers.get(`command:${command}`)?.({
      from: { id: 42, first_name: 'Ada', is_bot: false },
      message: { text },
      reply: async (reply: string) => { replies.push(reply) },
    } as unknown as BotContext)
  }
  return { settings, replies, run }
}

test('/reminder displays status and enables or pauses reminders', async () => {
  const harness = createHarness()
  await harness.run('reminder', '/reminder')
  assert.match(harness.replies.at(-1) ?? '', /paused[\s\S]*09:00[\s\S]*UTC/i)

  await harness.run('reminder', '/reminder@vocabulary_bot on')
  assert.equal(harness.settings.dailyReviewEnabled, true)
  await harness.run('reminder', '/reminder pause')
  assert.equal(harness.settings.dailyReviewEnabled, false)
  assert.equal(harness.settings.dailyReviewTime, '09:00')
  assert.equal(harness.settings.timezone, 'UTC')
})

test('/reminder changes valid local time and rejects invalid values', async () => {
  const harness = createHarness()
  await harness.run('reminder', '/reminder time 08:30')
  assert.equal(harness.settings.dailyReviewTime, '08:30')

  await harness.run('reminder', '/reminder time 9:00')
  assert.equal(harness.settings.dailyReviewTime, '08:30')
  assert.match(harness.replies.at(-1) ?? '', /HH:MM/)
})

test('/timezone accepts IANA zones and rejects invalid identifiers', async () => {
  const harness = createHarness()
  await harness.run('timezone', '/timezone Europe/Moscow')
  assert.equal(harness.settings.timezone, 'Europe/Moscow')

  await harness.run('timezone', '/timezone Mars/Olympus')
  assert.equal(harness.settings.timezone, 'Europe/Moscow')
  assert.match(harness.replies.at(-1) ?? '', /invalid timezone/i)
})

test('reminder settings commands require an initialized user', async () => {
  const harness = createHarness(null)
  await harness.run('reminder', '/reminder on')
  assert.deepEqual(harness.replies, ['Please send /start first'])
})
