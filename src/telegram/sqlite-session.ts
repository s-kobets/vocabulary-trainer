import type { MiddlewareFn } from 'telegraf'
import type { SqliteDatabase } from '../db/database'
import type { BotContext } from './telegram.types'
import { TelegramSessionRepository } from './telegram-session.repository'

type SessionOptions = {
  ttlMs?: number
}

export function createSqliteSessionMiddleware(
  db: SqliteDatabase,
  options: SessionOptions = {},
): MiddlewareFn<BotContext> {
  const ttlMs = options.ttlMs ?? 30 * 24 * 60 * 60 * 1000
  const repository = new TelegramSessionRepository(db)
  const pending = new Map<string, Promise<void>>()

  return async (ctx, next) => {
    const telegramUserId = ctx.from ? String(ctx.from.id) : undefined
    if (!telegramUserId) return next()

    const previous = pending.get(telegramUserId)
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    pending.set(telegramUserId, current)
    await previous
    try {
      ctx.session = repository.find(telegramUserId)
      try {
        await next()
      } finally {
        repository.save(telegramUserId, ctx.session, ttlMs)
      }
    } finally {
      release()
      if (pending.get(telegramUserId) === current) pending.delete(telegramUserId)
    }
  }
}
