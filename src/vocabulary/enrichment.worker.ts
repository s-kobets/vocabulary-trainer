import type { DictionaryProvider } from '../dictionary/dictionary.types'
import { dictionaryFailureFields } from '../dictionary/dictionary.errors'
import type { VocabularyRepository } from './vocabulary.repository'
import type { LanguagePairRepository } from '../languages/language-pair.repository'

type ErrorLogger = { error: (fields: Record<string, string | number>, message: string) => void }

export class EnrichmentWorker {
  private timer: NodeJS.Timeout | undefined
  private running = false
  private stopped = false

  constructor(
    private readonly repository: VocabularyRepository,
    private readonly provider: DictionaryProvider,
    private readonly languagePairs: LanguagePairRepository,
    private readonly logger?: ErrorLogger,
    private readonly intervalMs = 60_000,
  ) {}

  start(): void {
    if (this.timer) return
    this.stopped = false
    void this.runOnce()
    this.timer = setInterval(() => { void this.runOnce() }, this.intervalMs)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10))
  }

  async runOnce(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    try {
      this.repository.resetStaleProcessing()
      for (const item of this.repository.listPending(10)) {
        if (this.stopped) break
        try {
          const pair = this.languagePairs.findByIdForUser(item.userId, item.languagePairId)
          if (!pair || !this.repository.claimPending(item.userId, item.id)) continue
          const result = await this.provider.lookup({ text: item.text, ...pair })
          this.repository.updateEnrichment(item.userId, item.id, { ...result, examples: result.examples ?? [], status: 'ready' })
        } catch (error) {
          this.logger?.error({ itemId: item.id, ...dictionaryFailureFields(error) }, 'Dictionary enrichment retry failed')
          this.repository.updateEnrichment(item.userId, item.id, { translations: [], examples: [], status: 'pending', error: error instanceof Error ? error.name : 'ProviderError' })
        }
      }
    } finally {
      this.running = false
    }
  }
}
