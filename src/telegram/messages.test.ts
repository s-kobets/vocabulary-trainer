import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { LanguagePair } from '../languages/language-pair.types'
import type { VocabularyItem } from '../vocabulary/vocabulary.types'
import {
  renderDuplicate,
  renderInbox,
  renderReadyMessage,
  renderReviewAnswer,
  renderReviewPrompt,
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
  assert.match(renderInbox([item], 1), /Inbox: 1.*reliable/s)
  assert.match(renderReviewPrompt(item, 1, 8), /1 \/ 8.*reliable/s)
  assert.match(renderReviewAnswer(item, 1, 8), /Didn't know.*Knew it/s)
})
