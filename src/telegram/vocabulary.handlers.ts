import { Markup, type Telegraf } from 'telegraf'
import { getCurrentUser } from './context'
import { renderDuplicate, renderInbox, renderVocabularyAdded, renderVocabularyPending } from './messages'
import type { BotContext, BotDependencies } from './telegram.types'

const providerFailureMessage = "I couldn't process this word right now.\nPlease try again later."

export function registerVocabularyHandlers(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.on('text', async (ctx) => {
    const text = ctx.message.text
    if (text.startsWith('/')) return

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

    try {
      const result = await dependencies.vocabularyService.addText(user.id, pair, text)
      await ctx.reply(result.duplicate ? renderDuplicate(result.item) : result.pending ? renderVocabularyPending(result.item) : renderVocabularyAdded(result.item))
    } catch (error) {
      dependencies.logger.error({ errorType: error instanceof Error ? 'Error' : typeof error }, 'Vocabulary provider failed')
      await ctx.reply(providerFailureMessage)
    }
  })

  bot.command('inbox', async (ctx) => {
    const user = getCurrentUser(ctx, dependencies.userService)
    if (!user) {
      await ctx.reply('Please send /start first')
      return
    }

    const items = dependencies.vocabularyService.listForUser(user.id, { status: 'inbox', limit: 10 })
    const count = dependencies.vocabularyService.countByStatus(user.id, 'inbox')
    await ctx.reply(renderInbox(items, count), Markup.inlineKeyboard([
      Markup.button.callback('Learn all', 'inbox:learn_all'),
    ]))
  })

  bot.on('callback_query', async (ctx) => {
    if (!('data' in ctx.callbackQuery) || ctx.callbackQuery.data !== 'inbox:learn_all') {
      await ctx.answerCbQuery()
      return
    }

    try {
      const user = getCurrentUser(ctx, dependencies.userService)
      if (!user) {
        await ctx.reply('Please send /start first')
        return
      }

      const moved = dependencies.reviewService.startLearning(user.id, new Date())
      await ctx.reply(`Moved ${moved} item${moved === 1 ? '' : 's'} to learning.`)
    } finally {
      await ctx.answerCbQuery()
    }
  })
}
