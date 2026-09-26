import { strict as assert } from 'node:assert'
import test from 'node:test'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../db/database'
import { VocabularyRepository } from '../vocabulary/vocabulary.repository'
import { ReviewRepository } from './review.repository'
import { ReviewService } from './review.service'

function createReviews() {
  const db = new Database(':memory:')
  runMigrations(db, path.join(__dirname, '../db/migrations'))
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?), (?, ?)')
    .run('user-a', new Date().toISOString(), 'user-b', new Date().toISOString())
  db.prepare(`
    INSERT INTO language_pairs (id, user_id, source_language, target_language, created_at)
    VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
  `).run(
    'pair-a', 'user-a', 'en', 'ru', new Date().toISOString(),
    'pair-b', 'user-b', 'en', 'ru', new Date().toISOString(),
  )
  const vocabulary = new VocabularyRepository(db)
  const reviews = new ReviewRepository(db)
  const service = new ReviewService(db, reviews, vocabulary)
  return { db, vocabulary, reviews, service }
}

function createItem(vocabulary: VocabularyRepository, userId: string, text: string) {
  return vocabulary.create({
    userId,
    languagePairId: userId === 'user-a' ? 'pair-a' : 'pair-b',
    text,
    normalizedText: text.toLowerCase(),
    itemType: 'word',
    translations: [`${text}-translation`],
    examples: [],
    status: 'inbox',
  })
}

test('learns only current user inbox items and is idempotent', () => {
  const { db, vocabulary, reviews, service } = createReviews()
  const itemA = createItem(vocabulary, 'user-a', 'alpha')
  const itemB = createItem(vocabulary, 'user-b', 'bravo')
  const now = new Date('2026-09-18T12:00:00.000Z')

  assert.equal(service.startLearning('user-a', 'pair-a', now), 1)
  assert.equal(service.startLearning('user-a', 'pair-a', now), 0)
  assert.equal(vocabulary.findByIdForUser('user-a', itemA.id)?.status, 'learning')
  assert.equal(vocabulary.findByIdForUser('user-b', itemB.id)?.status, 'inbox')
  assert.equal(reviews.countDue('user-a', now), 1)
  assert.equal(reviews.countDue('user-b', now), 0)
  const due = reviews.findDueForUser('user-a', now, 10)
  assert.equal(due[0]?.state.id, reviews.getState('user-a', itemA.id)?.id)
  assert.equal(due[0]?.item.id, itemA.id)
  assert.equal(reviews.getState('user-a', itemA.id)?.level, 0)
  assert.equal(reviews.getState('user-b', itemA.id), null)
  db.close()
})

test('learns inbox items only for the requested language pair', () => {
  const { db, vocabulary, reviews, service } = createReviews()
  const pairAItem = createItem(vocabulary, 'user-a', 'alpha')
  const now = new Date('2026-09-18T12:00:00.000Z')
  db.prepare('INSERT INTO language_pairs (id, user_id, source_language, target_language, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('pair-c', 'user-a', 'de', 'ru', now.toISOString())
  const pairCItem = vocabulary.create({
    userId: 'user-a', languagePairId: 'pair-c', text: 'beta', normalizedText: 'beta',
    itemType: 'word', translations: ['beta'], examples: [], status: 'inbox',
  })

  assert.equal(service.startLearning('user-a', 'pair-a', now), 1)
  assert.equal(vocabulary.findByIdForUser('user-a', pairAItem.id)?.status, 'learning')
  assert.equal(vocabulary.findByIdForUser('user-a', pairCItem.id)?.status, 'inbox')
  assert.equal(reviews.getState('user-a', pairCItem.id), null)
  db.close()
})

test('filters due reviews by language pair when requested', () => {
  const { db, vocabulary, service } = createReviews()
  db.prepare('INSERT INTO language_pairs (id, user_id, source_language, target_language, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('pair-c', 'user-a', 'de', 'ru', new Date().toISOString())
  const first = createItem(vocabulary, 'user-a', 'alpha')
  const second = vocabulary.create({
    userId: 'user-a', languagePairId: 'pair-c', text: 'beta', normalizedText: 'beta',
    itemType: 'word', translations: ['beta'], examples: [], status: 'inbox',
  })
  const now = new Date('2026-09-18T12:00:00.000Z')
  service.startLearning('user-a', 'pair-a', now)
  service.startLearning('user-a', 'pair-c', now)

  assert.deepEqual(service.getDue('user-a', now, 10, 'pair-a').map(({ item }) => item.id), [first.id])
  assert.deepEqual(service.getDue('user-a', now, 10, 'pair-c').map(({ item }) => item.id), [second.id])
  db.close()
})

test('answers atomically update scoped state and preserve source-to-target history', () => {
  const { db, vocabulary, reviews, service } = createReviews()
  const item = createItem(vocabulary, 'user-a', 'alpha')
  const now = new Date('2026-09-18T12:00:00.000Z')
  service.startLearning('user-a', 'pair-a', now)

  const outcome = service.answer('user-a', item.id, 'correct', now)

  assert.deepEqual(outcome, {
    itemId: item.id,
    result: 'correct',
    levelBefore: 0,
    levelAfter: 1,
    nextReviewAt: '2026-09-19T12:00:00.000Z',
    status: 'learning',
  })
  assert.equal(reviews.getState('user-a', item.id)?.level, 1)
  assert.deepEqual(db.prepare('SELECT direction, result, level_before, level_after FROM reviews').get(), {
    direction: 'source_to_target', result: 'correct', level_before: 0, level_after: 1,
  })
  assert.equal(reviews.countReviewedToday('user-a', now), 1)
  assert.equal(reviews.countReviewedToday('user-b', now), 0)
  db.close()
})

test('rejects another user and transitions known items at level six', () => {
  const { db, vocabulary, reviews, service } = createReviews()
  const itemA = createItem(vocabulary, 'user-a', 'alpha')
  const itemB = createItem(vocabulary, 'user-b', 'bravo')
  const now = new Date('2026-09-18T12:00:00.000Z')
  service.startLearning('user-a', 'pair-a', now)
  assert.throws(() => service.answer('user-b', itemA.id, 'correct', now), /Review item is not available/)

  reviews.updateState('user-a', itemA.id, {
    level: 6,
    nextReviewAt: now.toISOString(),
  })
  vocabulary.update('user-a', itemA.id, { status: 'learning' })
  const known = service.answer('user-a', itemA.id, 'correct', now)
  assert.equal(known.levelAfter, 6)
  assert.equal(known.status, 'known')
  assert.equal(vocabulary.findByIdForUser('user-a', itemA.id)?.status, 'known')

  const stateB = reviews.createState('user-b', itemB.id, now)
  assert.equal(stateB.level, 0)
  vocabulary.update('user-b', itemB.id, { status: 'known' })
  const learning = service.answer('user-b', itemB.id, 'incorrect', now)
  assert.equal(learning.status, 'learning')
  assert.equal(vocabulary.findByIdForUser('user-b', itemB.id)?.status, 'learning')
  db.close()
})

test('orders due reviews and counts UTC review day bounds', () => {
  const { db, vocabulary, reviews, service } = createReviews()
  const first = createItem(vocabulary, 'user-a', 'first')
  const second = createItem(vocabulary, 'user-a', 'second')
  const now = new Date('2026-09-18T23:30:00.000Z')
  service.startLearning('user-a', 'pair-a', now)
  reviews.updateState('user-a', first.id, { level: 0, nextReviewAt: '2026-09-18T10:00:00.000Z' })
  reviews.updateState('user-a', second.id, { level: 0, nextReviewAt: '2026-09-18T11:00:00.000Z' })
  reviews.createReview('user-a', first.id, {
    direction: 'source_to_target', result: 'correct', levelBefore: 0, levelAfter: 1,
    reviewedAt: '2026-09-18T00:00:00.000Z',
  })
  reviews.createReview('user-a', second.id, {
    direction: 'source_to_target', result: 'correct', levelBefore: 0, levelAfter: 1,
    reviewedAt: '2026-09-17T23:59:59.999Z',
  })

  assert.deepEqual(reviews.findDueForUser('user-a', now, 10).map(({ item }) => item.id), [first.id, second.id])
  assert.equal(reviews.countReviewedToday('user-a', now), 1)
  db.close()
})
