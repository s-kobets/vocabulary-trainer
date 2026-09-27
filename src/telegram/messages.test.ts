import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { LanguagePair } from '../languages/language-pair.types'
import type { VocabularyItem } from '../vocabulary/vocabulary.types'
import {
  renderDuplicate,
  renderBulkImportSummary,
  renderDeleteConfirmation,
  renderDeleteSummary,
  renderHelp,
  renderInbox,
  renderLanguages,
  renderLearning,
  renderReadyMessage,
  renderReviewAnswer,
  renderReviewPrompt,
  renderStatus,
  renderVocabularyAdded,
} from './messages'

const pair: LanguagePair = {
  id: 'pair-1',
  userId: 'user-1',
  sourceLanguage: 'en',
  targetLanguage: 'ru',
  isDefault: true,
  createdAt: '2026-09-18T00:00:00.000Z',
}

const item: VocabularyItem = {
  id: 'item-1',
  userId: 'user-1',
  languagePairId: 'pair-1',
  text: 'reliable',
  normalizedText: 'reliable',
  itemType: 'word',
  translations: ['надёжный'],
  transcription: '/rɪˈlaɪəbəl/',
  examples: [{ source: 'A reliable service.' }],
  status: 'inbox',
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z',
}

test('renders ready, vocabulary, inbox, and review messages from domain data', () => {
  assert.match(renderReadyMessage(pair), /en.*ru/)
  assert.match(renderVocabularyAdded(item), /reliable.*надёжный/s)
  assert.match(renderVocabularyAdded(item), /Added to Inbox/)
  assert.match(renderDuplicate(item), /reliable is already in your vocabulary\./)
  assert.match(renderInbox([item], 1, pair), /Inbox: 1.*reliable.*надёжный/s)
  assert.match(renderReviewPrompt(item, 1, 8), /1 \/ 8.*reliable/s)
  assert.match(renderReviewAnswer(item, 1, 8), /Didn't know.*Knew it/s)
})

test('renders help, status, and language pair messages', () => {
  const inactivePair = { ...pair, id: 'pair-2', sourceLanguage: 'de', targetLanguage: 'fr', isDefault: false }

  assert.match(renderHelp(), /\/start.*\/languages.*\/status.*\/inbox.*\/review/s)
  assert.match(renderHelp(), /\/edit <word> - Edit translations/)
  assert.match(renderStatus(pair, { inbox: 2, learning: 3, known: 4 }), /English.*Russian/s)
  assert.match(renderStatus(pair, { inbox: 2, learning: 3, known: 4 }), /Inbox: 2.*Learning: 3.*Known: 4/s)
  assert.match(renderLanguages([pair, inactivePair]), /English.*Russian.*active/s)
  assert.match(renderLanguages([pair, inactivePair]), /German.*French/s)
})

test('renders the bulk import summary', () => {
  assert.match(renderBulkImportSummary({ added: 6, duplicates: 2, failed: 1 }), /Bulk import complete:/)
  assert.match(renderBulkImportSummary({ added: 6, duplicates: 2, failed: 1 }), /Added: 6/)
  assert.match(renderBulkImportSummary({ added: 6, duplicates: 2, failed: 1 }), /Duplicates: 2/)
  assert.match(renderBulkImportSummary({ added: 6, duplicates: 2, failed: 1 }), /Failed: 1/)
})

test('renders delete confirmation and summary messages', () => {
  assert.match(renderDeleteConfirmation(3), /Delete 3 matching words\?/)
  assert.match(renderDeleteSummary(3, 1), /Deleted: 3.*Not found: 1/s)
})

test('renders the learning list and full count', () => {
  const learning = { ...item, id: 'learning-1', text: 'approximate' }
  assert.match(renderLearning([item, learning], 12), /Learning: 12.*reliable.*approximate/s)
})

test('renders inbox translations in the active language pair', () => {
  const multipleTranslations = { ...item, translations: ['надёжный', 'надежный'] }

  assert.match(renderInbox([item], 1, pair), /English.*Russian.*reliable.*надёжный/s)
  assert.match(renderInbox([multipleTranslations], 1, pair), /надёжный.*надежный/s)
})

test('renders an explicit state when an inbox translation is unavailable', () => {
  const pending = { ...item, translations: [], enrichmentStatus: 'processing' as const }
  const unavailable = { ...item, translations: [] }

  assert.match(renderInbox([pending], 1, pair), /Translation pending/)
  assert.match(renderInbox([unavailable], 1, pair), /No translation available/)
})
