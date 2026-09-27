import { strict as assert } from 'node:assert'
import test from 'node:test'
import Database from 'better-sqlite3'
import path from 'node:path'
import { runMigrations } from '../db/database'
import type { DictionaryInput, DictionaryResult } from '../dictionary/dictionary.types'
import type { LanguagePair } from '../languages/language-pair.types'
import { VocabularyRepository } from './vocabulary.repository'
import { VocabularyService } from './vocabulary.service'

function createVocabulary() {
  const db = new Database(':memory:')
  runMigrations(db, path.join(__dirname, '../db/migrations'))
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?), (?, ?)')
    .run('user-a', new Date().toISOString(), 'user-b', new Date().toISOString())
  db.prepare(`
    INSERT INTO language_pairs (id, user_id, source_language, target_language, created_at)
    VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
  `).run(
    'pair-a', 'user-a', 'en', 'ru', new Date().toISOString(),
    'pair-b', 'user-a', 'de', 'ru', new Date().toISOString(),
  )
  return { db, repository: new VocabularyRepository(db) }
}

function createInput(overrides: Partial<Parameters<VocabularyRepository['create']>[0]> = {}) {
  return {
    userId: 'user-a',
    languagePairId: 'pair-a',
    text: 'Reliable',
    normalizedText: 'reliable',
    itemType: 'word' as const,
    translations: ['mock translation'],
    examples: [{ source: 'Reliable service', target: 'dependable service' }],
    status: 'inbox' as const,
    ...overrides,
  }
}

function createPair(overrides: Partial<LanguagePair> = {}): LanguagePair {
  return {
    id: 'pair-a',
    userId: 'user-a',
    sourceLanguage: 'en',
    targetLanguage: 'ru',
    isDefault: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

class RecordingDictionaryProvider {
  readonly inputs: DictionaryInput[] = []

  async lookup(input: DictionaryInput): Promise<DictionaryResult> {
    this.inputs.push(input)
    return {
      translations: ['dependable'],
      examples: [{ source: 'A reliable service' }],
    }
  }
}

test('scopes item reads and writes to the owning user', () => {
  const { db, repository } = createVocabulary()
  const item = repository.create(createInput())

  assert.equal(repository.findByIdForUser('user-a', item.id)?.text, 'Reliable')
  assert.equal(repository.findByIdForUser('user-b', item.id), null)
  assert.equal(repository.update('user-b', item.id, { status: 'known' }), null)
  assert.equal(repository.delete('user-b', item.id), false)
  assert.equal(repository.findByNormalizedText('user-a', 'pair-b', 'reliable'), null)
  db.close()
})

test('maps JSON fields and supports pair-scoped duplicates', () => {
  const { db, repository } = createVocabulary()
  const first = repository.create(createInput())
  const second = repository.create(createInput({ languagePairId: 'pair-b' }))

  assert.deepEqual(first.examples, [{ source: 'Reliable service', target: 'dependable service' }])
  assert.deepEqual(repository.findByNormalizedText('user-a', 'pair-a', 'reliable'), first)
  assert.deepEqual(repository.findByNormalizedText('user-a', 'pair-b', 'reliable'), second)
  assert.throws(
    () => repository.create(createInput()),
    /UNIQUE constraint failed: vocabulary_items.user_id, vocabulary_items.language_pair_id, vocabulary_items.normalized_text/,
  )
  db.close()
})

test('counts and lists vocabulary within the requested language pair', () => {
  const { db, repository } = createVocabulary()
  const first = repository.create(createInput())
  repository.create(createInput({ languagePairId: 'pair-b', text: 'reliable', normalizedText: 'reliable' }))

  assert.equal(repository.countByStatus('user-a', 'inbox', 'pair-a'), 1)
  assert.equal(repository.countByStatus('user-a', 'inbox', 'pair-b'), 1)
  assert.deepEqual(
    repository.listForUser('user-a', { status: 'inbox', languagePairId: 'pair-a' }).map(({ id }) => id),
    [first.id],
  )
  db.close()
})

test('updates supported fields, lists, searches, and counts by status', () => {
  const { db, repository } = createVocabulary()
  const item = repository.create(createInput())

  const updated = repository.update('user-a', item.id, {
    text: 'Reliable service',
    translations: ['dependable service'],
    transcription: '/reliable/',
    partOfSpeech: 'adjective',
    examples: [{ source: 'A reliable service' }],
    status: 'known',
  })

  assert.equal(updated?.text, 'Reliable service')
  assert.equal(updated?.normalizedText, 'reliable service')
  assert.equal(updated?.itemType, 'phrase')
  assert.deepEqual(updated?.translations, ['dependable service'])
  assert.equal(updated?.transcription, '/reliable/')
  assert.equal(updated?.partOfSpeech, 'adjective')
  assert.deepEqual(repository.listForUser('user-a', { status: 'known' }), [updated])
  assert.equal(repository.countByStatus('user-a', 'known'), 1)
  assert.deepEqual(repository.search('user-a', 'reliable'), [updated])
  assert.deepEqual(repository.search('user-b', 'reliable'), [])
  db.close()
})

test('text updates recompute duplicate key and reject duplicate normalized text', () => {
  const { db, repository } = createVocabulary()
  const first = repository.create(createInput())
  repository.create(createInput({ text: 'other', normalizedText: 'other' }))

  assert.throws(
    () => repository.update('user-a', first.id, { text: '  Other  ' }),
    /UNIQUE constraint failed/,
  )
  db.close()
})

test('lists newest vocabulary items first when limited', () => {
  const { db, repository } = createVocabulary()
  const older = repository.create(createInput({ text: 'older', normalizedText: 'older' }))
  const newer = repository.create(createInput({ text: 'newer', normalizedText: 'newer' }))
  db.prepare('UPDATE vocabulary_items SET created_at = ? WHERE id = ?').run('2026-09-18T10:00:00.000Z', older.id)
  db.prepare('UPDATE vocabulary_items SET created_at = ? WHERE id = ?').run('2026-09-18T11:00:00.000Z', newer.id)

  assert.deepEqual(
    repository.listForUser('user-a', { status: 'inbox', limit: 1 }).map(({ text }) => text),
    ['newer'],
  )
  db.close()
})

test('captures a normalized item with dictionary data in inbox', async () => {
  const { db, repository } = createVocabulary()
  const provider = new RecordingDictionaryProvider()
  const service = new VocabularyService(repository, provider)

  const result = await service.addText('user-a', createPair(), '  Reliable   Service ')

  assert.equal(result.duplicate, false)
  assert.equal(result.item.text, 'reliable service')
  assert.equal(result.item.normalizedText, 'reliable service')
  assert.equal(result.item.itemType, 'phrase')
  assert.equal(result.item.status, 'inbox')
  assert.deepEqual(result.item.translations, ['dependable'])
  assert.deepEqual(provider.inputs, [{
    text: 'reliable service',
    sourceLanguage: 'en',
    targetLanguage: 'ru',
  }])
  db.close()
})

test('returns a user and pair scoped duplicate without dictionary lookup', async () => {
  const { db, repository } = createVocabulary()
  const provider = new RecordingDictionaryProvider()
  const service = new VocabularyService(repository, provider)
  const first = await service.addText('user-a', createPair(), 'Reliable')

  const second = await service.addText('user-a', createPair(), '  reliable  ')

  assert.equal(second.duplicate, true)
  assert.deepEqual(second.item, first.item)
  assert.equal(provider.inputs.length, 1)
  db.close()
})

test('rejects text that normalizes to empty', async () => {
  const { db, repository } = createVocabulary()
  const provider = new RecordingDictionaryProvider()
  const service = new VocabularyService(repository, provider)

  await assert.rejects(
    service.addText('user-a', createPair(), ' \t\n '),
    /Vocabulary text cannot be empty/,
  )
  assert.equal(provider.inputs.length, 0)
  db.close()
})

test('finds vocabulary only for the requested user', async () => {
  const { db, repository } = createVocabulary()
  const service = new VocabularyService(repository, new RecordingDictionaryProvider())
  const result = await service.addText('user-a', createPair(), 'reliable')

  assert.deepEqual(service.findForUser('user-a', result.item.id), result.item)
  assert.equal(service.findForUser('user-b', result.item.id), null)
  db.close()
})

test('finds by normalized text within a pair and replaces only owned translations', () => {
  const { db, repository } = createVocabulary()
  const service = new VocabularyService(repository, new RecordingDictionaryProvider())
  const created = repository.create(createInput({ transcription: '/rɪˈlaɪəbəl/', partOfSpeech: 'adjective' }))
  const otherPairItem = repository.create(createInput({ languagePairId: 'pair-b' }))
  const reviewAt = '2026-09-20T00:00:00.000Z'
  db.prepare(`INSERT INTO review_states
    (id, user_id, vocabulary_item_id, level, next_review_at, created_at, updated_at)
    VALUES (?, ?, ?, 2, ?, ?, ?)`)
    .run('state-1', 'user-a', created.id, reviewAt, reviewAt, reviewAt)

  assert.equal(service.findByText('user-a', 'pair-a', ' RELIABLE ')?.id, created.id)
  assert.equal(service.findByText('user-a', 'pair-b', 'reliable')?.id, otherPairItem.id)
  assert.equal(service.findByText('user-b', 'pair-a', 'reliable'), null)
  assert.equal(service.findByText('user-a', 'pair-b', 'missing'), null)

  const updated = service.replaceTranslations('user-a', created.id, ['примерный', 'приблизительный'])
  assert.deepEqual(updated?.translations, ['примерный', 'приблизительный'])
  assert.equal(updated?.text, created.text)
  assert.equal(updated?.status, created.status)
  assert.deepEqual(updated?.examples, created.examples)
  assert.equal(updated?.transcription, '/rɪˈlaɪəbəl/')
  assert.equal(updated?.partOfSpeech, 'adjective')
  assert.equal(service.replaceTranslations('user-b', created.id, ['чужое']), null)
  assert.throws(() => service.replaceTranslations('user-a', created.id, []), /At least one translation is required/)
  assert.equal(repository.findByIdForUser('user-a', otherPairItem.id)?.translations[0], 'mock translation')
  assert.equal(
    (db.prepare('SELECT next_review_at FROM review_states WHERE vocabulary_item_id = ?').get(created.id) as { next_review_at: string }).next_review_at,
    reviewAt,
  )
  db.close()
})

test('deletes normalized text only from the requested user and pair with review cascades', async () => {
  const { db, repository } = createVocabulary()
  const service = new VocabularyService(repository, new RecordingDictionaryProvider())
  const target = await service.addText('user-a', createPair(), 'Reliable')
  const otherPair = await service.addText('user-a', createPair({ id: 'pair-b', isDefault: false }), 'Reliable')

  db.prepare(`
    INSERT INTO review_states (id, user_id, vocabulary_item_id, next_review_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('state-1', 'user-a', target.item.id, '2026-09-20T00:00:00.000Z', '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z')
  db.prepare(`
    INSERT INTO reviews
      (id, user_id, vocabulary_item_id, direction, result, level_before, level_after, reviewed_at)
    VALUES (?, ?, ?, 'source_to_target', 'correct', 0, 1, ?)
  `).run('review-1', 'user-a', target.item.id, '2026-09-19T00:00:00.000Z')

  assert.equal(service.deleteText('user-a', 'pair-a', '  RELIABLE  '), true)
  assert.equal(repository.findByIdForUser('user-a', target.item.id), null)
  assert.ok(repository.findByIdForUser('user-a', otherPair.item.id))
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM review_states WHERE vocabulary_item_id = ?').get(target.item.id) as { count: number }).count, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM reviews WHERE vocabulary_item_id = ?').get(target.item.id) as { count: number }).count, 0)
  assert.equal(service.deleteText('user-a', 'pair-a', 'missing'), false)
  assert.equal(service.deleteText('user-b', 'pair-a', 'reliable'), false)
  db.close()
})
