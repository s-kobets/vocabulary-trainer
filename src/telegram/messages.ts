import type { LanguagePair } from '../languages/language-pair.types'
import type { VocabularyItem } from '../vocabulary/vocabulary.types'

function renderItem(item: VocabularyItem): string {
  const lines = [item.text]
  if (item.transcription) lines.push(item.transcription)
  lines.push(...item.translations)
  lines.push(...item.examples.map((example) => example.source))
  return lines.join('\n')
}

export function renderReadyMessage(pair: LanguagePair): string {
  return `Ready: ${pair.sourceLanguage} -> ${pair.targetLanguage}\nSend a word to add it to your Inbox.`
}

export function renderVocabularyAdded(item: VocabularyItem): string {
  return `${renderItem(item)}\n\nAdded to Inbox`
}

export function renderDuplicate(item: VocabularyItem): string {
  return `${item.text} is already in your vocabulary.`
}

export function renderInbox(items: VocabularyItem[], count: number): string {
  return [`Inbox: ${count}`, ...items.map((item) => item.text)].join('\n')
}

export function renderReviewPrompt(item: VocabularyItem, position: number, total: number): string {
  return `${position} / ${total}\n\n${item.text}`
}

export function renderReviewAnswer(item: VocabularyItem, position: number, total: number): string {
  return `${position} / ${total}\n\n${renderItem(item)}\n\nDidn't know\nKnew it`
}
