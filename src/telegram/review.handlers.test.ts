import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { Telegraf } from 'telegraf'
import type { DueReview } from '../reviews/review.types'
import type { LanguagePair } from '../languages/language-pair.types'
import type { VocabularyItem } from '../vocabulary/vocabulary.types'
import { registerReviewHandlers } from './review.handlers'
import { registerStartHandlers } from './start.handlers'
import { registerVocabularyHandlers } from './vocabulary.handlers'
import type { BotContext, BotDependencies } from './telegram.types'

type Handler = (ctx: BotContext, next?: () => Promise<void>) => Promise<void> | void

const user = { id: 'user-1', createdAt: '2026-09-18T00:00:00.000Z' }
const pair: LanguagePair = {
  id: 'pair-1', userId: user.id, sourceLanguage: 'en', targetLanguage: 'ru',
  isDefault: true, createdAt: '2026-09-18T00:00:00.000Z',
}
const item = (id: string, text: string): VocabularyItem => ({
  id, userId: user.id, languagePairId: pair.id, text, normalizedText: text,
  itemType: 'word', translations: [`${text}-translation`], examples: [], status: 'learning',
  createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z',
})
const review = (vocabularyItem: VocabularyItem): DueReview => ({
  item: vocabularyItem,
  state: {
    id: `state-${vocabularyItem.id}`, userId: user.id, vocabularyItemId: vocabularyItem.id,
    level: 0, nextReviewAt: '2026-09-18T00:00:00.000Z',
    createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z',
  },
})

function createHarness(options: {
  due?: DueReview[]
  currentUser?: typeof user | null
  items?: Record<string, VocabularyItem | null>
} = {}) {
  const handlers = new Map<string, Handler[]>()
  const replies: Array<{ text: string; extra?: unknown }> = []
  const edits: Array<{ text: string; extra?: unknown }> = []
  const answers: string[] = []
  const answerCalls: Array<{ userId: string; itemId: string; result: string }> = []
  const dependencies = {
    userService: {
      findByTelegramUserId: () => options.currentUser === undefined ? user : options.currentUser,
    },
    vocabularyService: {
      findForUser: (userId: string, itemId: string) => {
        if (userId !== user.id) return null
        if (options.items && Object.hasOwn(options.items, itemId)) return options.items[itemId]
        return itemId === 'item-1' ? item(itemId, 'reliable') : item(itemId, 'steady')
      },
    },
    reviewService: {
      getDue: () => options.due ?? [review(item('item-1', 'reliable')), review(item('item-2', 'steady'))],
      answer: (userId: string, itemId: string, result: string) => {
        answerCalls.push({ userId, itemId, result })
      },
    },
    logger: { error: () => undefined },
  } as unknown as BotDependencies
  const bot = {
    command: (name: string, handler: Handler) => handlers.set(`command:${name}`, [handler]),
    on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  } as unknown as Telegraf<BotContext>
  registerReviewHandlers(bot, dependencies)

  const context = (data?: string, session: BotContext['session'] = {}): BotContext => ({
    from: { id: 42, first_name: 'Ada', is_bot: false },
    callbackQuery: data ? { data } : undefined,
    session,
    update: { update_id: 1 },
    reply: async (text: string, extra?: unknown) => { replies.push({ text, extra }) },
    editMessageText: async (text: string, extra?: unknown) => { edits.push({ text, extra }) },
    answerCbQuery: async (text?: string) => { answers.push(text ?? '') },
  } as unknown as BotContext)

  return {
    dependencies, handlers, replies, edits, answers, answerCalls, context,
    review: async (ctx: BotContext) => handlers.get('command:review')?.[0]?.(ctx),
    callback: async (data: string, session: BotContext['session']) => {
      for (const handler of handlers.get('callback_query') ?? []) await handler(context(data, session), async () => undefined)
    },
  }
}

test('/review creates an in-memory session and renders first source card', async () => {
  const harness = createHarness()
  const context = harness.context()

  await harness.review(context)

  assert.deepEqual(context.session?.review, { itemIds: ['item-1', 'item-2'], index: 0, revealed: false })
  assert.match(harness.replies[0].text, /1 \/ 2.*reliable/s)
  assert.match(JSON.stringify(harness.replies[0].extra), /review:show:item-1/)
})

test('/review reports when no due cards exist', async () => {
  const harness = createHarness({ due: [] })

  await harness.review(harness.context())

  assert.deepEqual(harness.replies.map(({ text }) => text), ['Nothing to review right now'])
})

test('show callback uses current session item, reveals it, and acknowledges callback', async () => {
  const harness = createHarness()
  const context = harness.context(undefined, { review: { itemIds: ['item-1', 'item-2'], index: 0, revealed: false } })

  await harness.callback('review:show:item-1', context.session)

  assert.equal(context.session?.review?.revealed, true)
  assert.match(harness.edits[0].text, /reliable.*reliable-translation/s)
  assert.match(JSON.stringify(harness.edits[0].extra), /review:incorrect:item-1.*review:correct:item-1/s)
  assert.equal(harness.answers.length, 1)
})

test('stale show callback clears session and reports expiration', async () => {
  const harness = createHarness({ items: { 'item-1': null } })
  const session = { review: { itemIds: ['item-1'], index: 0, revealed: false } }

  await harness.callback('review:show:item-1', session)

  assert.equal(session.review, undefined)
  assert.equal(harness.replies[0].text, 'Review session expired. Send /review to start again.')
  assert.equal(harness.answers.length, 1)
})

test('mismatched callback item is rejected and acknowledged once', async () => {
  const harness = createHarness()
  const session = { review: { itemIds: ['item-1', 'item-2'], index: 0, revealed: true } }

  await harness.callback('review:correct:item-2', session)

  assert.deepEqual(harness.answerCalls, [])
  assert.equal(session.review, undefined)
  assert.equal(harness.replies[0].text, 'Review session expired. Send /review to start again.')
  assert.equal(harness.answers.length, 1)
})

test('last answer clears session and reports reviewed count', async () => {
  const harness = createHarness()
  const session = { review: { itemIds: ['item-1'], index: 0, revealed: true } }

  await harness.callback('review:incorrect:item-1', session)

  assert.deepEqual(harness.answerCalls, [{ userId: 'user-1', itemId: 'item-1', result: 'incorrect' }])
  assert.equal(session.review, undefined)
  assert.equal(harness.replies[0].text, 'Review complete. Reviewed 1 item.')
  assert.equal(harness.answers.length, 1)
})

test('callbacks without session are acknowledged and expire safely', async () => {
  const harness = createHarness()

  await harness.callback('review:correct:item-1', {})

  assert.equal(harness.replies[0].text, 'Review session expired. Send /review to start again.')
  assert.equal(harness.answers.length, 1)
  assert.equal(harness.answerCalls.length, 0)
})

test('review handler ignores another user item and clears session', async () => {
  const harness = createHarness({ items: { 'item-1': { ...item('item-1', 'private'), userId: 'other-user' } } })
  const session = { review: { itemIds: ['item-1'], index: 0, revealed: true } }

  await harness.callback('review:correct:item-1', session)

  assert.equal(session.review, undefined)
  assert.equal(harness.answerCalls.length, 0)
  assert.equal(harness.replies[0].text, 'Review session expired. Send /review to start again.')
})

test('composed callback routing acknowledges each update exactly once', async () => {
  const handlers: Handler[] = []
  const edits: string[] = []
  const dependencies = {
    userService: {
      ensureFromTelegram: () => user,
      findByTelegramUserId: () => user,
    },
    languagePairService: {
      findDefaultForUser: () => pair,
      createDefault: () => pair,
    },
    vocabularyService: {
      findForUser: () => item('item-1', 'reliable'),
      startLearning: () => undefined,
    },
    reviewService: {
      getDue: () => [review(item('item-1', 'reliable'))],
      answer: () => undefined,
      startLearning: () => 1,
    },
    logger: { error: () => undefined },
  } as unknown as BotDependencies
  const bot = {
    command: () => undefined,
    on: (event: string, handler: Handler) => {
      if (event === 'callback_query') handlers.push(handler)
    },
  } as unknown as Telegraf<BotContext>
  registerStartHandlers(bot, dependencies)
  registerReviewHandlers(bot, dependencies)
  registerVocabularyHandlers(bot, dependencies)

  const callback = async (data: string | undefined, session: BotContext['session'] = {}) => {
    let answers = 0
    let index = 0
    const ctx = {
      from: { id: 42, first_name: 'Ada', is_bot: false },
      callbackQuery: data === undefined ? { id: 'callback-1' } : { id: 'callback-1', data },
      session,
      update: { update_id: 1 },
      reply: async () => undefined,
      editMessageText: async (text: string) => { edits.push(text) },
      answerCbQuery: async () => { answers++ },
    } as unknown as BotContext
    const next = async (): Promise<void> => {
      const handler = handlers[index++]
      if (handler) await handler(ctx, next)
    }
    await next()
    return answers
  }

  assert.equal(await callback('onboarding:source:en'), 1)
  assert.equal(await callback('review:show:item-1', { review: { itemIds: ['item-1'], index: 0, revealed: false } }), 1)
  assert.equal(await callback('inbox:learn_all'), 1)
  assert.equal(await callback('unknown:callback'), 1)
  assert.equal(await callback(undefined), 1)
  assert.equal(edits.length, 1)
})
