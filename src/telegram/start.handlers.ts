import { Markup, type Telegraf } from 'telegraf'
import { getLanguages } from '../languages/languages'
import { ensureCurrentUser } from './context'
import { renderReadyMessage } from './messages'
import type { BotContext, BotDependencies } from './telegram.types'

function languageKeyboard(step: 'source' | 'target') {
  return Markup.inlineKeyboard(
    getLanguages().map((language) => [
      Markup.button.callback(language.name, `onboarding:${step}:${language.code}`),
    ]),
  )
}

function findLanguage(code: string) {
  return getLanguages().find((language) => language.code === code)
}

function getSession(ctx: BotContext) {
  return (ctx.session ??= {})
}

export function registerStartHandlers(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.command('start', async (ctx) => {
    const user = ensureCurrentUser(ctx, dependencies.userService)
    const pair = dependencies.languagePairService.findDefaultForUser(user.id)
    if (pair) {
      await ctx.reply(renderReadyMessage(pair))
      return
    }

    getSession(ctx).onboarding = { step: 'source' }
    await ctx.reply('Choose your source language:', languageKeyboard('source'))
  })

  bot.on('callback_query', async (ctx, next) => {
    if (!('data' in ctx.callbackQuery)) {
      await next()
      return
    }
    const match = /^onboarding:(source|target):(.+)$/.exec(ctx.callbackQuery.data)
    if (!match) {
      await next()
      return
    }

    try {
      const step = match[1] as 'source' | 'target'
      const code = match[2]
      const language = findLanguage(code)
      if (!language) {
        await ctx.reply('Unknown language')
        return
      }

      const session = getSession(ctx)
      if (step === 'source') {
        session.onboarding = { step: 'target', sourceLanguage: language.code }
        await ctx.reply('Choose your target language:', languageKeyboard('target'))
        return
      }

      const source = session.onboarding?.sourceLanguage
      if (!source) {
        await ctx.reply('Choose your source language first')
        return
      }
      if (source === language.code) {
        await ctx.reply('Choose two different languages')
        return
      }

      const user = ensureCurrentUser(ctx, dependencies.userService)
      const pair = dependencies.languagePairService.createDefault(user.id, source, language.code)
      session.onboarding = undefined
      await ctx.reply(renderReadyMessage(pair))
    } finally {
      await ctx.answerCbQuery()
    }
  })
}
