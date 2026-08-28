export const FACE_WARNING_LIMIT = 3

export function accessDecision({ hasActiveContract, accessEnabled, debtAmount, warningCount }) {
  if (!hasActiveContract) return { allowed: false, decision: 'denied_inactive' }
  if (!accessEnabled) return { allowed: false, decision: 'denied_disabled' }
  if (Number(debtAmount) <= 0) return { allowed: true, decision: 'granted' }
  if (Number(warningCount) >= FACE_WARNING_LIMIT) {
    return { allowed: false, decision: 'denied_debt_limit' }
  }
  return { allowed: true, decision: 'granted_warning' }
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
