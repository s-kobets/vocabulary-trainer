import { Markup, type Telegraf } from 'telegraf'
import { getCurrentUser } from './context'
import { renderReviewAnswer, renderReviewPrompt } from './messages'
import type { BotContext, BotDependencies } from './telegram.types'
import type { ReviewResult } from '../reviews/review.algorithm'

const expiredMessage = 'Review session expired. Send /review to start again.'

function sessionFor(ctx: BotContext) {
  return (ctx.session ??= {}).review
}

function reviewKeyboard(itemId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Show answer', `review:show:${itemId}`)],
  ])
}

function answerKeyboard(itemId: string) {
  return Markup.inlineKeyboard([[
    Markup.button.callback("Didn't know", `review:incorrect:${itemId}`),
    Markup.button.callback('Knew it', `review:correct:${itemId}`),
  ]])
}

function currentItem(ctx: BotContext, dependencies: BotDependencies) {
  const review = sessionFor(ctx)
  const user = getCurrentUser(ctx, dependencies.userService)
  if (!review || !user || review.index < 0 || review.index >= review.itemIds.length) return null

  const itemId = review.itemIds[review.index]
  const item = dependencies.vocabularyService.findForUser(user.id, itemId)
  return item && item.userId === user.id ? { item, review, user } : null
}

async function expire(ctx: BotContext): Promise<void> {
  if (ctx.session) ctx.session.review = undefined
  await ctx.reply(expiredMessage)
}

export function registerReviewHandlers(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  const startReview = async (ctx: BotContext, languagePairId: string): Promise<void> => {
    const user = getCurrentUser(ctx, dependencies.userService)
    if (!user) {
      await ctx.reply('Please send /start first')
      return
    }

    const due = dependencies.reviewService.getDue(user.id, new Date(), 50, languagePairId)
    if (due.length === 0) {
      await ctx.reply('Nothing to review right now')
      return
    }

    const session = (ctx.session ??= {})
    session.review = {
      itemIds: due.map(({ item }) => item.id),
      index: 0,
      revealed: false,
    }
    await ctx.reply(renderReviewPrompt(due[0].item, 1, due.length), reviewKeyboard(due[0].item.id))
  }

  bot.command('review', async (ctx) => {
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
    await startReview(ctx, pair.id)
  })

  bot.on('callback_query', async (ctx, next) => {
    if (!('data' in ctx.callbackQuery)) {
      await next()
      return
    }

    if (ctx.callbackQuery.data === 'review:start_due') {
      try {
        const user = getCurrentUser(ctx, dependencies.userService)
        const pair = user ? dependencies.languagePairService.findDefaultForUser(user.id) : null
        if (!user) {
          await ctx.reply('Please send /start first')
          return
        }
        if (!pair) {
          await ctx.reply('Choose your languages with /start first')
          return
        }
        await startReview(ctx, pair.id)
      } finally {
        await ctx.answerCbQuery()
      }
      return
    }

    const match = /^review:(show|correct|incorrect):([^:]+)$/.exec(ctx.callbackQuery.data)
    if (!match) {
      await next()
      return
    }

    try {
      const review = sessionFor(ctx)
      if (!review || review.itemIds[review.index] !== match[2]) {
        await expire(ctx)
        return
      }

      const current = currentItem(ctx, dependencies)
      if (!current) {
        await expire(ctx)
        return
      }

      if (match[1] === 'show') {
        current.review.revealed = true
        await ctx.editMessageText(
          renderReviewAnswer(current.item, current.review.index + 1, current.review.itemIds.length),
          answerKeyboard(current.item.id),
        )
        return
      }

      if (!current.review.revealed) {
        await expire(ctx)
        return
      }

      const result = match[1] as ReviewResult
      dependencies.reviewService.answer(current.user.id, current.item.id, result, new Date())
      current.review.index += 1
      current.review.revealed = false

      if (current.review.index >= current.review.itemIds.length) {
        const reviewedCount = current.review.itemIds.length
        ctx.session!.review = undefined
        await ctx.reply(`Review complete. Reviewed ${reviewedCount} item${reviewedCount === 1 ? '' : 's'}.`)
        return
      }

      const nextItem = dependencies.vocabularyService.findForUser(
        current.user.id,
        current.review.itemIds[current.review.index],
      )
      if (!nextItem) {
        await expire(ctx)
        return
      }
      await ctx.editMessageText(
        renderReviewPrompt(nextItem, current.review.index + 1, current.review.itemIds.length),
        reviewKeyboard(nextItem.id),
      )
    } finally {
      await ctx.answerCbQuery()
    }
  })
}
