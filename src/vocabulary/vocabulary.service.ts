import type { DictionaryProvider } from '../dictionary/dictionary.types'
import { dictionaryFailureFields } from '../dictionary/dictionary.errors'
import type { LanguagePair } from '../languages/language-pair.types'
import { classifyText, normalizeText } from './normalize'
import { VocabularyRepository, type VocabularyListFilters } from './vocabulary.repository'
import type { VocabularyItem, VocabularyStatus } from './vocabulary.types'

export type AddVocabularyResult = {
  item: VocabularyItem
  duplicate: boolean
  pending?: boolean
}

type ErrorLogger = { error: (fields: Record<string, string | number>, message: string) => void }

export class VocabularyService {
  constructor(
    private readonly repository: VocabularyRepository,
    private readonly dictionaryProvider: DictionaryProvider,
    private readonly logger?: ErrorLogger,
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

    const item = this.repository.create({
      userId,
      languagePairId: pair.id,
      text: normalizedText,
      normalizedText,
      itemType: classifyText(normalizedText),
      translations: [],
      examples: [],
      status: 'inbox',
      enrichmentStatus: 'pending',
    })
    const enriched = await this.enrich(item, pair) ?? item
    return { item: enriched, duplicate: false, ...(enriched.enrichmentStatus ? { pending: true } : {}) }
  }

  async addTexts(userId: string, pair: LanguagePair, texts: string[]): Promise<{ added: number; duplicates: number; failed: number }> {
    const counts = { added: 0, duplicates: 0, failed: 0 }
    for (const text of texts) {
      try {
        const result = await this.addText(userId, pair, text)
        if (result.duplicate) counts.duplicates++
        else counts.added++
      } catch (error) {
        counts.failed++
        this.logger?.error(dictionaryFailureFields(error), 'Vocabulary import failed')
      }
    }
    return counts
  }

  async enrich(item: VocabularyItem, pair: LanguagePair): Promise<VocabularyItem | null> {
    const claimed = this.repository.claimPending(item.userId, item.id)
    if (!claimed) return this.repository.findByIdForUser(item.userId, item.id)
    try {
      const dictionaryResult = await this.dictionaryProvider.lookup({
        text: claimed.text,
        sourceLanguage: pair.sourceLanguage,
        targetLanguage: pair.targetLanguage,
      })
      return this.repository.updateEnrichment(item.userId, item.id, {
        ...dictionaryResult,
        examples: dictionaryResult.examples ?? [],
        status: 'ready',
      })
    } catch (error) {
      this.logger?.error({ itemId: item.id, ...dictionaryFailureFields(error) }, 'Dictionary enrichment failed')
      return this.repository.updateEnrichment(item.userId, item.id, {
        translations: [],
        examples: [],
        status: 'pending',
        error: error instanceof Error ? error.name : 'ProviderError',
      })
    }
  }

  findByText(userId: string, pairId: string, rawText: string): VocabularyItem | null {
    const normalizedText = normalizeText(rawText)
    return normalizedText ? this.repository.findByNormalizedText(userId, pairId, normalizedText) : null
  }

  replaceTranslations(userId: string, itemId: string, translations: string[]): VocabularyItem | null {
    if (translations.length === 0) throw new Error('At least one translation is required')
    return this.repository.update(userId, itemId, { translations })
  }

  findForUser(userId: string, itemId: string): VocabularyItem | null {
    return this.repository.findByIdForUser(userId, itemId)
  }

  deleteText(userId: string, pairId: string, rawText: string): boolean {
    const normalizedText = normalizeText(rawText)
    if (!normalizedText) return false
    return this.repository.deleteByNormalizedText(userId, pairId, normalizedText)
  }

  deleteForUser(userId: string, itemId: string): boolean {
    return this.repository.delete(userId, itemId)
  }

  listForUser(userId: string, filters: VocabularyListFilters = {}): VocabularyItem[] {
    return this.repository.listForUser(userId, filters)
  }

  countByStatus(userId: string, status: VocabularyStatus, languagePairId?: string): number {
    return this.repository.countByStatus(userId, status, languagePairId)
  }
}
