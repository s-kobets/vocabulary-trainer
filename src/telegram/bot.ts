import { Telegraf, session } from 'telegraf'
import { registerStartHandlers } from './start.handlers'
import { registerReviewHandlers } from './review.handlers'
import { registerVocabularyHandlers } from './vocabulary.handlers'
import { registerAccountHandlers } from './account.handlers'
import { registerLanguageHandlers } from './languages.handlers'
import type { BotContext, BotDependencies, BotSession } from './telegram.types'
import { createSqliteSessionMiddleware } from './sqlite-session'

export function createBot(token: string, dependencies: BotDependencies): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(token)
  if (dependencies.db) bot.use(createSqliteSessionMiddleware(dependencies.db))
  else bot.use(session<BotSession, BotContext>({ defaultSession: () => ({}) }))
  registerStartHandlers(bot, dependencies)
  registerReviewHandlers(bot, dependencies)
  registerAccountHandlers(bot, dependencies)
  registerLanguageHandlers(bot, dependencies)
  registerVocabularyHandlers(bot, dependencies)
  bot.catch(async (error, ctx) => {
    const errorType = error instanceof Error ? 'Error' : typeof error
    dependencies.logger.error({ updateId: ctx.update.update_id, errorType }, 'Telegram update failed')
    try {
      await ctx.reply('Something went wrong. Please try again.')
    } catch {
      // Telegram may be unavailable while handling the original failure.
    }
  })
  return bot
}
