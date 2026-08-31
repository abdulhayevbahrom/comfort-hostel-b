export const FACE_WARNING_LIMIT = 3

export function accessDecision({ debtAmount }) {
  if (Number(debtAmount) <= 0) return { allowed: true, decision: 'granted' }
  return { allowed: true, decision: 'granted_warning' }
}

export function shouldQueueDebtSms({ debtAmount, warningCount }) {
  return Number(debtAmount) > 0 && Number(warningCount) < FACE_WARNING_LIMIT
}

export function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
