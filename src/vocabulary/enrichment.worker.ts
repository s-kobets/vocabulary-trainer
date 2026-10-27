import type { VocabularyService } from './vocabulary.service'
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
    private readonly service: VocabularyService,
    private readonly languagePairs: LanguagePairRepository,
    private readonly logger?: ErrorLogger,
    private readonly intervalMs = 60_000,
  ) {}

  start(): void {
    if (this.timer) return
    // Recover requests interrupted by the previous application process.
    this.repository.resetStaleProcessing()
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
      for (const item of this.repository.listPending(10)) {
        if (this.stopped) break
        try {
          const pair = this.languagePairs.findByIdForUser(item.userId, item.languagePairId)
          if (!pair) continue
          await this.service.enrich(item, pair)
        } catch (error) {
          this.logger?.error({ itemId: item.id, ...dictionaryFailureFields(error) }, 'Dictionary enrichment retry failed')
        }
      }
    } finally {
      this.running = false
    }
  }
}
