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
  addText?: (userId: string, pair: LanguagePair, text: string) => Promise<{ item: VocabularyItem; duplicate: boolean }>
  inboxItems?: VocabularyItem[]
  inboxCount?: number
  learningItems?: VocabularyItem[]
  learningCount?: number
  startLearning?: (...args: unknown[]) => number
  deleteText?: (userId: string, pairId: string, text: string) => boolean
  activePair?: LanguagePair | null
  findByText?: (userId: string, pairId: string, text: string) => VocabularyItem | null
  findForUser?: (userId: string, itemId: string) => VocabularyItem | null
  replaceTranslations?: (userId: string, itemId: string, translations: string[]) => VocabularyItem | null
  failTelegramEdit?: boolean
} = {}) {
  const handlers = new Map<string, Handler[]>()
  const replies: Array<{ text: string; extra?: unknown }> = []
  const telegramEdits: unknown[][] = []
  let callbackAnswers = 0
  const loggerCalls: unknown[][] = []
  const listFilters: Array<{ status?: string; languagePairId?: string; limit?: number } | undefined> = []
  const countCalls: unknown[][] = []
  const learningCalls: unknown[][] = []
  const dependencies = {
    userService: {
      findByTelegramUserId: () => options.currentUser === undefined ? user : options.currentUser,
    },
    languagePairService: { findDefaultForUser: () => options.activePair === undefined ? options.defaultPair === undefined ? pair : options.defaultPair : options.activePair },
    vocabularyService: {
      addText: options.addText ?? (async () => ({ item, duplicate: false })),
      listForUser: (_userId: string, filters?: { status?: string; languagePairId?: string; limit?: number }) => {
        listFilters.push(filters)
        return filters?.status === 'learning' ? options.learningItems ?? [item] : options.inboxItems ?? [item]
      },
      countByStatus: (...args: unknown[]) => {
        countCalls.push(args)
        const status = args[1]
        return status === 'learning' ? options.learningCount ?? 1 : options.inboxCount ?? 1
      },
      deleteText: options.deleteText ?? (() => false),
      delete: () => false,
      findByText: options.findByText ?? ((_userId, _pairId, text) => text === item.normalizedText ? item : null),
      findForUser: options.findForUser ?? ((_userId, itemId) => itemId === item.id ? item : null),
      replaceTranslations: options.replaceTranslations ?? ((_userId, _itemId, translations) => ({ ...item, translations })),
    },
    reviewService: { startLearning: (...args: unknown[]) => {
      learningCalls.push(args)
      return options.startLearning?.(...args) ?? 1
    } },
    logger: { error: (...args: unknown[]) => loggerCalls.push(args) },
  } as unknown as BotDependencies
  const bot = {
    command: (name: string, handler: Handler) => handlers.set(`command:${name}`, [handler]),
    on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  } as unknown as Telegraf<BotContext>
  registerVocabularyHandlers(bot, dependencies)

  const context = (message: string, data?: string, session: BotContext['session'] = {}): BotContext => ({
    from: { id: 42, first_name: 'Ada', is_bot: false },
    message: { text: message }, callbackQuery: data ? { data } : undefined,
    session,
    update: { update_id: 1 },
    reply: async (text: string, extra?: unknown) => { replies.push({ text, extra }) },
    telegram: { editMessageText: async (...args: unknown[]) => {
      telegramEdits.push(args)
      if (options.failTelegramEdit) throw new Error('message unavailable')
    } },
    answerCbQuery: async () => { callbackAnswers++ },
  } as unknown as BotContext)

  return {
    dependencies, handlers, replies, telegramEdits, loggerCalls, listFilters, countCalls, learningCalls,
    context, callbackAnswers: () => callbackAnswers,
    text: async (message: string, session: BotContext['session'] = {}) => {
      for (const handler of handlers.get('text') ?? []) await handler(context(message, undefined, session), async () => undefined)
    },
    edit: async (message: string, session: BotContext['session'] = {}) => {
      const ctx = context(message, undefined, session)
      await handlers.get('command:edit')?.[0]?.(ctx)
      return ctx
    },
    inbox: async () => handlers.get('command:inbox')?.[0]?.(context('/inbox')),
    learning: async () => handlers.get('command:learning')?.[0]?.(context('/learning')),
    delete: async (message: string, session: BotContext['session'] = {}) => {
      const ctx = context(message)
      ctx.session = session
      await handlers.get('command:delete')?.[0]?.(ctx)
      return ctx
    },
  callback: async (data: string, session: BotContext['session'] = {}) => {
    for (const handler of handlers.get('callback_query') ?? []) {
        const ctx = context('', data)
        ctx.session = session
        await handler(ctx, async () => undefined)
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

test('text middleware forwards slash commands to later command handlers', async () => {
  const harness = createHarness()
  let forwarded = false
  const handler = harness.handlers.get('text')?.[0]

  await handler?.(harness.context('/help'), async () => { forwarded = true })

  assert.equal(forwarded, true)
  assert.equal(harness.replies.length, 0)
})

test('/edit finds a word in the active pair and asks for replacement translations', async () => {
  const session: BotContext['session'] = {}
  const harness = createHarness()

  await harness.edit('/edit reliable', session)

  assert.deepEqual(session.pendingTranslationEdit, {
    userId: user.id,
    vocabularyItemId: item.id,
    languagePairId: pair.id,
  })
  assert.match(harness.replies.at(-1)?.text ?? '', /send.*translation/i)
})

test('/edit rejects missing or unknown words without creating pending state', async () => {
  const noWord = createHarness()
  const noWordSession: BotContext['session'] = {}
  await noWord.edit('/edit', noWordSession)
  assert.equal(noWordSession.pendingTranslationEdit, undefined)
  assert.match(noWord.replies.at(-1)?.text ?? '', /provide.*word/i)

  const unknown = createHarness({ findByText: () => null })
  const unknownSession: BotContext['session'] = {}
  await unknown.edit('/edit absent', unknownSession)
  assert.equal(unknownSession.pendingTranslationEdit, undefined)
  assert.match(unknown.replies.at(-1)?.text ?? '', /not found/i)
})

test('/edit rejects a lookup result outside the active pair', async () => {
  const harness = createHarness({ findByText: () => ({ ...item, languagePairId: 'other-pair' }) })
  const session: BotContext['session'] = {}

  await harness.edit('/edit reliable', session)

  assert.equal(session.pendingTranslationEdit, undefined)
  assert.match(harness.replies.at(-1)?.text ?? '', /not found/i)
})

test('pending translation input trims, removes blanks and exact duplicates, and replaces translations', async () => {
  const saved: string[][] = []
  const harness = createHarness({
    replaceTranslations: (_userId, _itemId, translations) => {
      saved.push(translations)
      return { ...item, translations }
    },
  })
  const session: BotContext['session'] = {
    pendingTranslationEdit: { userId: user.id, vocabularyItemId: item.id, languagePairId: pair.id },
  }

  await harness.text(' примерный \n\nприблизительный\nпримерный ', session)

  assert.deepEqual(saved, [['примерный', 'приблизительный']])
  assert.equal(session.pendingTranslationEdit, undefined)
  assert.match(harness.replies.at(-1)?.text ?? '', /reliable.*примерный.*приблизительный/s)
})

test('review-originated edit restores the updated answer card and preserves review progress', async () => {
  const harness = createHarness()
  const review = { itemIds: ['item-1', 'item-2'], index: 0, revealed: true }
  const session: BotContext['session'] = {
    review,
    pendingTranslationEdit: {
      userId: user.id,
      vocabularyItemId: item.id,
      languagePairId: pair.id,
      reviewMessage: { chatId: 88, messageId: 77 },
    },
  }

  await harness.text('примерный\nприблизительный', session)

  assert.deepEqual(session.review, review)
  assert.equal(session.pendingTranslationEdit, undefined)
  assert.deepEqual(harness.telegramEdits[0].slice(0, 3), [88, 77, undefined])
  assert.match(String(harness.telegramEdits[0][3]), /reliable.*примерный.*приблизительный/s)
  assert.match(JSON.stringify(harness.telegramEdits[0][4]), /review:correct:item-1.*review:edit:item-1/s)
  assert.equal(harness.replies.length, 0)
})

test('review card refresh failure keeps saved translations and reports success', async () => {
  const harness = createHarness({ failTelegramEdit: true })
  const session: BotContext['session'] = {
    review: { itemIds: ['item-1'], index: 0, revealed: true },
    pendingTranslationEdit: {
      userId: user.id,
      vocabularyItemId: item.id,
      languagePairId: pair.id,
      reviewMessage: { chatId: 88, messageId: 77 },
    },
  }

  await harness.text('примерный', session)

  assert.equal(session.review?.index, 0)
  assert.equal(session.pendingTranslationEdit, undefined)
  assert.match(harness.replies.at(-1)?.text ?? '', /Updated translations.*примерный/s)
})

test('blank pending translation input is rejected and keeps the edit pending', async () => {
  const harness = createHarness()
  const session: BotContext['session'] = {
    pendingTranslationEdit: { userId: user.id, vocabularyItemId: item.id, languagePairId: pair.id },
  }

  await harness.text(' \n  \n', session)

  assert.ok(session.pendingTranslationEdit)
  assert.match(harness.replies.at(-1)?.text ?? '', /at least one translation/i)
})

test('stale pending edit expires without importing the submitted translation', async () => {
  let addCalls = 0
  const harness = createHarness({ addText: async () => { addCalls++; return { item, duplicate: false } } })
  const session: BotContext['session'] = {
    pendingTranslationEdit: { userId: user.id, vocabularyItemId: item.id, languagePairId: 'old-pair' },
  }

  await harness.text('примерный', session)

  assert.equal(addCalls, 0)
  assert.equal(session.pendingTranslationEdit, undefined)
  assert.match(harness.replies.at(-1)?.text ?? '', /edit.*expired/i)
})

test('pending edit expires when the user, active pair, or target item is unavailable', async () => {
  const cases = [
    { options: { currentUser: null } },
    { options: { activePair: null } },
    { options: { findForUser: () => null } },
  ]

  for (const { options } of cases) {
    let addCalls = 0
    const harness = createHarness({ ...options, addText: async () => { addCalls++; return { item, duplicate: false } } })
    const session: BotContext['session'] = {
      pendingTranslationEdit: { userId: user.id, vocabularyItemId: item.id, languagePairId: pair.id },
    }
    await harness.text('примерный', session)
    assert.equal(addCalls, 0)
    assert.equal(session.pendingTranslationEdit, undefined)
    assert.match(harness.replies.at(-1)?.text ?? '', /edit.*expired/i)
  }
})

test('any new /edit request replaces or clears the previous pending target', async () => {
  const existing: NonNullable<BotContext['session']>['pendingTranslationEdit'] = {
    userId: user.id, vocabularyItemId: 'old-item', languagePairId: pair.id,
  }
  const session: BotContext['session'] = { pendingTranslationEdit: existing }
  const harness = createHarness({ findByText: (_userId, _pairId, text) => text === item.normalizedText ? item : null })

  await harness.edit('/edit missing', session)
  assert.equal(session.pendingTranslationEdit, undefined)

  await harness.edit('/edit reliable', session)
  assert.deepEqual(session.pendingTranslationEdit, {
    userId: user.id, vocabularyItemId: item.id, languagePairId: pair.id,
  })
})

test('commands are forwarded without consuming a pending translation edit', async () => {
  const harness = createHarness()
  const session: BotContext['session'] = {
    pendingTranslationEdit: { userId: user.id, vocabularyItemId: item.id, languagePairId: pair.id },
  }
  let forwarded = false

  const handler = harness.handlers.get('text')?.[0]
  await handler?.(harness.context('/status', undefined, session), async () => { forwarded = true })

  assert.equal(forwarded, true)
  assert.ok(session.pendingTranslationEdit)
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
  assert.match(JSON.stringify(harness.replies[0].extra), new RegExp(`inbox:learn_all:${pair.id}`))
  assert.doesNotMatch(JSON.stringify(harness.replies[0].extra), /vocabulary:delete:item:/)
})

test('/inbox passes newest-item ordering request to vocabulary service', async () => {
  let receivedFilters: unknown
  const harness = createHarness()
  harness.dependencies.vocabularyService.listForUser = (_userId: string, filters: unknown) => {
    receivedFilters = filters
    return [item]
  }

  await harness.inbox()

  assert.deepEqual(receivedFilters, { status: 'inbox', languagePairId: pair.id, limit: 10 })
})

test('/inbox lists and counts only the active language pair', async () => {
  const harness = createHarness()

  await harness.inbox()

  assert.deepEqual(harness.listFilters[0], { status: 'inbox', languagePairId: pair.id, limit: 10 })
  assert.deepEqual(harness.countCalls[0], [user.id, 'inbox', pair.id])
  assert.match(JSON.stringify(harness.replies[0].extra), new RegExp(`inbox:learn_all:${pair.id}`))
})

test('/learning counts only the active language pair', async () => {
  const harness = createHarness()

  await harness.learning()

  assert.deepEqual(harness.listFilters[0], { status: 'learning', languagePairId: pair.id, limit: 10 })
  assert.deepEqual(harness.countCalls[0], [user.id, 'learning', pair.id])
})

test('Learn all acknowledges callback and is idempotent through service result', async () => {
  let calls = 0
  const harness = createHarness({ startLearning: () => { calls++; return calls === 1 ? 2 : 0 } })
  await harness.callback(`inbox:learn_all:${pair.id}`)
  await harness.callback(`inbox:learn_all:${pair.id}`)

  assert.equal(calls, 2)
  assert.equal(harness.callbackAnswers(), 2)
  assert.match(harness.replies[0].text, /2/)
  assert.match(harness.replies[1].text, /0/)
  assert.deepEqual(harness.learningCalls, [[user.id, pair.id, harness.learningCalls[0][2]], [user.id, pair.id, harness.learningCalls[1][2]]])
})

test('stale Learn all callback is rejected after switching active pairs', async () => {
  const otherPair = { ...pair, id: 'pair-2', sourceLanguage: 'de' }
  const harness = createHarness({ activePair: otherPair })

  await harness.callback(`inbox:learn_all:${pair.id}`)

  assert.deepEqual(harness.learningCalls, [])
  assert.equal(harness.replies[0].text, 'This request expired. Please open /inbox again.')
  assert.equal(harness.callbackAnswers(), 1)
})

test('legacy Learn all callback is rejected without a pair ID', async () => {
  const harness = createHarness()

  await harness.callback('inbox:learn_all')

  assert.deepEqual(harness.learningCalls, [])
  assert.equal(harness.replies[0].text, 'This request expired. Please open /inbox again.')
  assert.equal(harness.callbackAnswers(), 1)
})

test('callback middleware forwards callbacks owned by other handlers', async () => {
  const harness = createHarness()
  let forwarded = false
  const handler = harness.handlers.get('callback_query')?.[0]

  await handler?.(harness.context('', 'languages:add'), async () => { forwarded = true })

  assert.equal(forwarded, true)
  assert.equal(harness.callbackAnswers(), 1)
})

test('bulk text trims lines, skips blanks, and reports added and duplicate counts', async () => {
  const received: string[] = []
  const harness = createHarness({
    addText: async (_userId: string, _pair: LanguagePair, text: string) => {
      received.push(text)
      return { item, duplicate: text === 'waste' }
    },
  })

  await harness.text(' approximate \n\nbesties\n waste \n')

  assert.deepEqual(received, ['approximate', 'besties', 'waste'])
  assert.match(harness.replies[0].text, /Added: 2.*Duplicates: 1.*Failed: 0/s)
})

test('/learning lists active-pair learning words with a review button', async () => {
  const learningItems = Array.from({ length: 10 }, (_, index) => ({ ...item, id: `learning-${index}`, text: `word-${index}` }))
  const harness = createHarness({ learningItems, learningCount: 12 })

  const handlers = harness.handlers.get('command:learning')
  await handlers?.[0]?.(harness.context('/learning'))

  assert.match(harness.replies.at(-1)?.text ?? '', /Learning: 12.*word-0.*word-9/s)
  assert.match(JSON.stringify(harness.replies.at(-1)?.extra), /review:start_due/)
})

test('/learning reports an empty list without a review button', async () => {
  const harness = createHarness({ learningItems: [], learningCount: 0 })

  await harness.handlers.get('command:learning')?.[0]?.(harness.context('/learning'))

  assert.equal(harness.replies.at(-1)?.text, 'Learning list is empty')
  assert.equal(harness.replies.at(-1)?.extra, undefined)
})

test('bulk text continues after item failure and reports failed count', async () => {
  const received: string[] = []
  const harness = createHarness({
    addText: async (_userId: string, _pair: LanguagePair, text: string) => {
      received.push(text)
      if (text === 'waste') throw new Error('provider secret')
      return { item, duplicate: false }
    },
  })

  await harness.text('filled\nwaste\nexceeded')

  assert.deepEqual(received, ['filled', 'waste', 'exceeded'])
  assert.match(harness.replies[0].text, /Added: 2.*Duplicates: 0.*Failed: 1/s)
  assert.equal(JSON.stringify(harness.loggerCalls).includes('provider secret'), false)
})

test('all-empty bulk text is rejected without calling vocabulary service', async () => {
  let calls = 0
  const harness = createHarness({
    addText: async () => { calls++; return { item, duplicate: false } },
  })

  await harness.text(' \n\n  ')

  assert.equal(calls, 0)
  assert.equal(harness.replies[0].text, 'Please provide at least one word or phrase')
})

test('/delete removes one normalized word immediately', async () => {
  const deleted: string[] = []
  const harness = createHarness({
    deleteText: (_userId, _pairId, text) => { deleted.push(text); return true },
  })

  await harness.delete('/delete  Reliable  ')

  assert.deepEqual(deleted, ['reliable'])
  assert.match(harness.replies.at(-1)?.text ?? '', /Deleted: 1.*Not found: 0/s)
})

test('/delete requests confirmation for unique multiline words and confirms them', async () => {
  const deleted: string[] = []
  const harness = createHarness({
    deleteText: (_userId, _pairId, text) => { deleted.push(text); return text === 'reliable' },
  })
  const session: BotContext['session'] = {}

  await harness.delete('/delete\n Reliable \n\nreliable\nmissing', session)
  assert.deepEqual(deleted, [])
  assert.equal(session.pendingDelete?.words.length, 2)
  assert.match(harness.replies.at(-1)?.text ?? '', /Delete 2 matching words\?/)

  await harness.callback('vocabulary:delete:confirm', session)

  assert.deepEqual(deleted, ['reliable', 'missing'])
  assert.equal(session.pendingDelete, undefined)
  assert.match(harness.replies.at(-1)?.text ?? '', /Deleted: 1.*Not found: 1/s)
})

test('bulk delete cancel clears pending state without deleting', async () => {
  let calls = 0
  const harness = createHarness({ deleteText: () => { calls++; return true } })
  const session: BotContext['session'] = {}

  await harness.delete('/delete\nfirst\nsecond', session)
  await harness.callback('vocabulary:delete:cancel', session)

  assert.equal(calls, 0)
  assert.equal(session.pendingDelete, undefined)
  assert.equal(harness.replies.at(-1)?.text, 'Delete cancelled')
})
