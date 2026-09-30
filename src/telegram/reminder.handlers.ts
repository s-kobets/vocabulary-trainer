import { type Telegraf } from 'telegraf'
import { UserSettingsRepository } from '../users/user-settings.repository'
import { getLocalDateTime, isValidReminderTime } from '../reminders/reminder.schedule'
import { getCurrentUser } from './context'
import type { BotContext, BotDependencies } from './telegram.types'

function messageText(ctx: BotContext): string {
  return ctx.message && 'text' in ctx.message ? ctx.message.text : ''
}

function commandArguments(text: string, command: string): string[] {
  return text.replace(new RegExp(`^/${command}(?:@\\w+)?`), '').trim().split(/\s+/).filter(Boolean)
}

function reminderStatus(settings: ReturnType<UserSettingsRepository['getForUser']>): string {
  if (!settings) return 'Reminder settings are unavailable.'
  return `Daily reminders: ${settings.dailyReviewEnabled ? 'on' : 'paused'}\nTime: ${settings.dailyReviewTime}\nTimezone: ${settings.timezone}`
}

export function registerReminderHandlers(bot: Telegraf<BotContext>, dependencies: BotDependencies): void {
  bot.command('reminder', async (ctx) => {
    const user = getCurrentUser(ctx, dependencies.userService)
    if (!user) {
      await ctx.reply('Please send /start first')
      return
    }

    const [action, value, extra] = commandArguments(messageText(ctx), 'reminder')
    if (!action) {
      await ctx.reply(reminderStatus(dependencies.userSettingsRepository.getForUser(user.id)))
      return
    }
    if (action === 'on' && value === undefined) {
      dependencies.userSettingsRepository.updatePreferences(user.id, { dailyReviewEnabled: true })
      await ctx.reply('Daily reminders enabled')
      return
    }
    if (action === 'pause' && value === undefined) {
      dependencies.userSettingsRepository.updatePreferences(user.id, { dailyReviewEnabled: false })
      await ctx.reply('Daily reminders paused')
      return
    }
    if (action === 'time' && value !== undefined && extra === undefined) {
      if (!isValidReminderTime(value)) {
        await ctx.reply('Invalid time. Use /reminder time HH:MM (24-hour format)')
        return
      }
      dependencies.userSettingsRepository.updatePreferences(user.id, { dailyReviewTime: value })
      await ctx.reply(`Reminder time set to ${value}`)
      return
    }
    await ctx.reply('Use /reminder, /reminder on, /reminder pause, or /reminder time HH:MM')
  })

  bot.command('timezone', async (ctx) => {
    const user = getCurrentUser(ctx, dependencies.userService)
    if (!user) {
      await ctx.reply('Please send /start first')
      return
    }

    const [timezone, extra] = commandArguments(messageText(ctx), 'timezone')
    if (!timezone || extra) {
      await ctx.reply('Use /timezone Area/Location, for example /timezone Europe/Moscow')
      return
    }
    try {
      getLocalDateTime(new Date(), timezone)
    } catch {
      await ctx.reply('Invalid timezone. Use an IANA timezone such as Europe/Moscow')
      return
    }
    dependencies.userSettingsRepository.updatePreferences(user.id, { timezone })
    await ctx.reply(`Timezone set to ${timezone}`)
  })
}
