import type { VocabularyItem, VocabularyStatus } from '../vocabulary/vocabulary.types'
import type { ReviewResult } from './review.algorithm'

export type ReviewState = {
  id: string
  userId: string
  vocabularyItemId: string
  level: number
  nextReviewAt: string
  createdAt: string
  updatedAt: string
}

export type Review = {
  id: string
  userId: string
  vocabularyItemId: string
  direction: 'source_to_target'
  result: ReviewResult
  levelBefore: number
  levelAfter: number
  reviewedAt: string
}

export type DueReview = {
  item: VocabularyItem
  state: ReviewState
}

export type ReviewOutcome = {
  itemId: string
  result: ReviewResult
  levelBefore: number
  levelAfter: number
  nextReviewAt: string
  status: VocabularyStatus
}
