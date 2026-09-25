import type { Context } from 'telegraf'
import type { SessionContext } from 'telegraf/session'
import type { LanguagePairService } from '../languages/language-pair.service'
import type { ReviewService } from '../reviews/review.service'
import type { UserService } from '../users/user.service'
import type { VocabularyService } from '../vocabulary/vocabulary.service'

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
}

export type BotContext = Context & SessionContext<BotSession>

export type BotDependencies = {
  userService: UserService
  languagePairService: LanguagePairService
  vocabularyService: VocabularyService
  reviewService: ReviewService
  logger: { error: (...args: unknown[]) => void }
}
