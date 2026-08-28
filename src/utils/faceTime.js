const TIME_ZONE = 'Asia/Tashkent'

export function datePartsInTimeZone(value, timeZone = TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date)
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0)
  const year = get('year'); const month = get('month'); const day = get('day'); const hour = get('hour'); const minute = get('minute')
  return { date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, year, month, day, hour, minute, minutes: hour * 60 + minute }
}

export const dateKeyInTimeZone = (value) => datePartsInTimeZone(value)?.date || null
export const minutesInTimeZone = (value) => datePartsInTimeZone(value)?.minutes ?? null
export const minutesFromTime = (value) => {
  const [hour, minute] = String(value || '').split(':').map(Number)
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0
}
export const shiftCrossesMidnight = (schedule) => minutesFromTime(schedule?.checkOutTime) <= minutesFromTime(schedule?.checkInTime)
export const shiftDurationMinutes = (schedule) => {
  let duration = minutesFromTime(schedule?.checkOutTime) - minutesFromTime(schedule?.checkInTime)
  if (duration <= 0) duration += 24 * 60
  return duration
}
const previousDate = (dateKey) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10)
}
export function resolveEmployeeAttendanceDate(schedule, direction, occurredAt) {
  const parts = datePartsInTimeZone(occurredAt)
  if (!parts || !shiftCrossesMidnight(schedule)) return parts?.date || null
  const checkIn = minutesFromTime(schedule?.checkInTime)
  const checkOut = minutesFromTime(schedule?.checkOutTime)
  if (direction === 'IN') return parts.minutes < checkOut ? previousDate(parts.date) : parts.date
  if (direction === 'OUT') return parts.minutes < checkIn ? previousDate(parts.date) : parts.date
  return parts.minutes < checkOut ? previousDate(parts.date) : parts.date
}
