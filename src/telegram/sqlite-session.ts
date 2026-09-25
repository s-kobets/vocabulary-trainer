import type { MiddlewareFn } from 'telegraf'
import type { SqliteDatabase } from '../db/database'
import type { BotContext, BotSession } from './telegram.types'

type SessionRow = {
  session_json: string
  expires_at: string | null
}

type SessionOptions = {
  ttlMs?: number
}

function decodeSession(raw: string | undefined): BotSession | undefined {
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as BotSession : undefined
  } catch {
    return undefined
  }
}

export function createSqliteSessionMiddleware(
  db: SqliteDatabase,
  options: SessionOptions = {},
): MiddlewareFn<BotContext> {
  const ttlMs = options.ttlMs ?? 30 * 24 * 60 * 60 * 1000
  const select = db.prepare('SELECT session_json, expires_at FROM telegram_sessions WHERE telegram_user_id = ?')
  const upsert = db.prepare(`
    INSERT INTO telegram_sessions (telegram_user_id, session_json, updated_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      session_json = excluded.session_json,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `)
  const remove = db.prepare('DELETE FROM telegram_sessions WHERE telegram_user_id = ?')

  return async (ctx, next) => {
    const telegramUserId = ctx.from ? String(ctx.from.id) : undefined
    if (!telegramUserId) return next()

    const row = select.get(telegramUserId) as SessionRow | undefined
    const expired = row?.expires_at ? Date.parse(row.expires_at) <= Date.now() : false
    if (row && !expired) ctx.session = decodeSession(row.session_json)
    else {
      if (row) remove.run(telegramUserId)
      ctx.session = undefined
    }

    await next()

    if (ctx.session && Object.keys(ctx.session).length > 0) {
      const now = new Date()
      upsert.run(telegramUserId, JSON.stringify(ctx.session), now.toISOString(), new Date(now.getTime() + ttlMs).toISOString())
    } else {
      remove.run(telegramUserId)
    }
  }
}
