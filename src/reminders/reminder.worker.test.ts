import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { ReminderSettings } from '../users/user-settings.repository'
import { ReminderWorker } from './reminder.worker'

const baseSettings: ReminderSettings & { telegramUserId: string } = {
  userId: 'user-1',
  telegramUserId: '42',
  timezone: 'Europe/Moscow',
  dailyReviewEnabled: true,
  dailyReviewTime: '09:00',
  lastDailyNotificationAt: null,
  deliveredDate: null,
  attemptDate: null,
  attemptCount: 0,
  lastAttemptAt: null,
}

function createWorker(options: {
  settings?: Array<ReminderSettings & { telegramUserId: string }>
  pair?: { id: string } | null
  dueCount?: number
  send?: (chatId: string, text: string, extra: unknown) => Promise<void>
} = {}) {
  const users = options.settings ?? [{ ...baseSettings }]
  const sent: Array<{ chatId: string; text: string; extra: unknown }> = []
  const errors: unknown[][] = []
  const deps = {
    settings: {
      listEnabled: () => users,
      claimAttempt: (userId: string, localDate: string, now: Date) => {
        const user = users.find((entry) => entry.userId === userId)
        if (!user || user.deliveredDate === localDate) return null
        if (user.attemptDate !== localDate) {
          user.attemptDate = localDate
          user.attemptCount = 0
          user.lastAttemptAt = null
        }
        if (user.attemptCount >= 3 || (user.lastAttemptAt
          && now.getTime() - Date.parse(user.lastAttemptAt) < 15 * 60_000)) return null
        user.attemptCount++
        user.lastAttemptAt = now.toISOString()
        return user.attemptCount
      },
      markDelivered: (userId: string, localDate: string, now: Date) => {
        const user = users.find((entry) => entry.userId === userId)
        if (user) {
          user.deliveredDate = localDate
          user.lastDailyNotificationAt = now.toISOString()
        }
      },
    },
    languagePairs: {
      findDefaultForUser: () => options.pair === undefined
        ? { id: 'pair-1', userId: 'user-1', sourceLanguage: 'en', targetLanguage: 'ru', isDefault: true, createdAt: '' }
        : options.pair === null ? null
          : { id: options.pair.id, userId: 'user-1', sourceLanguage: 'en', targetLanguage: 'ru', isDefault: true, createdAt: '' },
    },
    reviews: { countDueForPair: () => options.dueCount ?? 2 },
    send: options.send ?? (async (chatId: string, text: string, extra: unknown) => { sent.push({ chatId, text, extra }) }),
    logger: { error: (...args: unknown[]) => errors.push(args) },
  }
  const worker = new ReminderWorker(deps)
  return { worker, users, sent, errors }
}

test('reminder worker sends due count and existing review callback after local reminder time', async () => {
  const harness = createWorker()

  await harness.worker.runOnce(new Date('2026-09-29T06:01:00.000Z'))

  assert.equal(harness.sent.length, 1)
  assert.equal(harness.sent[0].chatId, '42')
  assert.match(harness.sent[0].text, /2.*due/i)
  assert.match(JSON.stringify(harness.sent[0].extra), /review:start_due/)
  assert.equal(harness.users[0].deliveredDate, '2026-09-29')
})

test('reminder worker skips before-time, empty, missing-pair, and delivered users', async () => {
  const beforeTime = createWorker()
  await beforeTime.worker.runOnce(new Date('2026-09-29T02:59:00.000Z'))
  assert.equal(beforeTime.sent.length, 0)

  const empty = createWorker({ dueCount: 0 })
  await empty.worker.runOnce(new Date('2026-09-29T06:01:00.000Z'))
  assert.equal(empty.sent.length, 0)

  const noPair = createWorker({ pair: null })
  await noPair.worker.runOnce(new Date('2026-09-29T06:01:00.000Z'))
  assert.equal(noPair.sent.length, 0)

  const delivered = createWorker({ settings: [{ ...baseSettings, deliveredDate: '2026-09-29' }] })
  await delivered.worker.runOnce(new Date('2026-09-29T06:01:00.000Z'))
  assert.equal(delivered.sent.length, 0)
})

test('reminder worker retries failures every 15 minutes up to three attempts per local day', async () => {
  const attempts: Date[] = []
  const harness = createWorker({ send: async () => { throw new Error('Telegram unavailable') } })
  const start = new Date('2026-09-29T06:01:00.000Z')

  for (const minutes of [0, 1, 15, 30, 45]) {
    const at = new Date(start.getTime() + minutes * 60_000)
    await harness.worker.runOnce(at)
    if (harness.users[0].lastAttemptAt === at.toISOString()) attempts.push(at)
  }

  assert.equal(harness.users[0].attemptCount, 3)
  assert.equal(attempts.length, 3)
  assert.equal(harness.errors.length, 3)
  assert.equal(harness.users[0].deliveredDate, null)
  await harness.worker.runOnce(new Date('2026-09-30T06:01:00.000Z'))
  assert.equal(harness.users[0].attemptCount, 1)
})

test('reminder worker does not overlap runs for one user', async () => {
  let resolveSend: (() => void) | undefined
  const harness = createWorker({ send: () => new Promise<void>((resolve) => { resolveSend = resolve }) })
  const now = new Date('2026-09-29T06:01:00.000Z')
  const first = harness.worker.runOnce(now)
  await new Promise((resolve) => setImmediate(resolve))
  await harness.worker.runOnce(now)
  assert.equal(harness.users[0].attemptCount, 1)
  resolveSend?.()
  await first
  assert.equal(harness.sent.length, 0)
})

test('reminder worker starts once and stop waits for pending delivery', async () => {
  let resolveSend: (() => void) | undefined
  let sends = 0
  const harness = createWorker({
    settings: [{ ...baseSettings, dailyReviewTime: '00:00' }],
    send: () => {
      sends++
      return new Promise<void>((resolve) => { resolveSend = resolve })
    },
  })
  harness.worker.start()
  harness.worker.start()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sends, 1)

  let stopped = false
  const stopping = harness.worker.stop().then(() => { stopped = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(stopped, false)
  resolveSend?.()
  await stopping
  assert.equal(stopped, true)
  await harness.worker.runOnce(new Date('2026-09-30T06:01:00.000Z'))
  assert.equal(sends, 1)
})
