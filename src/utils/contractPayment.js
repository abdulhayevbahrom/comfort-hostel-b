const DAY_MS = 24 * 60 * 60 * 1000

const utcDate = (value) => {
  const date = new Date(value)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

const addMonthsClamped = (date, months) => {
  const day = date.getUTCDate()
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

export function calculateContractPayment(startValue, endValue, paymentType, paymentAmount) {
  const start = utcDate(startValue)
  const end = utcDate(endValue)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return { durationDays: 0, billingQuantity: 0, totalAmount: 0 }
  const durationDays = Math.max(0, Math.round((end - start) / DAY_MS))
  const rate = Math.max(0, Number(paymentAmount) || 0)

  if (paymentType === 'daily') {
    return { durationDays, billingQuantity: durationDays, totalAmount: Math.round(durationDays * rate) }
  }

  let wholeMonths = Math.max(0, (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth())
  let cursor = addMonthsClamped(start, wholeMonths)
  if (cursor > end) {
    wholeMonths -= 1
    cursor = addMonthsClamped(start, wholeMonths)
  }
  const nextMonth = addMonthsClamped(cursor, 1)
  const remainingDays = Math.max(0, Math.round((end - cursor) / DAY_MS))
  const daysInBillingMonth = Math.max(1, Math.round((nextMonth - cursor) / DAY_MS))
  const exactMonths = wholeMonths + (remainingDays / daysInBillingMonth)
  const billingQuantity = Math.ceil(exactMonths)

  return { durationDays, billingQuantity, totalAmount: Math.round(billingQuantity * rate) }
}

export function buildContractInstallments(contract) {
  const start = utcDate(contract.startDate)
  const quantity = Math.max(1, Number(contract.billingQuantity) || 1)
  const count = contract.paymentType === 'daily' ? 1 : quantity

  return Array.from({ length: count }, (_, index) => {
    const dueDate = contract.paymentType === 'daily' ? start : addMonthsClamped(start, index)
    return {
      contract: contract._id,
      student: contract.student,
      periodIndex: index + 1,
      periodKey: `${dueDate.getUTCFullYear()}-${String(dueDate.getUTCMonth() + 1).padStart(2, '0')}`,
      dueDate,
      amount: contract.paymentType === 'daily' ? contract.totalAmount : contract.paymentAmount,
      paidAmount: 0,
      status: 'unpaid',
    }
  })
}
