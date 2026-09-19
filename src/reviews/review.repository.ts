import crypto from 'node:crypto'
import type { SqliteDatabase } from '../db/database'
import type { VocabularyExample, VocabularyItem, VocabularyItemType, VocabularyStatus } from '../vocabulary/vocabulary.types'
import type { DueReview, Review, ReviewState } from './review.types'
import type { ReviewResult } from './review.algorithm'

export type ReviewStatePatch = {
  level?: number
  nextReviewAt?: string
}

export type ReviewCreateInput = {
  direction: 'source_to_target'
  result: ReviewResult
  levelBefore: number
  levelAfter: number
  reviewedAt: string
}

type ReviewStateRow = {
  id: string
  user_id: string
  vocabulary_item_id: string
  level: number
  next_review_at: string
  created_at: string
  updated_at: string
}

type VocabularyRow = {
  id: string
  user_id: string
  language_pair_id: string
  text: string
  normalized_text: string
  item_type: VocabularyItemType
  translations_json: string
  transcription: string | null
  part_of_speech: string | null
  examples_json: string
  status: VocabularyStatus
  created_at: string
  updated_at: string
}

type DueRow = {
  state_id: string
  state_user_id: string
  vocabulary_item_id: string
  level: number
  next_review_at: string
  state_created_at: string
  state_updated_at: string
  item_id: string
  item_user_id: string
  language_pair_id: string
  text: string
  normalized_text: string
  item_type: VocabularyItemType
  translations_json: string
  transcription: string | null
  part_of_speech: string | null
  examples_json: string
  status: VocabularyStatus
  item_created_at: string
  item_updated_at: string
}

function mapState(row: ReviewStateRow | DueRow): ReviewState {
  const due = 'state_id' in row
  return {
    id: due ? row.state_id : row.id,
    userId: due ? row.state_user_id : row.user_id,
    vocabularyItemId: row.vocabulary_item_id,
    level: row.level,
    nextReviewAt: row.next_review_at,
    createdAt: due ? row.state_created_at : row.created_at,
    updatedAt: due ? row.state_updated_at : row.updated_at,
  }
}

function mapItem(row: VocabularyRow | DueRow): VocabularyItem {
  const due = 'item_id' in row
  return {
    id: due ? row.item_id : row.id,
    userId: due ? row.item_user_id : row.user_id,
    languagePairId: row.language_pair_id,
    text: row.text,
    normalizedText: row.normalized_text,
    itemType: row.item_type,
    translations: JSON.parse(row.translations_json) as string[],
    ...(row.transcription === null ? {} : { transcription: row.transcription }),
    ...(row.part_of_speech === null ? {} : { partOfSpeech: row.part_of_speech }),
    examples: JSON.parse(row.examples_json) as VocabularyExample[],
    status: row.status,
    createdAt: due ? row.item_created_at : row.created_at,
    updatedAt: due ? row.item_updated_at : row.updated_at,
  }
}

export class ReviewRepository {
  constructor(private readonly db: SqliteDatabase) {}

  findDueForUser(userId: string, now: Date, limit: number): DueReview[] {
    const rows = this.db.prepare(`
      SELECT
        review_states.id AS state_id, review_states.user_id AS state_user_id,
        review_states.vocabulary_item_id, review_states.level, review_states.next_review_at,
        review_states.created_at AS state_created_at, review_states.updated_at AS state_updated_at,
        vocabulary_items.id AS item_id, vocabulary_items.user_id AS item_user_id,
        vocabulary_items.language_pair_id,
        vocabulary_items.text, vocabulary_items.normalized_text, vocabulary_items.item_type,
        vocabulary_items.translations_json, vocabulary_items.transcription,
        vocabulary_items.part_of_speech, vocabulary_items.examples_json,
        vocabulary_items.status, vocabulary_items.created_at AS item_created_at,
        vocabulary_items.updated_at AS item_updated_at
      FROM review_states
      JOIN vocabulary_items ON vocabulary_items.id = review_states.vocabulary_item_id
      WHERE review_states.user_id = ?
        AND vocabulary_items.user_id = ?
        AND vocabulary_items.status IN ('learning', 'known')
        AND review_states.next_review_at <= ?
      ORDER BY review_states.next_review_at, vocabulary_items.created_at
      LIMIT ?
    `).all(userId, userId, now.toISOString(), limit) as DueRow[]
    return rows.map((row) => ({ item: mapItem(row), state: mapState(row) }))
  }

  getState(userId: string, itemId: string): ReviewState | null {
    const row = this.db.prepare(`
      SELECT id, user_id, vocabulary_item_id, level, next_review_at, created_at, updated_at
      FROM review_states WHERE user_id = ? AND vocabulary_item_id = ?
    `).get(userId, itemId) as ReviewStateRow | undefined
    return row ? mapState(row) : null
  }

  createState(userId: string, itemId: string, now: Date): ReviewState {
    const state = {
      id: crypto.randomUUID(),
      userId,
      vocabularyItemId: itemId,
      level: 0,
      nextReviewAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO review_states
        (id, user_id, vocabulary_item_id, level, next_review_at, created_at, updated_at)
      SELECT ?, ?, id, 0, ?, ?, ? FROM vocabulary_items WHERE id = ? AND user_id = ?
    `).run(state.id, userId, state.nextReviewAt, state.createdAt, state.updatedAt, itemId, userId)
    if (result.changes === 0) {
      const existing = this.getState(userId, itemId)
      if (existing) return existing
      throw new Error('Review item is not available')
    }
    return state
  }

  updateState(userId: string, itemId: string, patch: ReviewStatePatch): ReviewState | null {
    const fields: string[] = []
    const parameters: unknown[] = []
    if (patch.level !== undefined) {
      fields.push('level = ?')
      parameters.push(patch.level)
    }
    if (patch.nextReviewAt !== undefined) {
      fields.push('next_review_at = ?')
      parameters.push(patch.nextReviewAt)
    }
    fields.push('updated_at = ?')
    parameters.push(new Date().toISOString(), userId, itemId)
    this.db.prepare(`
      UPDATE review_states SET ${fields.join(', ')}
      WHERE user_id = ? AND vocabulary_item_id = ?
    `).run(...parameters)
    return this.getState(userId, itemId)
  }

  createReview(userId: string, itemId: string, input: ReviewCreateInput): Review {
    const review: Review = {
      id: crypto.randomUUID(),
      userId,
      vocabularyItemId: itemId,
      direction: input.direction,
      result: input.result,
      levelBefore: input.levelBefore,
      levelAfter: input.levelAfter,
      reviewedAt: input.reviewedAt,
    }
    const result = this.db.prepare(`
      INSERT INTO reviews
        (id, user_id, vocabulary_item_id, direction, result, level_before, level_after, reviewed_at)
      SELECT ?, ?, id, ?, ?, ?, ?, ?
      FROM vocabulary_items WHERE id = ? AND user_id = ?
    `).run(
      review.id, userId, review.direction, review.result, review.levelBefore,
      review.levelAfter, review.reviewedAt, itemId, userId,
    )
    if (result.changes !== 1) throw new Error('Review item is not available')
    return review
  }

  countDue(userId: string, now: Date): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM review_states JOIN vocabulary_items ON vocabulary_items.id = review_states.vocabulary_item_id
      WHERE review_states.user_id = ? AND vocabulary_items.user_id = ?
        AND vocabulary_items.status IN ('learning', 'known')
        AND review_states.next_review_at <= ?
    `).get(userId, userId, now.toISOString()) as { count: number }
    return row.count
  }

  countReviewedToday(userId: string, now: Date): number {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM reviews
      WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ?
    `).get(userId, start.toISOString(), end.toISOString()) as { count: number }
    return row.count
  }
}
