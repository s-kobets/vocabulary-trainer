import { Markup, type Telegraf } from 'telegraf'
import { getCurrentUser } from './context'
import { normalizeText } from '../vocabulary/normalize'
import {
  renderBulkImportSummary,
  renderDeleteConfirmation,
  renderDeleteSummary,
  renderDuplicate,
  renderInbox,
  renderLearning,
  renderReviewAnswer,
  renderVocabularyAdded,
  renderVocabularyPending,
} from './messages'
import type { BotContext, BotDependencies } from './telegram.types'

const providerFailureMessage = "I couldn't process this word right now.\nPlease try again later."

export function registerVocabularyHandlers(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.on('text', async (ctx, next) => {
    const text = ctx.message.text
    if (text.startsWith('/')) {
      await next()
      return
    }

    const pendingEdit = ctx.session?.pendingTranslationEdit
    if (pendingEdit) {
      const user = getCurrentUser(ctx, dependencies.userService)
      const pair = user ? dependencies.languagePairService.findDefaultForUser(user.id) : null
      const item = user ? dependencies.vocabularyService.findForUser(user.id, pendingEdit.vocabularyItemId) : null
      if (!user || !pair || pendingEdit.userId !== user.id || pendingEdit.languagePairId !== pair.id
        || !item || item.languagePairId !== pair.id) {
        ctx.session!.pendingTranslationEdit = undefined
        await ctx.reply('Translation edit expired. Please start again with /edit.')
        return
      }

      const translations = [...new Set(text.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean))]
      if (translations.length === 0) {
        await ctx.reply('Please provide at least one translation')
        return
      }

      const updated = dependencies.vocabularyService.replaceTranslations(user.id, item.id, translations)
      if (!updated) {
        ctx.session!.pendingTranslationEdit = undefined
        await ctx.reply('Translation edit expired. Please start again with /edit.')
        return
      }
      ctx.session!.pendingTranslationEdit = undefined
      const successMessage = `Updated translations for ${updated.text}:\n${updated.translations.join('\n')}`
      if (pendingEdit.reviewMessage) {
        try {
          const review = ctx.session?.review
          const index = review?.itemIds.indexOf(updated.id) ?? -1
          if (!review || index < 0) throw new Error('Review message is no longer active')
          await ctx.telegram.editMessageText(
            pendingEdit.reviewMessage.chatId,
            pendingEdit.reviewMessage.messageId,
            undefined,
            renderReviewAnswer(updated, index + 1, review.itemIds.length),
            Markup.inlineKeyboard([
              [
                Markup.button.callback("Didn't know", `review:incorrect:${updated.id}`),
                Markup.button.callback('Knew it', `review:correct:${updated.id}`),
              ],
              [Markup.button.callback('Edit translation', `review:edit:${updated.id}`)],
            ]),
          )
        } catch {
          await ctx.reply(successMessage)
        }
      } else {
        await ctx.reply(successMessage)
      }
      return
    }

    const user = getCurrentUser(ctx, dependencies.userService)
    if (!user) {
      await ctx.reply('Please send /start first')
      return
    }

    const pair = dependencies.languagePairService.findDefaultForUser(user.id)
    if (!pair) {
      await ctx.reply('Choose your languages with /start first')
      return
    }

    const entries = text.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
    if (entries.length === 0) {
      await ctx.reply('Please provide at least one word or phrase')
      return
    }

    if (entries.length > 1) {
      let added = 0
      let duplicates = 0
      let failed = 0

      for (const entry of entries) {
        try {
          const result = await dependencies.vocabularyService.addText(user.id, pair, entry)
          if (result.duplicate) duplicates++
          else added++
        } catch (error) {
          failed++
          dependencies.logger.error(
            { errorType: error instanceof Error ? 'Error' : typeof error },
            'Vocabulary provider failed',
          )
        }
      }

      await ctx.reply(renderBulkImportSummary({ added, duplicates, failed }))
      return
    }

    try {
      const result = await dependencies.vocabularyService.addText(user.id, pair, entries[0])
      await ctx.reply(result.duplicate ? renderDuplicate(result.item) : result.pending ? renderVocabularyPending(result.item) : renderVocabularyAdded(result.item))
    } catch (error) {
      dependencies.logger.error({ errorType: error instanceof Error ? 'Error' : typeof error }, 'Vocabulary provider failed')
      await ctx.reply(providerFailureMessage)
    }
  })

  bot.command('edit', async (ctx) => {
    const session = (ctx.session ??= {})
    session.pendingTranslationEdit = undefined
    const body = ctx.message.text.replace(/^\/edit(?:@[^\s]+)?/, '').trim()
    if (!body) {
      await ctx.reply('Please provide a word or phrase after /edit')
      return
    }

    const user = getCurrentUser(ctx, dependencies.userService)
    if (!user) {
      await ctx.reply('Please send /start first')
      return
    }
    const pair = dependencies.languagePairService.findDefaultForUser(user.id)
    if (!pair) {
      await ctx.reply('Choose your languages with /start first')
      return
    }

    const item = dependencies.vocabularyService.findByText(user.id, pair.id, body)
    if (!item || item.languagePairId !== pair.id) {
      await ctx.reply('Word not found in the active language pair')
      return
    }

    session.pendingTranslationEdit = {
      userId: user.id,
      vocabularyItemId: item.id,
      languagePairId: pair.id,
    }
    await ctx.reply(`Send replacement translations for ${item.text}, one per line:`)
  })

  bot.command('inbox', async (ctx) => {
    const user = getCurrentUser(ctx, dependencies.userService)
    if (!user) {
      await ctx.reply('Please send /start first')
      return
    }

    const pair = dependencies.languagePairService.findDefaultForUser(user.id)
    if (!pair) {
      await ctx.reply('Choose your languages with /start first')
      return
    }

    const items = dependencies.vocabularyService.listForUser(user.id, {
      status: 'inbox', languagePairId: pair.id, limit: 10,
    })
    const count = dependencies.vocabularyService.countByStatus(user.id, 'inbox', pair.id)
    await ctx.reply(renderInbox(items, count), Markup.inlineKeyboard([
      [Markup.button.callback('Learn all', `inbox:learn_all:${pair.id}`)],
    ]))
  })

  bot.command('learning', async (ctx) => {
    const user = getCurrentUser(ctx, dependencies.userService)
    if (!user) {
      await ctx.reply('Please send /start first')
      return
    }
    const pair = dependencies.languagePairService.findDefaultForUser(user.id)
    if (!pair) {
      await ctx.reply('Choose your languages with /start first')
      return
    }

    const items = dependencies.vocabularyService.listForUser(user.id, {
      status: 'learning', languagePairId: pair.id, limit: 10,
    })
    const count = dependencies.vocabularyService.countByStatus(user.id, 'learning', pair.id)
    if (count === 0) {
      await ctx.reply('Learning list is empty')
      return
    }
    await ctx.reply(renderLearning(items, count), Markup.inlineKeyboard([[
      Markup.button.callback('Review due words', 'review:start_due'),
    ]]))
  })

  bot.command('delete', async (ctx) => {
    const user = getCurrentUser(ctx, dependencies.userService)
    if (!user) {
      await ctx.reply('Please send /start first')
      return
    }
    const pair = dependencies.languagePairService.findDefaultForUser(user.id)
    if (!pair) {
      await ctx.reply('Choose your languages with /start first')
      return
    }

    const body = ctx.message.text.replace(/^\/delete(?:@[^\s]+)?/, '')
    const words = [...new Set(body.split(/\r?\n/).map((word) => normalizeText(word)).filter(Boolean))]
    if (words.length === 0) {
      await ctx.reply('Please provide a word or newline-separated list to delete')
      return
    }
    if (words.length === 1) {
      const deleted = dependencies.vocabularyService.deleteText(user.id, pair.id, words[0])
      await ctx.reply(renderDeleteSummary(deleted ? 1 : 0, deleted ? 0 : 1))
      return
    }

    ;(ctx.session ??= {}).pendingDelete = { userId: user.id, languagePairId: pair.id, words }
    await ctx.reply(renderDeleteConfirmation(words.length), Markup.inlineKeyboard([[
      Markup.button.callback('Confirm delete', 'vocabulary:delete:confirm'),
      Markup.button.callback('Cancel', 'vocabulary:delete:cancel'),
    ]]))
  })

  bot.on('callback_query', async (ctx, next) => {
    if (!('data' in ctx.callbackQuery)) {
      await next()
      await ctx.answerCbQuery()
      return
    }

    const data = ctx.callbackQuery.data
    if (data === 'inbox:learn_all') {
      try {
        await ctx.reply('This request expired. Please open /inbox again.')
      } finally {
        await ctx.answerCbQuery()
      }
      return
    }
    if (data === 'vocabulary:delete:cancel' || data === 'vocabulary:delete:confirm') {
      try {
        const pending = ctx.session?.pendingDelete
        if (data === 'vocabulary:delete:cancel') {
          if (ctx.session) ctx.session.pendingDelete = undefined
          await ctx.reply('Delete cancelled')
          return
        }
        const user = getCurrentUser(ctx, dependencies.userService)
        const pair = user ? dependencies.languagePairService.findDefaultForUser(user.id) : null
        if (!pending || !user || !pair || pending.userId !== user.id || pending.languagePairId !== pair.id) {
          if (ctx.session) ctx.session.pendingDelete = undefined
          await ctx.reply('Delete request expired')
          return
        }
        let deleted = 0
        let notFound = 0
        for (const word of pending.words) {
          if (dependencies.vocabularyService.deleteText(user.id, pair.id, word)) deleted++
          else notFound++
        }
        if (ctx.session) ctx.session.pendingDelete = undefined
        await ctx.reply(renderDeleteSummary(deleted, notFound))
      } finally {
        await ctx.answerCbQuery()
      }
      return
    }

    const itemMatch = /^vocabulary:delete:item:([^:]+)$/.exec(data)
    if (itemMatch) {
      try {
        const user = getCurrentUser(ctx, dependencies.userService)
        const pair = user ? dependencies.languagePairService.findDefaultForUser(user.id) : null
        const item = user ? dependencies.vocabularyService.findForUser(user.id, itemMatch[1]) : null
        const deleted = Boolean(user && pair && item && item.languagePairId === pair.id
          && dependencies.vocabularyService.deleteForUser(user.id, item.id))
        await ctx.reply(deleted ? 'Deleted: 1' : 'Not found: 1')
      } finally {
        await ctx.answerCbQuery()
      }
      return
    }

    const learnAllMatch = /^inbox:learn_all:([^:]+)$/.exec(data)
    if (!learnAllMatch) {
      await next()
      await ctx.answerCbQuery()
      return
    }

    try {
      const user = getCurrentUser(ctx, dependencies.userService)
      if (!user) {
        await ctx.reply('Please send /start first')
        return
      }

      const pair = dependencies.languagePairService.findDefaultForUser(user.id)
      if (!pair || pair.id !== learnAllMatch[1]) {
        await ctx.reply('This request expired. Please open /inbox again.')
        return
      }

      const moved = dependencies.reviewService.startLearning(user.id, pair.id, new Date())
      await ctx.reply(`Moved ${moved} item${moved === 1 ? '' : 's'} to learning.`)
    } finally {
      await ctx.answerCbQuery()
    }
  })
}
