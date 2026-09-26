import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { Telegraf } from 'telegraf'
import type { LanguagePair } from '../languages/language-pair.types'
import type { BotContext, BotDependencies } from './telegram.types'
import { registerAccountHandlers } from './account.handlers'

type Handler = (ctx: BotContext) => Promise<void> | void

const user = { id: 'user-1', createdAt: '2026-09-18T00:00:00.000Z' }
const pair: LanguagePair = {
  id: 'pair-1', userId: user.id, sourceLanguage: 'en', targetLanguage: 'ru',
  isDefault: true, createdAt: '2026-09-18T00:00:00.000Z',
}

function createHarness(currentUser: typeof user | null, currentPair: LanguagePair | null) {
  const commands = new Map<string, Handler>()
  const replies: string[] = []
  const countCalls: unknown[][] = []
  const dependencies = {
    userService: { findByTelegramUserId: () => currentUser },
    languagePairService: { findDefaultForUser: () => currentPair },
    vocabularyService: { countByStatus: (...args: unknown[]) => {
      countCalls.push(args)
      return ({ inbox: 2, learning: 3, known: 4 }[args[1] as 'inbox' | 'learning' | 'known'])
    } },
    reviewService: {},
    logger: { error: () => undefined },
  } as unknown as BotDependencies
  const bot = {
    command: (name: string, handler: Handler) => { commands.set(name, handler) },
  } as unknown as Telegraf<BotContext>
  registerAccountHandlers(bot, dependencies)

  return {
    command: (name: string) => commands.get(name)!,
    context: { from: { id: 42 }, reply: async (text: string) => { replies.push(text) } } as unknown as BotContext,
    replies, countCalls,
  }
}

test('/help lists the available commands', async () => {
  const harness = createHarness(user, pair)

  await harness.command('help')(harness.context)

  assert.match(harness.replies[0], /\/start.*\/languages.*\/status.*\/inbox.*\/review/s)
})

test('/status handles missing users and missing active pairs', async () => {
  const missingUser = createHarness(null, null)
  await missingUser.command('status')(missingUser.context)
  assert.equal(missingUser.replies[0], 'Please send /start first')

  const missingPair = createHarness(user, null)
  await missingPair.command('status')(missingPair.context)
  assert.equal(missingPair.replies[0], 'Choose a language pair with /languages first')
})

test('/status reports the active pair and all vocabulary counts', async () => {
  const harness = createHarness(user, pair)

  await harness.command('status')(harness.context)

  assert.match(harness.replies[0], /English.*Russian/s)
  assert.match(harness.replies[0], /Inbox: 2.*Learning: 3.*Known: 4/s)
  assert.deepEqual(harness.countCalls, [
    [user.id, 'inbox', pair.id],
    [user.id, 'learning', pair.id],
    [user.id, 'known', pair.id],
  ])
})
