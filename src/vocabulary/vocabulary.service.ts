import type { DictionaryProvider } from '../dictionary/dictionary.types'
import type { LanguagePair } from '../languages/language-pair.types'
import { classifyText, normalizeText } from './normalize'
import { VocabularyRepository, type VocabularyListFilters } from './vocabulary.repository'
import type { VocabularyItem, VocabularyStatus } from './vocabulary.types'

export type AddVocabularyResult = {
  item: VocabularyItem
  duplicate: boolean
}

export class VocabularyService {
  constructor(
    private readonly repository: VocabularyRepository,
    private readonly dictionaryProvider: DictionaryProvider,
  ) {}

  async addText(userId: string, pair: LanguagePair, rawText: string): Promise<AddVocabularyResult> {
    const normalizedText = normalizeText(rawText)
    if (!normalizedText) {
      throw new Error('Vocabulary text cannot be empty')
    }

    const existing = this.repository.findByNormalizedText(userId, pair.id, normalizedText)
    if (existing) {
      return { item: existing, duplicate: true }
    }

    const dictionaryResult = await this.dictionaryProvider.lookup({
      text: normalizedText,
      sourceLanguage: pair.sourceLanguage,
      targetLanguage: pair.targetLanguage,
    })
    const item = this.repository.create({
      userId,
      languagePairId: pair.id,
      text: normalizedText,
      normalizedText,
      itemType: classifyText(normalizedText),
      translations: dictionaryResult.translations,
      transcription: dictionaryResult.transcription,
      partOfSpeech: dictionaryResult.partOfSpeech,
      examples: dictionaryResult.examples ?? [],
      status: 'inbox',
    })
    return { item, duplicate: false }
  }

  findForUser(userId: string, itemId: string): VocabularyItem | null {
    return this.repository.findByIdForUser(userId, itemId)
  }

  listForUser(userId: string, filters: VocabularyListFilters = {}): VocabularyItem[] {
    return this.repository.listForUser(userId, filters)
  }

  countByStatus(userId: string, status: VocabularyStatus): number {
    return this.repository.countByStatus(userId, status)
  }
}
