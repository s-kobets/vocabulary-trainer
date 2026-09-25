import type { SqliteDatabase } from '../db/database'
import { getLanguages } from './languages'
import type { LanguagePair } from './language-pair.types'
import { LanguagePairRepository } from './language-pair.repository'

export class LanguagePairService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly pairs: LanguagePairRepository,
  ) {}

  findDefaultForUser(userId: string): LanguagePair | null {
    return this.pairs.findDefaultForUser(userId)
  }

  listForUser(userId: string): LanguagePair[] {
    return this.pairs.findForUser(userId)
  }

  selectForUser(userId: string, pairId: string): LanguagePair {
    const pair = this.pairs.findByIdForUser(userId, pairId)
    if (!pair) throw new Error(`Language pair ${pairId} does not belong to user ${userId}`)
    this.pairs.setDefault(userId, pairId)
    return this.pairs.findByIdForUser(userId, pairId) as LanguagePair
  }

  deleteForUser(userId: string, pairId: string): 'deleted' | 'has_vocabulary' {
    return this.db.transaction(() => {
      const pair = this.pairs.findByIdForUser(userId, pairId)
      if (!pair) throw new Error(`Language pair ${pairId} does not belong to user ${userId}`)
      if (this.pairs.countVocabularyForUserPair(userId, pairId) > 0) return 'has_vocabulary'

      this.pairs.deleteForUser(userId, pairId)
      if (pair.isDefault) {
        const replacement = this.pairs.findForUser(userId)[0]
        if (replacement) this.pairs.setDefault(userId, replacement.id)
      }
      return 'deleted'
    })()
  }

  createDefault(userId: string, source: string, target: string): LanguagePair {
    const codes = new Set(getLanguages().map((language) => language.code))
    for (const code of [source, target]) {
      if (!codes.has(code)) throw new Error(`Unknown language: ${code}`)
    }

    return this.db.transaction(() => {
      const pair = this.pairs.findByLanguagesForUser(userId, source, target)
        ?? this.pairs.create(userId, {
          sourceLanguage: source,
          targetLanguage: target,
        })
      this.pairs.setDefault(userId, pair.id)
      return this.pairs.findByIdForUser(userId, pair.id) as LanguagePair
    })()
  }
}
