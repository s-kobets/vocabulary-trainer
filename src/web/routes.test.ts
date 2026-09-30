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

test('web auth shares user data across vocabulary capture and review', async (t) => {
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

  const protectedPage = await app.inject({ method: 'GET', url: '/' })
  assert.equal(protectedPage.statusCode, 302)
  assert.equal(protectedPage.headers.location, '/login')
  const login = await app.inject({ method: 'GET', url: '/login' })
  assert.match(login.body, /data-telegram-login="vocabulary_test_bot"/)
  const stylesheet = await app.inject({ method: 'GET', url: '/app.css' })
  assert.equal(stylesheet.statusCode, 200)
  assert.match(stylesheet.headers['content-type'] as string, /text\/css/)

  const auth = await app.inject({ method: 'GET', url: `/auth/telegram?${signedAuth('987654321')}` })
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
