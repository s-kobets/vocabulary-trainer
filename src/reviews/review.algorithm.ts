export const REVIEW_INTERVALS = [0, 1, 3, 7, 14, 30, 60] as const
export const KNOWN_AFTER_CORRECT_ANSWERS = 3
export type ReviewResult = 'correct' | 'incorrect'

export function calculateNextReview(input: {
  level: number
  result: ReviewResult
  now: Date
}): { level: number; nextReviewAt: Date } {
  const currentLevel = Math.max(0, Math.min(input.level, REVIEW_INTERVALS.length - 1))
  const level = input.result === 'correct'
    ? Math.min(currentLevel + 1, REVIEW_INTERVALS.length - 1)
    : 0
  const days = input.result === 'correct' ? REVIEW_INTERVALS[level] : 1
  const nextReviewAt = new Date(input.now.getTime() + days * 24 * 60 * 60 * 1000)
  return { level, nextReviewAt }
}
