import type { SqliteDatabase } from '../db/database'
import { VocabularyRepository } from '../vocabulary/vocabulary.repository'
import { REVIEW_INTERVALS, calculateNextReview, type ReviewResult } from './review.algorithm'
import { ReviewRepository } from './review.repository'
import type { DueReview, ReviewOutcome } from './review.types'

export class ReviewService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly reviews: ReviewRepository,
    private readonly vocabulary: VocabularyRepository,
  ) {}

  startLearning(userId: string, languagePairId: string, now: Date): number {
    return this.db.transaction(() => {
      const items = this.vocabulary.listForUser(userId, { status: 'inbox', languagePairId })
      for (const item of items) {
        this.vocabulary.update(userId, item.id, { status: 'learning' })
        this.reviews.createState(userId, item.id, now)
      }
      return items.length
    })()
  }

  startLearningItem(userId: string, languagePairId: string, itemId: string, now: Date): boolean {
    return this.db.transaction(() => {
      const item = this.vocabulary.findByIdForUser(userId, itemId)
      if (!item || item.languagePairId !== languagePairId || item.status !== 'inbox') return false

      if (!this.vocabulary.update(userId, item.id, { status: 'learning' })) {
        throw new Error('Review item is not available')
      }
      this.reviews.createState(userId, item.id, now)
      return true
    })()
  }

  getDue(userId: string, now: Date, limit: number, languagePairId?: string): DueReview[] {
    return this.reviews.findDueForUser(userId, now, limit, languagePairId)
  }

  countDue(userId: string, now: Date, languagePairId: string): number {
    return this.reviews.countDueForPair(userId, languagePairId, now)
  }

  countReviewedToday(userId: string, now: Date): number {
    return this.reviews.countReviewedToday(userId, now)
  }

  answer(userId: string, itemId: string, result: ReviewResult, now: Date): ReviewOutcome {
    return this.db.transaction(() => {
      const item = this.vocabulary.findByIdForUser(userId, itemId)
      const state = this.reviews.getState(userId, itemId)
      if (!item || !state) throw new Error('Review item is not available')

      const next = calculateNextReview({ level: state.level, result, now })
      this.reviews.createReview(userId, itemId, {
        direction: 'source_to_target',
        result,
        levelBefore: state.level,
        levelAfter: next.level,
        reviewedAt: now.toISOString(),
      })
      this.reviews.updateState(userId, itemId, {
        level: next.level,
        nextReviewAt: next.nextReviewAt.toISOString(),
      })

      let status = item.status
      if (result === 'correct' && next.level === REVIEW_INTERVALS.length - 1) status = 'known'
      if (result === 'incorrect' && item.status === 'known') status = 'learning'
      if (status !== item.status) this.vocabulary.update(userId, itemId, { status })

      return {
        itemId,
        result,
        levelBefore: state.level,
        levelAfter: next.level,
        nextReviewAt: next.nextReviewAt.toISOString(),
        status,
      }
    })()
  }
}
