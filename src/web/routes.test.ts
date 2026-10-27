import { strict as assert } from 'node:assert'
import crypto from 'node:crypto'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import type { Config } from '../config'
import { MockDictionaryProvider } from '../dictionary/mock-dictionary.provider'
import { runMigrations } from '../db/database'
import { LanguagePairRepository } from '../languages/language-pair.repository'
import { LanguagePairService } from '../languages/language-pair.service'
import { ReviewRepository } from '../reviews/review.repository'
import { ReviewService } from '../reviews/review.service'
import { TelegramAccountRepository } from '../users/telegram-account.repository'
import { UserRepository } from '../users/user.repository'
import { UserService } from '../users/user.service'
import { UserSettingsRepository } from '../users/user-settings.repository'
import { VocabularyRepository } from '../vocabulary/vocabulary.repository'
import { VocabularyService } from '../vocabulary/vocabulary.service'
import { createHttpApp } from '../http'
import { registerWebRoutes } from './routes'
import { SessionRepository } from './session.repository'

const token = '12345:test-token'

function signedAuth(id: string): string {
  const auth = { auth_date: String(Math.floor(Date.now() / 1000)), first_name: 'Web User', id }
  const data = Object.entries(auth).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = crypto.createHash('sha256').update(token).digest()
  const hash = crypto.createHmac('sha256', secret).update(data).digest('hex')
  return new URLSearchParams({ ...auth, hash }).toString()
}

function createWebApp(t: test.TestContext) {
  const db = new Database(':memory:')
  runMigrations(db, path.join(__dirname, '../db/migrations'))
  const users = new UserRepository(db)
  const telegramAccounts = new TelegramAccountRepository(db)
  const settings = new UserSettingsRepository(db)
  const languagePairs = new LanguagePairService(db, new LanguagePairRepository(db))
  const vocabularyRepository = new VocabularyRepository(db)
  const vocabularyService = new VocabularyService(vocabularyRepository, new MockDictionaryProvider())
  const reviewService = new ReviewService(db, new ReviewRepository(db), vocabularyRepository)
  const sessions = new SessionRepository(db)
  const app = createHttpApp(db)
  registerWebRoutes(app, {
    config: {
      nodeEnv: 'test', port: 3000, databasePath: ':memory:', telegramBotToken: token,
      telegramBotUsername: 'vocabulary_test_bot', openAiModel: 'gpt-4o-mini',
    } satisfies Config,
    userService: new UserService(db, users, telegramAccounts, settings),
    telegramAccounts,
    sessions,
    languagePairService: languagePairs,
    vocabularyService,
    reviewService,
  })
  t.after(async () => { await app.close(); db.close() })
  return { app, db, users, telegramAccounts, settings, languagePairs, vocabularyService, sessions }
}

async function beginLogin(app: ReturnType<typeof createHttpApp>) {
  const login = await app.inject({ url: '/login', headers: { host: 'localhost:3000' } })
  assert.equal(login.statusCode, 200)
  assert.equal(typeof login.headers['set-cookie'], 'string', 'login must create browser-bound state')
  const cookie = (login.headers['set-cookie'] as string).split(';')[0]
  const state = decodeURIComponent(cookie.split('=')[1])
  assert.match(login.body, new RegExp(`data-auth-url="http://localhost:3000/auth/telegram\\?state=${state}"`))
  assert.match(login.headers['set-cookie'] as string, /HttpOnly; SameSite=Lax/)
  return { cookie, state }
}

test('web auth shares user data across vocabulary capture and review', async (t) => {
  const { app, db, users, telegramAccounts, settings, languagePairs, vocabularyService, sessions } = createWebApp(t)
  const protectedPage = await app.inject({ method: 'GET', url: '/' })
  assert.equal(protectedPage.statusCode, 302)
  assert.equal(protectedPage.headers.location, '/login')
  const login = await app.inject({ method: 'GET', url: '/login' })
  assert.match(login.body, /data-telegram-login="vocabulary_test_bot"/)
  const stylesheet = await app.inject({ method: 'GET', url: '/app.css' })
  assert.equal(stylesheet.statusCode, 200)
  assert.match(stylesheet.headers['content-type'] as string, /text\/css/)

  const attempt = await beginLogin(app)
  const auth = await app.inject({
    url: `/auth/telegram?${signedAuth('987654321')}&state=${attempt.state}`, headers: { cookie: attempt.cookie },
  })
  assert.equal(auth.statusCode, 302)
  const cookie = (auth.headers['set-cookie'] as string).split(';')[0]
  const user = new UserService(db, users, telegramAccounts, settings).findByTelegramUserId('987654321')!

  const dashboard = await app.inject({ method: 'GET', url: '/', headers: { cookie } })
  assert.match(dashboard.body, /Выберите языки/)
  const createPair = await app.inject({
    method: 'POST', url: '/languages', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'source=en&target=ru',
  })
  assert.equal(createPair.statusCode, 303)
  const dashboardWithPair = await app.inject({ method: 'GET', url: '/', headers: { cookie } })
  assert.match(dashboardWithPair.body, /Добавить языковую пару/)
  const pair = languagePairs.findDefaultForUser(user.id)!

  const addWord = await app.inject({
    method: 'POST', url: '/vocabulary', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'text=serendipity',
  })
  assert.equal(addWord.statusCode, 303)
  const item = vocabularyService.listForUser(user.id, { languagePairId: pair.id })[0]
  assert.equal(item.text, 'serendipity')
  await app.inject({
    method: 'POST', url: '/vocabulary', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: `text=${encodeURIComponent('<script>alert(1)</script>')}`,
  })
  const vocabularyPage = await app.inject({ method: 'GET', url: '/vocabulary', headers: { cookie } })
  assert.match(vocabularyPage.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(vocabularyPage.body, /<script>alert\(1\)/)
  const addBatch = await app.inject({
    method: 'POST', url: '/vocabulary', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'text=carry+on%0Atake+place',
  })
  assert.equal(addBatch.statusCode, 303)
  assert.ok(vocabularyService.findByText(user.id, pair.id, 'carry on'))
  assert.ok(vocabularyService.findByText(user.id, pair.id, 'take place'))
  const learn = await app.inject({ method: 'POST', url: `/vocabulary/${item.id}/learn`, headers: { cookie } })
  assert.equal(learn.statusCode, 303)

  const review = await app.inject({ method: 'GET', url: '/review', headers: { cookie } })
  assert.match(review.body, /serendipity/)
  const reveal = await app.inject({ method: 'POST', url: `/review/${item.id}/reveal`, headers: { cookie } })
  assert.match(reveal.body, /mock:ru/)
  const answer = await app.inject({
    method: 'POST', url: `/review/${item.id}/answer`, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'result=correct',
  })
  assert.equal(answer.statusCode, 303)
  assert.equal(vocabularyService.findForUser(user.id, item.id)?.status, 'learning')

  const logout = await app.inject({ method: 'POST', url: '/logout', headers: { cookie } })
  assert.equal(logout.statusCode, 302)
  assert.equal(sessions.findUserId(decodeURIComponent(cookie.split('=')[1].split(';')[0])), null)
})

test('Telegram callback rejects missing or mismatched browser state without replacing an existing login', async (t) => {
  const { app, sessions, telegramAccounts, users, settings, db } = createWebApp(t)
  const user = new UserService(db, users, telegramAccounts, settings).ensureFromTelegram({ telegramUserId: '101' })
  const existingSession = sessions.create(user.id, new Date(Date.now() + 60_000).toISOString())
  const existingCookie = `vocabulary_session=${existingSession}`
  const direct = await app.inject({ url: `/auth/telegram?${signedAuth('202')}`, headers: { cookie: existingCookie } })
  assert.match(direct.headers.location ?? '', /^\/login\?/)
  assert.equal(direct.headers['set-cookie'], undefined)
  assert.equal(sessions.findUserId(existingSession), user.id)

  const first = await beginLogin(app)
  const second = await beginLogin(app)
  const mismatched = await app.inject({
    url: `/auth/telegram?${signedAuth('202')}&state=${first.state}`, headers: { cookie: `${existingCookie}; ${second.cookie}` },
  })
  assert.match(mismatched.headers.location ?? '', /^\/login\?/)
  assert.equal(mismatched.headers['set-cookie'], undefined)
  assert.equal(telegramAccounts.findByTelegramUserId('202'), null)
})

test('Telegram login attempts expire and valid callbacks can be consumed only once', async (t) => {
  const { app, db } = createWebApp(t)
  const expired = await beginLogin(app)
  db.prepare('UPDATE web_login_attempts SET expires_at = ?').run('2000-01-01T00:00:00.000Z')
  const expiredResult = await app.inject({
    url: `/auth/telegram?${signedAuth('101')}&state=${expired.state}`, headers: { cookie: expired.cookie },
  })
  assert.match(expiredResult.headers.location ?? '', /^\/login\?/)

  const attempt = await beginLogin(app)
  const url = `/auth/telegram?${signedAuth('101')}&state=${attempt.state}`
  const accepted = await app.inject({ url, headers: { cookie: attempt.cookie } })
  assert.equal(accepted.headers.location, '/')
  const replay = await app.inject({ url, headers: { cookie: attempt.cookie } })
  assert.match(replay.headers.location ?? '', /^\/login\?/)
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS count FROM sessions').get(), { count: 1 })
})
