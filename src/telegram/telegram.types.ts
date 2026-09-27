import type { Context } from 'telegraf'
import type { SessionContext } from 'telegraf/session'
import type { LanguagePairService } from '../languages/language-pair.service'
import type { ReviewService } from '../reviews/review.service'
import type { UserService } from '../users/user.service'
import type { VocabularyService } from '../vocabulary/vocabulary.service'
import type { SqliteDatabase } from '../db/database'
import type { DictionaryProvider } from '../dictionary/dictionary.types'

export type BotSession = {
  onboarding?: {
    step: 'source' | 'target'
    sourceLanguage?: string
  }
  review?: {
    itemIds: string[]
    index: number
    revealed: boolean
  }
  languageSetup?: {
    step: 'source' | 'target'
    sourceLanguage?: string
  }
  pendingDelete?: {
    userId: string
    languagePairId: string
    words: string[]
  }
  pendingTranslationEdit?: {
    userId: string
    vocabularyItemId: string
    languagePairId: string
    reviewMessage?: { chatId: number; messageId: number }
  }
}

export type BotContext = Context & SessionContext<BotSession>

export type BotDependencies = {
  db?: SqliteDatabase
  dictionaryProvider?: DictionaryProvider
  userService: UserService
  languagePairService: LanguagePairService
  vocabularyService: VocabularyService
  reviewService: ReviewService
  logger: { error: (...args: unknown[]) => void }
}
