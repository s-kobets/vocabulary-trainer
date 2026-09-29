import { strict as assert } from 'node:assert'
import test from 'node:test'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../db/database'
import { OpenAiDictionaryError } from '../dictionary/dictionary.errors'
import { LanguagePairRepository } from '../languages/language-pair.repository'
import { VocabularyRepository } from './vocabulary.repository'
import { EnrichmentWorker } from './enrichment.worker'

test('logs safe metadata when enrichment retry fails', async () => {
  const db = new Database(':memory:')
  runMigrations(db, path.join(__dirname, '../db/migrations'))
  const now = new Date().toISOString()
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('user-a', now)
  db.prepare(`
    INSERT INTO language_pairs (id, user_id, source_language, target_language, is_default, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run('pair-a', 'user-a', 'en', 'ru', now)
  const vocabulary = new VocabularyRepository(db)
  const item = vocabulary.create({
    userId: 'user-a', languagePairId: 'pair-a', text: 'sensitive word', normalizedText: 'sensitive word',
    itemType: 'word', translations: [], examples: [], status: 'inbox', enrichmentStatus: 'pending',
  })
  const loggerCalls: unknown[][] = []
  const worker = new EnrichmentWorker(vocabulary, {
    lookup: async () => {
      throw new OpenAiDictionaryError('OpenAI request failed', {
        kind: 'http', status: 429, apiCode: 'insufficient_quota', requestId: 'req-retry',
      })
    },
  }, new LanguagePairRepository(db), { error: (...args: unknown[]) => loggerCalls.push(args) })

  await worker.runOnce()

  const fields = loggerCalls[0][0] as Record<string, unknown>
  assert.equal(vocabulary.findByIdForUser('user-a', item.id)?.enrichmentStatus, 'pending')
  assert.equal(fields.status, 429)
  assert.equal(fields.requestId, 'req-retry')
  assert.equal(JSON.stringify(fields).includes('sensitive word'), false)
  db.close()
})
