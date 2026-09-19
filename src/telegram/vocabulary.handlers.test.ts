import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { Telegraf } from 'telegraf'
import type { LanguagePair } from '../languages/language-pair.types'
import type { VocabularyItem } from '../vocabulary/vocabulary.types'
import { renderDuplicate, renderVocabularyAdded } from './messages'
import { registerVocabularyHandlers } from './vocabulary.handlers'
import type { BotContext, BotDependencies } from './telegram.types'

type Handler = (ctx: BotContext, next?: () => Promise<void>) => Promise<void> | void

const user = { id: 'user-1', createdAt: '2026-09-18T00:00:00.000Z' }
const pair: LanguagePair = {
  id: 'pair-1', userId: user.id, sourceLanguage: 'en', targetLanguage: 'ru',
  isDefault: true, createdAt: '2026-09-18T00:00:00.000Z',
}
const item: VocabularyItem = {
  id: 'item-1', userId: user.id, languagePairId: pair.id, text: 'reliable',
  normalizedText: 'reliable', itemType: 'word', translations: ['надёжный'], examples: [],
  status: 'inbox', createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z',
}

function createHarness(options: {
  currentUser?: typeof user | null
  defaultPair?: LanguagePair | null
  addText?: () => Promise<{ item: VocabularyItem; duplicate: boolean }>
  inboxItems?: VocabularyItem[]
  inboxCount?: number
  startLearning?: () => number
} = {}) {
  const handlers = new Map<string, Handler[]>()
  const replies: Array<{ text: string; extra?: unknown }> = []
  let callbackAnswers = 0
  const loggerCalls: unknown[][] = []
  const dependencies = {
    userService: {
      findByTelegramUserId: () => options.currentUser === undefined ? user : options.currentUser,
    },
    languagePairService: { findDefaultForUser: () => options.defaultPair === undefined ? pair : options.defaultPair },
    vocabularyService: {
      addText: options.addText ?? (async () => ({ item, duplicate: false })),
      listForUser: () => options.inboxItems ?? [item],
      countByStatus: () => options.inboxCount ?? 1,
    },
    reviewService: { startLearning: options.startLearning ?? (() => 1) },
    logger: { error: (...args: unknown[]) => loggerCalls.push(args) },
  } as unknown as BotDependencies
  const bot = {
    command: (name: string, handler: Handler) => handlers.set(`command:${name}`, [handler]),
    on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  } as unknown as Telegraf<BotContext>
  registerVocabularyHandlers(bot, dependencies)

  const context = (message: string, data?: string): BotContext => ({
    from: { id: 42, first_name: 'Ada', is_bot: false },
    message: { text: message }, callbackQuery: data ? { data } : undefined,
    update: { update_id: 1 },
    reply: async (text: string, extra?: unknown) => { replies.push({ text, extra }) },
    answerCbQuery: async () => { callbackAnswers++ },
  } as unknown as BotContext)

  return {
    dependencies, handlers, replies, loggerCalls,
    context, callbackAnswers: () => callbackAnswers,
    text: async (message: string) => {
      for (const handler of handlers.get('text') ?? []) await handler(context(message))
    },
    inbox: async () => handlers.get('command:inbox')?.[0]?.(context('/inbox')),
    callback: async (data: string) => {
      for (const handler of handlers.get('callback_query') ?? []) {
        await handler(context('', data), async () => undefined)
      }
    },
  }
}

test('pure vocabulary responses include translation, inbox label, and duplicate text', () => {
  assert.match(renderVocabularyAdded(item), /reliable.*надёжный/s)
  assert.match(renderVocabularyAdded(item), /Added to Inbox/)
  assert.equal(renderDuplicate(item), 'reliable is already in your vocabulary.')
})

test('ordinary text captures vocabulary and ignores commands', async () => {
  let captured = ''
  const harness = createHarness({ addText: async () => {
    captured = 'reliable'
    return { item, duplicate: false }
  } })

  await harness.text('/inbox')
  await harness.text('reliable')

  assert.equal(captured, 'reliable')
  assert.equal(harness.replies.length, 1)
  assert.match(harness.replies[0].text, /Added to Inbox/)
})

test('capture requires existing user and default pair', async () => {
  const noUser = createHarness({ currentUser: null })
  await noUser.text('reliable')
  assert.deepEqual(noUser.replies.map(({ text }) => text), ['Please send /start first'])

  const noPair = createHarness({ defaultPair: null })
  await noPair.text('reliable')
  assert.deepEqual(noPair.replies.map(({ text }) => text), ['Choose your languages with /start first'])
})

test('provider failure is logged safely and rendered with retry copy', async () => {
  const harness = createHarness({ addText: async () => { throw new Error('provider secret') } })
  await harness.text('reliable')

  assert.equal(harness.replies[0].text, "I couldn't process this word right now.\nPlease try again later.")
  assert.equal(JSON.stringify(harness.loggerCalls).includes('provider secret'), false)
})

test('/inbox renders count, item text, and Learn all callback', async () => {
  const harness = createHarness({ inboxCount: 3 })
  await harness.inbox()

  assert.match(harness.replies[0].text, /Inbox: 3.*reliable/s)
  assert.match(JSON.stringify(harness.replies[0].extra), /Learn all/)
  assert.match(JSON.stringify(harness.replies[0].extra), /inbox:learn_all/)
})

test('/inbox passes newest-item ordering request to vocabulary service', async () => {
  let receivedFilters: unknown
  const harness = createHarness()
  harness.dependencies.vocabularyService.listForUser = (_userId: string, filters: unknown) => {
    receivedFilters = filters
    return [item]
  }

  await harness.inbox()

  assert.deepEqual(receivedFilters, { status: 'inbox', limit: 10 })
})

test('Learn all acknowledges callback and is idempotent through service result', async () => {
  let calls = 0
  const harness = createHarness({ startLearning: () => { calls++; return calls === 1 ? 2 : 0 } })
  await harness.callback('inbox:learn_all')
  await harness.callback('inbox:learn_all')

  assert.equal(calls, 2)
  assert.equal(harness.callbackAnswers(), 2)
  assert.match(harness.replies[0].text, /2/)
  assert.match(harness.replies[1].text, /0/)
})
