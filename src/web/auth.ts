import crypto from 'node:crypto'
import type { TelegramProfile } from '../users/telegram-account.repository'

export function verifyTelegramAuth(
  query: Record<string, string>,
  botToken: string,
  now = Math.floor(Date.now() / 1000),
): TelegramProfile | null {
  const { hash, auth_date: authDate, id, first_name: firstName, last_name: lastName, username } = query
  if (!hash || !authDate || !id || !/^\d+$/.test(id) || !/^\d+$/.test(authDate)) return null

  const timestamp = Number(authDate)
  if (!Number.isSafeInteger(timestamp) || timestamp > now + 30 || now - timestamp > 300) return null

  const dataCheckString = Object.entries(query)
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = crypto.createHash('sha256').update(botToken).digest()
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest()
  let supplied: Buffer
  try {
    supplied = Buffer.from(hash, 'hex')
  } catch {
    return null
  }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null

  return {
    telegramUserId: id,
    ...(username ? { username } : {}),
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
  }
}
