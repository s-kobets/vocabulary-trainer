import { strict as assert } from 'node:assert'
import test from 'node:test'
import { calculateNextReview } from './review.algorithm'

const now = new Date('2026-09-18T12:00:00.000Z')

test('calculates exact intervals and lower boundary', () => {
  assert.deepEqual(calculateNextReview({ level: 0, result: 'correct', now }), {
    level: 1,
    nextReviewAt: new Date('2026-09-19T12:00:00.000Z'),
  })
  assert.deepEqual(calculateNextReview({ level: 1, result: 'correct', now }), {
    level: 2,
    nextReviewAt: new Date('2026-09-21T12:00:00.000Z'),
  })
  assert.deepEqual(calculateNextReview({ level: 4, result: 'incorrect', now }), {
    level: 3,
    nextReviewAt: new Date('2026-09-19T12:00:00.000Z'),
  })
  assert.deepEqual(calculateNextReview({ level: 0, result: 'incorrect', now }), {
    level: 0,
    nextReviewAt: new Date('2026-09-19T12:00:00.000Z'),
  })
})

test('clamps maximum level without changing its boundary interval', () => {
  assert.deepEqual(calculateNextReview({ level: 6, result: 'correct', now }), {
    level: 6,
    nextReviewAt: new Date('2026-11-17T12:00:00.000Z'),
  })
  assert.equal(calculateNextReview({ level: 99, result: 'correct', now }).level, 6)
})
