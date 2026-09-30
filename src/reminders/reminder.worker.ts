import { Markup } from 'telegraf'
import type { LanguagePairRepository } from '../languages/language-pair.repository'
import type { ReviewRepository } from '../reviews/review.repository'
import type { UserSettingsRepository } from '../users/user-settings.repository'
import { getLocalDateTime, hasReminderTimePassed } from './reminder.schedule'

type ReminderWorkerDependencies = {
  settings: Pick<UserSettingsRepository, 'listEnabled' | 'claimAttempt' | 'markDelivered'>
  languagePairs: Pick<LanguagePairRepository, 'findDefaultForUser'>
  reviews: Pick<ReviewRepository, 'countDueForPair'>
  send: (telegramUserId: string, text: string, extra: import('telegraf').Types.ExtraReplyMessage) => Promise<unknown>
  logger: { error: (...args: unknown[]) => void }
  intervalMs?: number
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

export class ReminderWorker {
  private timer: NodeJS.Timeout | undefined
  private running = false
  private stopped = false

  constructor(private readonly dependencies: ReminderWorkerDependencies) {}

  start(): void {
    if (this.timer) return
    this.stopped = false
    void this.runOnce()
    this.timer = setInterval(() => { void this.runOnce() }, this.dependencies.intervalMs ?? 60_000)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10))
  }

  async runOnce(now = new Date()): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    try {
      for (const user of this.dependencies.settings.listEnabled()) {
        if (this.stopped) break
        try {
          const local = getLocalDateTime(now, user.timezone)
          if (!hasReminderTimePassed(now, user.timezone, user.dailyReviewTime)
            || user.deliveredDate === local.date) continue

          const pair = this.dependencies.languagePairs.findDefaultForUser(user.userId)
          if (!pair) continue
          const dueCount = this.dependencies.reviews.countDueForPair(user.userId, pair.id, now)
          if (dueCount === 0) continue
          const attempt = this.dependencies.settings.claimAttempt(user.userId, local.date, now)
          if (attempt === null) continue

          const noun = dueCount === 1 ? 'word is' : 'words are'
          await this.dependencies.send(
            user.telegramUserId,
            `${dueCount} ${noun} due for review.`,
            Markup.inlineKeyboard([[Markup.button.callback('Start review', 'review:start_due')]]),
          )
          this.dependencies.settings.markDelivered(user.userId, local.date, now)
        } catch (error) {
          this.dependencies.logger.error({ userId: user.userId, errorName: errorName(error) }, 'Daily review reminder failed')
        }
      }
    } finally {
      this.running = false
    }
  }
}
