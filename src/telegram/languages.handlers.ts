import { Markup, type Telegraf } from 'telegraf'
import { getLanguages } from '../languages/languages'
import { getCurrentUser } from './context'
import { renderLanguages } from './messages'
import type { BotContext, BotDependencies } from './telegram.types'

function getSession(ctx: BotContext) {
  return (ctx.session ??= {})
}

function languageKeyboard(step: 'source' | 'target') {
  return Markup.inlineKeyboard(getLanguages().map((language) => [
    Markup.button.callback(language.name, `languages:${step}:${language.code}`),
  ]))
}

function pairKeyboard(pairs: { id: string }[]) {
  return Markup.inlineKeyboard([
    ...pairs.map((pair) => [
      Markup.button.callback('Select', `languages:select:${pair.id}`),
      Markup.button.callback('Delete', `languages:delete:${pair.id}`),
    ]),
    [Markup.button.callback('Add language pair', 'languages:add')],
  ])
}

function findLanguage(code: string) {
  return getLanguages().find((language) => language.code === code)
}

export function registerLanguageHandlers(
  bot: Telegraf<BotContext>,
  dependencies: BotDependencies,
): void {
  const showPairs = async (ctx: BotContext, userId: string) => {
    const pairs = dependencies.languagePairService.listForUser(userId)
    if (pairs.length === 0) {
      getSession(ctx).languageSetup = { step: 'source' }
      await ctx.reply('Choose your source language:', languageKeyboard('source'))
      return
    }
    await ctx.reply(renderLanguages(pairs), pairKeyboard(pairs))
  }

  bot.command('languages', async (ctx) => {
    const user = getCurrentUser(ctx, dependencies.userService)
    if (!user) {
      await ctx.reply('Please send /start first')
      return
    }
    await showPairs(ctx, user.id)
  })

  bot.on('callback_query', async (ctx, next) => {
    if (!('data' in ctx.callbackQuery)) {
      await next()
      return
    }
    const data = ctx.callbackQuery.data
    if (!data.startsWith('languages:')) {
      await next()
      return
    }

    try {
      const user = getCurrentUser(ctx, dependencies.userService)
      if (!user) {
        await ctx.reply('Please send /start first')
        return
      }

      if (data === 'languages:add') {
        getSession(ctx).languageSetup = { step: 'source' }
        await ctx.reply('Choose your source language:', languageKeyboard('source'))
        return
      }

      const selectMatch = /^languages:select:([^:]+)$/.exec(data)
      if (selectMatch) {
        const pair = dependencies.languagePairService.selectForUser(user.id, selectMatch[1])
        getSession(ctx).languageSetup = undefined
        await ctx.reply(`Active pair: ${pair.sourceLanguage} -> ${pair.targetLanguage}`)
        return
      }

      const deleteMatch = /^languages:delete:([^:]+)$/.exec(data)
      if (deleteMatch) {
        const result = dependencies.languagePairService.deleteForUser(user.id, deleteMatch[1])
        if (result === 'has_vocabulary') {
          await ctx.reply('This pair cannot be deleted while it contains vocabulary.')
          return
        }
        getSession(ctx).languageSetup = undefined
        await showPairs(ctx, user.id)
        return
      }

      const sourceMatch = /^languages:source:([^:]+)$/.exec(data)
      if (sourceMatch) {
        if (!findLanguage(sourceMatch[1])) {
          await ctx.reply('Unknown language')
          return
        }
        getSession(ctx).languageSetup = { step: 'target', sourceLanguage: sourceMatch[1] }
        await ctx.reply('Choose your target language:', languageKeyboard('target'))
        return
      }

      const targetMatch = /^languages:target:([^:]+)$/.exec(data)
      if (targetMatch) {
        const target = findLanguage(targetMatch[1])
        const source = getSession(ctx).languageSetup?.sourceLanguage
        if (!target) {
          await ctx.reply('Unknown language')
          return
        }
        if (!source) {
          await ctx.reply('Choose your source language first')
          return
        }
        if (source === target.code) {
          await ctx.reply('Choose two different languages')
          return
        }
        const pair = dependencies.languagePairService.createDefault(user.id, source, target.code)
        getSession(ctx).languageSetup = undefined
        await ctx.reply(`Active pair: ${pair.sourceLanguage} -> ${pair.targetLanguage}`)
      }
    } finally {
      await ctx.answerCbQuery()
    }
  })
}
