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
