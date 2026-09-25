import crypto from 'node:crypto'
import type { SqliteDatabase } from '../db/database'
import type { LanguagePair } from './language-pair.types'

export type LanguagePairInput = {
  sourceLanguage: string
  targetLanguage: string
}

type LanguagePairRow = {
  id: string
  user_id: string
  source_language: string
  target_language: string
  is_default: number
  created_at: string
}

function mapLanguagePair(row: LanguagePairRow): LanguagePair {
  return {
    id: row.id,
    userId: row.user_id,
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  }
}

const selectColumns = `
  SELECT id, user_id, source_language, target_language, is_default, created_at
  FROM language_pairs
`

export class LanguagePairRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(userId: string, input: LanguagePairInput): LanguagePair {
    const pair = {
      id: crypto.randomUUID(),
      userId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      isDefault: false,
      createdAt: new Date().toISOString(),
    }
    this.db.prepare(`
      INSERT INTO language_pairs
        (id, user_id, source_language, target_language, is_default, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(
      pair.id,
      pair.userId,
      pair.sourceLanguage,
      pair.targetLanguage,
      pair.createdAt,
    )
    return pair
  }

  findByIdForUser(userId: string, pairId: string): LanguagePair | null {
    const row = this.db.prepare(`${selectColumns} WHERE user_id = ? AND id = ?`)
      .get(userId, pairId) as LanguagePairRow | undefined
    return row ? mapLanguagePair(row) : null
  }

  findForUser(userId: string): LanguagePair[] {
    const rows = this.db.prepare(`${selectColumns} WHERE user_id = ? ORDER BY created_at, id`)
      .all(userId) as LanguagePairRow[]
    return rows.map(mapLanguagePair)
  }

  findDefaultForUser(userId: string): LanguagePair | null {
    const row = this.db.prepare(`${selectColumns} WHERE user_id = ? AND is_default = 1`)
      .get(userId) as LanguagePairRow | undefined
    return row ? mapLanguagePair(row) : null
  }

  findByLanguagesForUser(
    userId: string,
    source: string,
    target: string,
  ): LanguagePair | null {
    const row = this.db.prepare(`
      ${selectColumns}
      WHERE user_id = ? AND source_language = ? AND target_language = ?
    `).get(userId, source, target) as LanguagePairRow | undefined
    return row ? mapLanguagePair(row) : null
  }

  setDefault(userId: string, pairId: string): void {
    this.db.prepare(
      'UPDATE language_pairs SET is_default = 0 WHERE user_id = ?',
    ).run(userId)
    const result = this.db.prepare(
      'UPDATE language_pairs SET is_default = 1 WHERE user_id = ? AND id = ?',
    ).run(userId, pairId)
    if (result.changes !== 1) {
      throw new Error(`Language pair ${pairId} does not belong to user ${userId}`)
    }
  }

  countVocabularyForUserPair(userId: string, pairId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM vocabulary_items
      WHERE user_id = ? AND language_pair_id = ?
    `).get(userId, pairId) as { count: number }
    return row.count
  }

  deleteForUser(userId: string, pairId: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM language_pairs WHERE user_id = ? AND id = ?',
    ).run(userId, pairId)
    return result.changes === 1
  }
}
