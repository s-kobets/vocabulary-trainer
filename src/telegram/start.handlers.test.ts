import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { Telegraf } from 'telegraf'
import type { LanguagePair } from '../languages/language-pair.types'
import type { BotContext, BotDependencies } from './telegram.types'
import { createBot } from './bot'
import { registerStartHandlers } from './start.handlers'

type Handler = (ctx: BotContext, next?: () => Promise<void>) => Promise<void> | void

const user = { id: 'user-1', createdAt: '2026-09-18T00:00:00.000Z' }
const pair: LanguagePair = {
  id: 'pair-1',
  userId: user.id,
  sourceLanguage: 'en',
  targetLanguage: 'ru',
  isDefault: true,
  createdAt: '2026-09-18T00:00:00.000Z',
}

function createHarness(defaultPair: LanguagePair | null = null) {
  let commandHandler: Handler | undefined
  let callbackHandler: Handler | undefined
  const replies: string[] = []
  let callbackAnswers = 0
  const createdPairs: string[][] = []

  const dependencies = {
    userService: {
      ensureFromTelegram: () => user,
      findByTelegramUserId: () => user,
    },
    languagePairService: {
      findDefaultForUser: () => defaultPair,
      createDefault: (_userId: string, source: string, target: string) => {
        createdPairs.push([source, target])
        return { ...pair, sourceLanguage: source, targetLanguage: target }
      },
    },
    vocabularyService: {},
    reviewService: {},
    logger: { error: () => undefined },
  } as unknown as BotDependencies

  const bot = {
    command: (_name: string, handler: Handler) => { commandHandler = handler },
    on: (_event: string, handler: Handler) => { callbackHandler = handler },
  } as unknown as Telegraf<BotContext>
  registerStartHandlers(bot, dependencies)

  function context(callbackQuery: Record<string, unknown>, session: BotContext['session'] = {}): BotContext {
    return {
      from: { id: 9007199254740993, first_name: 'Ada', is_bot: false },
      callbackQuery,
      session,
      update: { update_id: 1 },
      reply: async (text: string) => { replies.push(text) },
      answerCbQuery: async () => { callbackAnswers++ },
    } as unknown as BotContext
  }

  return {
    dependencies,
    command: commandHandler as Handler,
    callback: async (ctx: BotContext) => callbackHandler?.(ctx, async () => undefined),
    context,
    replies,
    get callbackAnswers() { return callbackAnswers },
    createdPairs,
  }
}

test('/start is idempotent when a default pair already exists', async () => {
  const harness = createHarness(pair)

  await harness.command(harness.context({}))
  await harness.command(harness.context({}))

  assert.equal(harness.replies.length, 2)
  assert.match(harness.replies[0], /en.*ru/)
  assert.equal(harness.createdPairs.length, 0)
})

test('valid onboarding creates a pair, clears session, and acknowledges callbacks', async () => {
  const harness = createHarness()
  const context = harness.context({})

  await harness.command(context)
  await harness.callback(harness.context({ data: 'onboarding:source:en' }, context.session))
  await harness.callback(harness.context({ data: 'onboarding:target:ru' }, context.session))

  assert.deepEqual(harness.createdPairs, [['en', 'ru']])
  assert.equal(context.session?.onboarding, undefined)
  assert.equal(harness.callbackAnswers, 2)
  assert.match(harness.replies.at(-1) ?? '', /en.*ru/)
})

test('invalid and equal-language onboarding selections do not create pairs', async () => {
  const harness = createHarness()
  const context = harness.context({})

  await harness.command(context)
  await harness.callback(harness.context({ data: 'onboarding:source:en' }, context.session))
  await harness.callback(harness.context({ data: 'onboarding:target:xx' }, context.session))
  await harness.callback(harness.context({ data: 'onboarding:target:en' }, context.session))

  assert.deepEqual(harness.createdPairs, [])
  assert.ok(harness.replies.includes('Unknown language'))
  assert.ok(harness.replies.includes('Choose two different languages'))
  assert.equal(harness.callbackAnswers, 3)
})

test('foreign and missing callback data are forwarded by onboarding middleware', async () => {
  const harness = createHarness()

  await harness.callback(harness.context({ id: 'callback-without-data' }))
  await harness.callback(harness.context({ data: 'vocabulary:learn' }))

  assert.equal(harness.callbackAnswers, 0)
})

test('bot error logging contains only safe metadata', async () => {
  const logs: unknown[][] = []
  const dependencies = createHarness(pair).dependencies
  dependencies.logger.error = (...args: unknown[]) => logs.push(args)
  const bot = createBot('bot-token', dependencies)
  const handleError = (bot as unknown as {
    handleError: (error: unknown, ctx: BotContext) => Promise<void>
  }).handleError
  const replies: string[] = []

  await handleError(
    new Error('bot-token session-secret private message text'),
    {
      update: { update_id: 42 },
      reply: async (text: string) => { replies.push(text) },
    } as unknown as BotContext,
  )

  assert.deepEqual(logs[0], [
    { updateId: 42, errorType: 'Error' },
    'Telegram update failed',
  ])
  assert.equal(JSON.stringify(logs).includes('private message text'), false)
  assert.deepEqual(replies, ['Something went wrong. Please try again.'])
})

test('composed bot forwards inbox callbacks past onboarding middleware', async () => {
  let startLearningCalls = 0
  let callbackAnswers = 0
  const dependencies = createHarness(pair).dependencies
  dependencies.vocabularyService = {
    listForUser: () => [],
    countByStatus: () => 0,
    addText: async () => { throw new Error('unused') },
  } as unknown as BotDependencies['vocabularyService']
  dependencies.reviewService = {
    startLearning: () => { startLearningCalls++; return 1 },
  } as unknown as BotDependencies['reviewService']
  const bot = createBot('bot-token', dependencies)
  ;(bot.telegram as unknown as { callApi: (method: string) => Promise<unknown> }).callApi = async () => ({})

  await bot.handleUpdate({
    update_id: 99,
    callback_query: {
      id: 'callback-1',
      from: { id: 42, is_bot: false, first_name: 'Ada' },
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 42, type: 'private', first_name: 'Ada' },
        text: 'Inbox: 1',
      },
      chat_instance: '42',
      data: `inbox:learn_all:${pair.id}`,
    },
  })

  assert.equal(startLearningCalls, 1)
})
