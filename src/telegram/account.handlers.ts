import { type Telegraf } from 'telegraf'
import { getCurrentUser } from './context'
import { renderHelp, renderStatus } from './messages'
import type { BotContext, BotDependencies } from './telegram.types'

export function registerAccountHandlers(
  bot: Telegraf<BotContext>,
  dependencies: BotDependencies,
): void {
  bot.command('help', async (ctx) => {
    await ctx.reply(renderHelp())
  })

  bot.command('status', async (ctx) => {
    const user = getCurrentUser(ctx, dependencies.userService)
    if (!user) {
      await ctx.reply('Please send /start first')
      return
    }

    const pair = dependencies.languagePairService.findDefaultForUser(user.id)
    if (!pair) {
      await ctx.reply('Choose a language pair with /languages first')
      return
    }

    await ctx.reply(renderStatus(pair, {
      inbox: dependencies.vocabularyService.countByStatus(user.id, 'inbox'),
      learning: dependencies.vocabularyService.countByStatus(user.id, 'learning'),
      known: dependencies.vocabularyService.countByStatus(user.id, 'known'),
    }))
  })
}
