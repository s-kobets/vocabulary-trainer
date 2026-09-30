export function isValidReminderTime(value: string): boolean {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match !== null
}

export function getLocalDateTime(now: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  }
}

export function hasReminderTimePassed(now: Date, timezone: string, reminderTime: string): boolean {
  if (!isValidReminderTime(reminderTime)) return false
  return getLocalDateTime(now, timezone).time >= reminderTime
}
