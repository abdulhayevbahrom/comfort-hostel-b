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

const calendarMonthInstallments = (start, end, rate) => {
  const installments = []
  let monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  const finalMonthStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))

  while (monthStart <= finalMonthStart) {
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0))
    const coveredStart = start > monthStart ? start : monthStart
    const coveredEnd = end < monthEnd ? end : monthEnd
    const coveredDays = Math.round((coveredEnd - coveredStart) / DAY_MS) + 1
    const daysInMonth = monthEnd.getUTCDate()
    installments.push({
      periodKey: `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`,
      dueDate: coveredStart,
      amount: Math.round((coveredDays / daysInMonth) * rate),
    })
    monthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
  }
  return installments
}

export function calculateContractPayment(startValue, endValue, paymentType, paymentAmount) {
  const start = utcDate(startValue)
  const end = utcDate(endValue)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return { durationDays: 0, billingQuantity: 0, totalAmount: 0 }
  const durationDays = Math.max(0, Math.round((end - start) / DAY_MS) + 1)
  const rate = Math.max(0, Number(paymentAmount) || 0)

  if (paymentType === 'daily') {
    return { durationDays, billingQuantity: durationDays, totalAmount: Math.round(durationDays * rate) }
  }

  const installments = calendarMonthInstallments(start, end, rate)
  return {
    durationDays,
    billingQuantity: installments.length,
    totalAmount: installments.reduce((sum, installment) => sum + installment.amount, 0),
  }
}

export function buildContractInstallments(contract) {
  const start = utcDate(contract.startDate)
  const quantity = Math.max(1, Number(contract.billingQuantity) || 1)
  const monthlyInstallments = contract.paymentType === 'monthly'
    ? calendarMonthInstallments(start, utcDate(contract.endDate), Math.max(0, Number(contract.paymentAmount) || 0))
    : []
  const count = contract.paymentType === 'daily' ? 1 : monthlyInstallments.length || quantity

  return Array.from({ length: count }, (_, index) => {
    const monthlyInstallment = monthlyInstallments[index]
    const dueDate = contract.paymentType === 'daily' ? start : monthlyInstallment?.dueDate || addMonthsClamped(start, index)
    return {
      contract: contract._id,
      student: contract.student,
      periodIndex: index + 1,
      periodKey: monthlyInstallment?.periodKey || `${dueDate.getUTCFullYear()}-${String(dueDate.getUTCMonth() + 1).padStart(2, '0')}`,
      dueDate,
      amount: contract.paymentType === 'daily' ? contract.totalAmount : monthlyInstallment?.amount ?? contract.paymentAmount,
      paidAmount: 0,
      status: 'unpaid',
    }
  })
}
