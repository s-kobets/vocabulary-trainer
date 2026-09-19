import { strict as assert } from 'node:assert'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runMigrations } from './db/database'
import { MockDictionaryProvider } from './dictionary/mock-dictionary.provider'
import { LanguagePairRepository } from './languages/language-pair.repository'
import { LanguagePairService } from './languages/language-pair.service'
import { ReviewRepository } from './reviews/review.repository'
import { ReviewService } from './reviews/review.service'
import { TelegramAccountRepository } from './users/telegram-account.repository'
import { UserRepository } from './users/user.repository'
import { UserService } from './users/user.service'
import { UserSettingsRepository } from './users/user-settings.repository'
import { VocabularyRepository } from './vocabulary/vocabulary.repository'
import { VocabularyService } from './vocabulary/vocabulary.service'

test('runs Telegram MVP service flow with user-scoped state', async () => {
  const db = new Database(':memory:')
  runMigrations(db, path.join(__dirname, './db/migrations'))

  const users = new UserRepository(db)
  const telegramAccounts = new TelegramAccountRepository(db)
  const userSettings = new UserSettingsRepository(db)
  const languagePairs = new LanguagePairRepository(db)
  const vocabulary = new VocabularyRepository(db)
  const reviews = new ReviewRepository(db)
  const userService = new UserService(db, users, telegramAccounts, userSettings)
  const languagePairService = new LanguagePairService(db, languagePairs)
  const vocabularyService = new VocabularyService(vocabulary, new MockDictionaryProvider())
  const reviewService = new ReviewService(db, reviews, vocabulary)
  const fixedNow = new Date('2026-09-18T12:00:00.000Z')

  try {
    const user = userService.ensureFromTelegram({ telegramUserId: 'telegram-user-1' })
    const secondUser = userService.ensureFromTelegram({ telegramUserId: 'telegram-user-2' })
    const pair = languagePairService.createDefault(user.id, 'en', 'ru')

    const first = await vocabularyService.addText(user.id, pair, '  Reliable  ')
    assert.equal(first.duplicate, false)
    assert.equal(vocabularyService.countByStatus(user.id, 'inbox'), 1)
    assert.deepEqual(first.item.translations, ['[mock:ru] reliable'])

    const duplicate = await vocabularyService.addText(user.id, pair, 'reliable')
    assert.equal(duplicate.duplicate, true)
    assert.equal(vocabularyService.listForUser(user.id).length, 1)

    assert.equal(reviewService.startLearning(user.id, fixedNow), 1)
    assert.equal(reviewService.getDue(user.id, fixedNow, 10).length, 1)

    reviewService.answer(user.id, first.item.id, 'correct', fixedNow)
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM reviews').get() as { count: number }).count, 1)
    assert.equal(reviews.getState(user.id, first.item.id)?.level, 1)

    assert.deepEqual(vocabularyService.listForUser(secondUser.id), [])
    assert.equal(reviewService.getDue(secondUser.id, fixedNow, 10).length, 0)
  } finally {
    db.close()
  }
})
