import { strict as assert } from 'node:assert'
import crypto from 'node:crypto'
import test from 'node:test'
import { verifyTelegramAuth } from './auth'

const token = '12345:secret'
const now = 1_700_000_000

function signed(data: Record<string, string>): Record<string, string> {
  const dataCheckString = Object.entries(data).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = crypto.createHash('sha256').update(token).digest()
  return { ...data, hash: crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex') }
}

test('accepts a fresh Telegram Login Widget signature and maps profile fields', () => {
  const auth = signed({ id: '9007199254740993', auth_date: String(now), first_name: 'Ada', username: 'ada' })
  assert.deepEqual(verifyTelegramAuth(auth, token, now), {
    telegramUserId: '9007199254740993', firstName: 'Ada', username: 'ada',
  })
})

test('rejects changed signature, expired payload, and future timestamp', () => {
  const valid = signed({ id: '42', auth_date: String(now) })
  assert.equal(verifyTelegramAuth({ ...valid, id: '43' }, token, now), null)
  assert.equal(verifyTelegramAuth(signed({ id: '42', auth_date: String(now - 301) }), token, now), null)
  assert.equal(verifyTelegramAuth(signed({ id: '42', auth_date: String(now + 31) }), token, now), null)
})
