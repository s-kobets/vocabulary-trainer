import type { Context } from 'telegraf'
import type { User } from '../users/user.repository'
import type { UserService } from '../users/user.service'

export function getCurrentUser(ctx: Context, userService: UserService): User | null {
  return ctx.from ? userService.findByTelegramUserId(String(ctx.from.id)) : null
}

export function ensureCurrentUser(ctx: Context, userService: UserService): User {
  if (!ctx.from) throw new Error('Telegram user is unavailable')

  return userService.ensureFromTelegram({
    telegramUserId: String(ctx.from.id),
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
  })
}
