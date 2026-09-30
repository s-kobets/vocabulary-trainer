import { strict as assert } from 'node:assert'
import test from 'node:test'
import { getLocalDateTime, hasReminderTimePassed, isValidReminderTime } from './reminder.schedule'

test('validates zero-padded 24-hour reminder times', () => {
  for (const value of ['00:00', '09:00', '23:59']) assert.equal(isValidReminderTime(value), true, value)
  for (const value of ['9:00', '24:00', '12:60', 'text']) assert.equal(isValidReminderTime(value), false, value)
})

test('converts timestamps to local date and time in IANA zones', () => {
  assert.deepEqual(getLocalDateTime(new Date('2026-09-29T13:00:00.000Z'), 'Europe/Moscow'), {
    date: '2026-09-29', time: '16:00',
  })
  assert.throws(() => getLocalDateTime(new Date(), 'Mars/Olympus'), RangeError)
})

test('detects configured local time and catches up after the scheduled minute', () => {
  assert.equal(hasReminderTimePassed(new Date('2026-09-29T12:59:00Z'), 'America/New_York', '09:00'), false)
  assert.equal(hasReminderTimePassed(new Date('2026-09-29T13:01:00Z'), 'America/New_York', '09:00'), true)
  assert.equal(hasReminderTimePassed(new Date('2026-09-30T12:59:00Z'), 'America/New_York', '09:00'), false)
})

test('formats local times across spring and autumn daylight-saving transitions', () => {
  assert.deepEqual(getLocalDateTime(new Date('2026-03-08T06:59:00Z'), 'America/New_York'), {
    date: '2026-03-08', time: '01:59',
  })
  assert.deepEqual(getLocalDateTime(new Date('2026-03-08T07:00:00Z'), 'America/New_York'), {
    date: '2026-03-08', time: '03:00',
  })
  assert.deepEqual(getLocalDateTime(new Date('2026-11-01T05:59:00Z'), 'America/New_York'), {
    date: '2026-11-01', time: '01:59',
  })
  assert.deepEqual(getLocalDateTime(new Date('2026-11-01T06:00:00Z'), 'America/New_York'), {
    date: '2026-11-01', time: '01:00',
  })
})
