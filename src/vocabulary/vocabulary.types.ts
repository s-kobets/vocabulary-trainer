export type VocabularyStatus = 'inbox' | 'learning' | 'known'
export type VocabularyItemType = 'word' | 'phrase'
export type VocabularyExample = { source: string; target?: string }

export type VocabularyItem = {
  id: string
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
  createdAt: string
  updatedAt: string
  enrichmentStatus?: 'pending' | 'processing' | 'ready'
}
