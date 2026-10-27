import { strict as assert } from 'node:assert'
import test from 'node:test'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../db/database'
import { OpenAiDictionaryError } from '../dictionary/dictionary.errors'
import { LanguagePairRepository } from '../languages/language-pair.repository'
import { VocabularyRepository } from './vocabulary.repository'
import { EnrichmentWorker } from './enrichment.worker'
import { VocabularyService } from './vocabulary.service'
import type { DictionaryProvider } from '../dictionary/dictionary.types'

function createEnrichment(t: test.TestContext, provider: DictionaryProvider) {
  const db = new Database(':memory:')
  t.after(() => db.close())
  runMigrations(db, path.join(__dirname, '../db/migrations'))
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('user-a', new Date().toISOString())
  const pairs = new LanguagePairRepository(db)
  const pair = pairs.create('user-a', { sourceLanguage: 'en', targetLanguage: 'ru' })
  const vocabulary = new VocabularyRepository(db)
  const service = new VocabularyService(vocabulary, provider)
  const worker = new EnrichmentWorker(vocabulary, service, pairs)
  const item = vocabulary.create({
    userId: 'user-a', languagePairId: pair.id, text: 'example', normalizedText: 'example',
    itemType: 'word', translations: [], examples: [], status: 'inbox', enrichmentStatus: 'pending',
  })
  return { db, vocabulary, service, worker, pair, item }
}

test('manually translating a pending card stops automatic retries', async (t) => {
  let calls = 0
  const { vocabulary, service, worker, item } = createEnrichment(t, {
    lookup: async () => { calls++; return { translations: ['automatic'] } },
  })
  service.replaceTranslations('user-a', item.id, ['manual'])
  await worker.runOnce()
  assert.deepEqual(vocabulary.findByIdForUser('user-a', item.id)?.translations, ['manual'])
  assert.equal(vocabulary.findByIdForUser('user-a', item.id)?.enrichmentStatus, undefined)
  assert.equal(calls, 0)
})

for (const fails of [false, true]) {
  test(`manual translations survive a late enrichment ${fails ? 'failure' : 'success'}`, async (t) => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { vocabulary, service, worker, item } = createEnrichment(t, {
      lookup: async () => {
        await gate
        if (fails) throw new Error('Provider failed')
        return { translations: ['automatic'] }
      },
    })
    const retry = worker.runOnce()
    service.replaceTranslations('user-a', item.id, ['manual'])
    release()
    await retry
    assert.deepEqual(vocabulary.findByIdForUser('user-a', item.id)?.translations, ['manual'])
    assert.equal(vocabulary.findByIdForUser('user-a', item.id)?.enrichmentStatus, undefined)
  })

  test(`manual translations survive an immediate lookup ${fails ? 'failure' : 'success'}`, async (t) => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { service, vocabulary, pair } = createEnrichment(t, {
      lookup: async () => {
        await gate
        if (fails) throw new Error('Provider failed')
        return { translations: ['automatic'] }
      },
    })
    const capture = service.addText('user-a', pair, 'new word')
    const pending = vocabulary.findByNormalizedText('user-a', pair.id, 'new word')!
    service.replaceTranslations('user-a', pending.id, ['manual'])
    release()
    const result = await capture
    assert.deepEqual(result.item.translations, ['manual'])
    assert.equal(result.pending, undefined)
  })
}

test('worker does not repeat an immediate lookup that is still in progress', async (t) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  const { service, worker, vocabulary, pair, item } = createEnrichment(t, {
    lookup: async () => { calls++; await gate; return { translations: ['automatic'] } },
  })
  vocabulary.delete('user-a', item.id)
  const capture = service.addText('user-a', pair, 'new word')
  const retry = worker.runOnce()
  release()
  await Promise.all([capture, retry])
  assert.equal(calls, 1)
})

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
  const logger = { error: (...args: unknown[]) => loggerCalls.push(args) }
  const service = new VocabularyService(vocabulary, {
    lookup: async () => {
      throw new OpenAiDictionaryError('OpenAI request failed', {
        kind: 'http', status: 429, apiCode: 'insufficient_quota', requestId: 'req-retry',
      })
    },
  }, logger)
  const worker = new EnrichmentWorker(vocabulary, service, new LanguagePairRepository(db), logger)

  await worker.runOnce()

  const fields = loggerCalls[0][0] as Record<string, unknown>
  assert.equal(vocabulary.findByIdForUser('user-a', item.id)?.enrichmentStatus, 'pending')
  assert.equal(fields.status, 429)
  assert.equal(fields.requestId, 'req-retry')
  assert.equal(JSON.stringify(fields).includes('sensitive word'), false)
  db.close()
})
