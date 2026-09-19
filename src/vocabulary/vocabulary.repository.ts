import crypto from 'node:crypto'
import type { SqliteDatabase } from '../db/database'
import type {
  VocabularyExample,
  VocabularyItem,
  VocabularyItemType,
  VocabularyStatus,
} from './vocabulary.types'
import { classifyText, normalizeText } from './normalize'

export type VocabularyCreateInput = {
  userId: string
  languagePairId: string
  text: string
  normalizedText: string
  itemType: VocabularyItemType
  translations: string[]
  transcription?: string
  partOfSpeech?: string
  examples: VocabularyExample[]
  status: VocabularyStatus
}

export type VocabularyListFilters = {
  status?: VocabularyStatus
  languagePairId?: string
  limit?: number
}

export type VocabularyUpdatePatch = {
  text?: string
  translations?: string[]
  transcription?: string | null
  partOfSpeech?: string | null
  examples?: VocabularyExample[]
  status?: VocabularyStatus
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

const selectColumns = `
  SELECT id, user_id, language_pair_id, text, normalized_text, item_type,
    translations_json, transcription, part_of_speech, examples_json, status,
    created_at, updated_at
  FROM vocabulary_items
`

function mapVocabulary(row: VocabularyRow): VocabularyItem {
  return {
    id: row.id,
    userId: row.user_id,
    languagePairId: row.language_pair_id,
    text: row.text,
    normalizedText: row.normalized_text,
    itemType: row.item_type,
    translations: JSON.parse(row.translations_json) as string[],
    ...(row.transcription === null ? {} : { transcription: row.transcription }),
    ...(row.part_of_speech === null ? {} : { partOfSpeech: row.part_of_speech }),
    examples: JSON.parse(row.examples_json) as VocabularyExample[],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class VocabularyRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: VocabularyCreateInput): VocabularyItem {
    const now = new Date().toISOString()
    const item: VocabularyItem = {
      id: crypto.randomUUID(),
      userId: input.userId,
      languagePairId: input.languagePairId,
      text: input.text,
      normalizedText: input.normalizedText,
      itemType: input.itemType,
      translations: input.translations,
      ...(input.transcription === undefined ? {} : { transcription: input.transcription }),
      ...(input.partOfSpeech === undefined ? {} : { partOfSpeech: input.partOfSpeech }),
      examples: input.examples,
      status: input.status,
      createdAt: now,
      updatedAt: now,
    }

    this.db.prepare(`
      INSERT INTO vocabulary_items
        (id, user_id, language_pair_id, text, normalized_text, item_type,
         translations_json, transcription, part_of_speech, examples_json,
         status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.userId,
      item.languagePairId,
      item.text,
      item.normalizedText,
      item.itemType,
      JSON.stringify(item.translations),
      item.transcription ?? null,
      item.partOfSpeech ?? null,
      JSON.stringify(item.examples),
      item.status,
      item.createdAt,
      item.updatedAt,
    )
    return item
  }

  findByIdForUser(userId: string, itemId: string): VocabularyItem | null {
    const row = this.db.prepare(`${selectColumns} WHERE user_id = ? AND id = ?`)
      .get(userId, itemId) as VocabularyRow | undefined
    return row ? mapVocabulary(row) : null
  }

  findByNormalizedText(userId: string, pairId: string, normalizedText: string): VocabularyItem | null {
    const row = this.db.prepare(`
      ${selectColumns}
      WHERE user_id = ? AND language_pair_id = ? AND normalized_text = ?
    `).get(userId, pairId, normalizedText) as VocabularyRow | undefined
    return row ? mapVocabulary(row) : null
  }

  listForUser(userId: string, filters: VocabularyListFilters = {}): VocabularyItem[] {
    const conditions = ['user_id = ?']
    const parameters: unknown[] = [userId]
    if (filters.status) {
      conditions.push('status = ?')
      parameters.push(filters.status)
    }
    if (filters.languagePairId) {
      conditions.push('language_pair_id = ?')
      parameters.push(filters.languagePairId)
    }
    let sql = `${selectColumns} WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, id DESC`
    if (filters.limit !== undefined) {
      sql += ' LIMIT ?'
      parameters.push(filters.limit)
    }
    return (this.db.prepare(sql).all(...parameters) as VocabularyRow[]).map(mapVocabulary)
  }

  update(userId: string, itemId: string, patch: VocabularyUpdatePatch): VocabularyItem | null {
    const fields: string[] = []
    const parameters: unknown[] = []
    const normalizedText = patch.text === undefined ? undefined : normalizeText(patch.text)
    const values: [string, unknown][] = [
      ['text', patch.text],
      ['normalized_text', normalizedText],
      ['item_type', normalizedText === undefined ? undefined : classifyText(normalizedText)],
      ['translations_json', patch.translations === undefined ? undefined : JSON.stringify(patch.translations)],
      ['transcription', patch.transcription],
      ['part_of_speech', patch.partOfSpeech],
      ['examples_json', patch.examples === undefined ? undefined : JSON.stringify(patch.examples)],
      ['status', patch.status],
    ]
    for (const [field, value] of values) {
      if (value !== undefined) {
        fields.push(`${field} = ?`)
        parameters.push(value)
      }
    }
    fields.push('updated_at = ?')
    parameters.push(new Date().toISOString(), userId, itemId)
    this.db.prepare(`
      UPDATE vocabulary_items SET ${fields.join(', ')}
      WHERE user_id = ? AND id = ?
    `).run(...parameters)
    return this.findByIdForUser(userId, itemId)
  }

  delete(userId: string, itemId: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM vocabulary_items WHERE user_id = ? AND id = ?',
    ).run(userId, itemId)
    return result.changes === 1
  }

  countByStatus(userId: string, status: VocabularyStatus): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM vocabulary_items WHERE user_id = ? AND status = ?
    `).get(userId, status) as { count: number }
    return row.count
  }

  search(userId: string, query: string): VocabularyItem[] {
    const pattern = `%${query.trim().toLowerCase()}%`
    return (this.db.prepare(`
      ${selectColumns}
      WHERE user_id = ? AND (LOWER(text) LIKE ? OR normalized_text LIKE ?)
      ORDER BY created_at, id
    `).all(userId, pattern, pattern) as VocabularyRow[]).map(mapVocabulary)
  }
}
