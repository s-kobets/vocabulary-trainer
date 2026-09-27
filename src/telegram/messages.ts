import type { LanguagePair } from '../languages/language-pair.types'
import { getLanguages } from '../languages/languages'
import type { VocabularyItem } from '../vocabulary/vocabulary.types'

function languageName(code: string): string {
  return getLanguages().find((language) => language.code === code)?.name ?? code
}

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

export function renderHelp(): string {
  return [
    '/start - Choose your first language pair',
    '/languages - Manage and select language pairs',
    '/status - Show your active pair and vocabulary counts',
    '/inbox - Show words waiting to be learned',
    '/review - Review words that are due',
    '/edit <word> - Edit translations',
  ].join('\n')
}

export function renderStatus(
  pair: LanguagePair,
  counts: { inbox: number; learning: number; known: number },
): string {
  return [
    `Active pair: ${languageName(pair.sourceLanguage)} -> ${languageName(pair.targetLanguage)}`,
    `Inbox: ${counts.inbox}`,
    `Learning: ${counts.learning}`,
    `Known: ${counts.known}`,
  ].join('\n')
}

export function renderLanguages(pairs: LanguagePair[]): string {
  return [
    'Your language pairs:',
    ...pairs.map((pair) => `${languageName(pair.sourceLanguage)} -> ${languageName(pair.targetLanguage)}${pair.isDefault ? ' (active)' : ''}`),
  ].join('\n')
}

export function renderBulkImportSummary(result: {
  added: number
  duplicates: number
  failed: number
}): string {
  return [
    'Bulk import complete:',
    `Added: ${result.added}`,
    `Duplicates: ${result.duplicates}`,
    `Failed: ${result.failed}`,
  ].join('\n')
}

export function renderDeleteConfirmation(matchCount: number): string {
  return `Delete ${matchCount} matching words?`
}

export function renderDeleteSummary(deleted: number, notFound: number): string {
  return `Deleted: ${deleted}\nNot found: ${notFound}`
}

export function renderVocabularyAdded(item: VocabularyItem): string {
  return `${renderItem(item)}\n\nAdded to Inbox`
}

export function renderVocabularyPending(item: VocabularyItem): string {
  return `${item.text}\n\nAdded to Inbox. Card details will be available after enrichment.`
}

export function renderDuplicate(item: VocabularyItem): string {
  return `${item.text} is already in your vocabulary.`
}

export function renderInbox(items: VocabularyItem[], count: number): string {
  return [`Inbox: ${count}`, ...items.map((item) => item.text)].join('\n')
}

export function renderLearning(items: VocabularyItem[], count: number): string {
  return [`Learning: ${count}`, ...items.map((item) => item.text)].join('\n')
}

export function renderReviewPrompt(item: VocabularyItem, position: number, total: number): string {
  return `${position} / ${total}\n\n${item.text}`
}

export function renderReviewAnswer(item: VocabularyItem, position: number, total: number): string {
  return `${position} / ${total}\n\n${renderItem(item)}\n\nDidn't know\nKnew it`
}
