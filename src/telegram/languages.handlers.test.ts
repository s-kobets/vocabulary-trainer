import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { Telegraf } from 'telegraf'
import type { LanguagePair } from '../languages/language-pair.types'
import type { BotContext, BotDependencies } from './telegram.types'
import { registerLanguageHandlers } from './languages.handlers'

type Handler = (ctx: BotContext, next?: () => Promise<void>) => Promise<void> | void

const user = { id: 'user-1', createdAt: '2026-09-18T00:00:00.000Z' }
const pair: LanguagePair = {
  id: 'pair-1', userId: user.id, sourceLanguage: 'en', targetLanguage: 'ru',
  isDefault: true, createdAt: '2026-09-18T00:00:00.000Z',
}

function createHarness(pairs: LanguagePair[] = []) {
  let commandHandler: Handler | undefined
  let callbackHandler: Handler | undefined
  const replies: string[] = []
  const keyboards: unknown[] = []
  const selected: string[] = []
  const created: string[][] = []
  const deleted: string[] = []
  let callbackAnswers = 0
  const dependencies = {
    userService: { findByTelegramUserId: () => user },
    languagePairService: {
      listForUser: () => pairs,
      selectForUser: (_userId: string, pairId: string) => {
        const found = pairs.find((candidate) => candidate.id === pairId)
        if (!found) throw new Error('does not belong to user')
        selected.push(pairId)
        return { ...found, isDefault: true }
      },
      createDefault: (_userId: string, source: string, target: string) => {
        created.push([source, target])
        return { ...pair, sourceLanguage: source, targetLanguage: target }
      },
      deleteForUser: (_userId: string, pairId: string) => {
        deleted.push(pairId)
        return 'deleted' as const
      },
    },
    vocabularyService: {}, reviewService: {}, logger: { error: () => undefined },
  } as unknown as BotDependencies
  const bot = {
    command: (_name: string, handler: Handler) => { commandHandler = handler },
    on: (_event: string, handler: Handler) => { callbackHandler = handler },
  } as unknown as Telegraf<BotContext>
  registerLanguageHandlers(bot, dependencies)

  function context(data: string, session: BotContext['session'] = {}): BotContext {
    return {
      from: { id: 42 }, callbackQuery: { data }, session,
      reply: async (text: string, options?: unknown) => { replies.push(text); keyboards.push(options) },
      answerCbQuery: async () => { callbackAnswers++ },
    } as unknown as BotContext
  }

  return {
    command: commandHandler as Handler,
    callback: (ctx: BotContext) => callbackHandler!(ctx, async () => undefined),
    context, replies, keyboards, selected, created, deleted,
    get callbackAnswers() { return callbackAnswers },
  }
}

test('/languages shows existing pairs and the add action', async () => {
  const harness = createHarness([pair])

  await harness.command(harness.context(''))

  assert.match(harness.replies[0], /English.*Russian.*active/s)
  assert.match(JSON.stringify(harness.keyboards[0]), /languages:add/)
})

test('language callbacks select, add, and create pairs', async () => {
  const harness = createHarness([pair])
  const session = {}

  await harness.callback(harness.context('languages:select:pair-1', session))
  await harness.callback(harness.context('languages:add', session))
  await harness.callback(harness.context('languages:source:en', session))
  await harness.callback(harness.context('languages:target:de', session))

  assert.deepEqual(harness.selected, ['pair-1'])
  assert.deepEqual(harness.created, [['en', 'de']])
  assert.equal(harness.callbackAnswers, 4)
})

test('language callbacks reject equal or unknown languages and protect deletion errors', async () => {
  const harness = createHarness([pair])
  const session = {}

  await harness.callback(harness.context('languages:add', session))
  await harness.callback(harness.context('languages:source:en', session))
  await harness.callback(harness.context('languages:target:en', session))
  await harness.callback(harness.context('languages:target:xx', session))

  assert.deepEqual(harness.created, [])
  assert.ok(harness.replies.includes('Choose two different languages'))
  assert.ok(harness.replies.includes('Unknown language'))
})

test('language deletion refreshes the pair list and forwards foreign callbacks', async () => {
  const harness = createHarness([pair])
  let forwarded = false

  await harness.callback({
    ...harness.context('inbox:learn_all'),
  } as BotContext)
  await (async () => {
    const context = harness.context('other:data')
    const original = context.reply
    context.reply = (async () => { forwarded = true; await original('unused'); return {} }) as unknown as typeof context.reply
    await harness.callback(context)
  })()
  await harness.callback(harness.context('languages:delete:pair-1'))

  assert.equal(forwarded, false)
  assert.deepEqual(harness.deleted, ['pair-1'])
  assert.equal(harness.callbackAnswers, 1)
})
