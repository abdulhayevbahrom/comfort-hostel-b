import { dateKeyInTimeZone, minutesFromTime, minutesInTimeZone, shiftCrossesMidnight, shiftDurationMinutes } from './faceTime.js'

const round = (number) => Math.round((number + Number.EPSILON) * 100) / 100
const workingDates = (year, month, days) => {
  const result = []; const count = new Date(year, month, 0).getDate()
  for (let day = 1; day <= count; day += 1) {
    if (days.has(new Date(Date.UTC(year, month - 1, day)).getUTCDay())) result.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  return result
}

export function calculateEmployeePayroll(employee, attendances, year, month, asOfDate = new Date(), options = {}) {
  const schedule = options.schedule || employee.workSchedule || {}
  const waivedDates = options.waivedDates instanceof Set ? options.waivedDates : new Set(options.waivedDates || [])
  const salary = Number(employee.salary || 0)
  const allWorkingDates = workingDates(year, month, new Set(Array.isArray(schedule.workDays) ? schedule.workDays : [1, 2, 3, 4, 5, 6]))
  const asOfKey = dateKeyInTimeZone(asOfDate)
  const period = `${year}-${String(month).padStart(2, '0')}`
  const attendanceDates = new Set(attendances.map((item) => item.date))
  // Eski xodimlarda FaceID tarixi bo‘lmagani uchun tizim joriy etilishidan oldingi davrga jarima yozilmaydi.
  const penaltyStartDate = /^\d{4}-\d{2}-\d{2}$/.test(schedule.penaltyStartDate || '') ? schedule.penaltyStartDate : asOfKey
  // Bugungi smena tugamasidan xodimni avtomatik "kelmadi" deb jarimaga tortmaymiz.
  // Agar u bugun kelgan bo‘lsa, kechikish hisobi darhol ko‘rinadi; kelmagan kun ertasi kuni yakunlanadi.
  const elapsedDates = (period < asOfKey.slice(0, 7)
    ? allWorkingDates
    : period === asOfKey.slice(0, 7)
      ? allWorkingDates.filter((date) => date < asOfKey || attendanceDates.has(date))
      : []).filter((date) => date >= penaltyStartDate)
  const shiftMinutes = shiftDurationMinutes(schedule)
  const minuteRate = shiftMinutes && allWorkingDates.length ? salary / (shiftMinutes * allWorkingDates.length) : 0
  const byDate = new Map(attendances.map((item) => [item.date, item]))
  const crosses = shiftCrossesMidnight(schedule); const start = minutesFromTime(schedule.checkInTime)
  const checkIn = start + Number(schedule.lateAfterMinutes || 0)
  const checkOut = minutesFromTime(schedule.checkOutTime) + (crosses ? 1440 : 0) - Number(schedule.earlyLeaveMinutes || 0)
  const absentDates = []; const lateDates = []; const earlyLeaveDates = []
  let totalWorkedMinutes = 0; let totalLateMinutes = 0; let totalEarlyLeaveMinutes = 0
  let chargeableAbsentDays = 0; let chargeableLateMinutes = 0; let chargeableEarlyLeaveMinutes = 0
  for (const date of elapsedDates) {
    const attendance = byDate.get(date)
    const waived = waivedDates.has(date)
    if (!attendance) { absentDates.push(date); if (!waived) chargeableAbsentDays += 1; continue }
    totalWorkedMinutes += Math.floor(Number(attendance.totalHours || 0) * 60)
    const rawEntry = minutesInTimeZone(attendance.firstEntry); const entry = rawEntry !== null && crosses && rawEntry < start ? rawEntry + 1440 : rawEntry
    if (entry !== null && entry > checkIn) { const minutes = entry - checkIn; totalLateMinutes += minutes; if (!waived) chargeableLateMinutes += minutes; lateDates.push({ date, minutes, waived }) }
    const rawExit = minutesInTimeZone(attendance.lastExit); const exit = rawExit !== null && crosses && rawExit <= start ? rawExit + 1440 : rawExit
    if (exit !== null && exit < checkOut) { const minutes = checkOut - exit; totalEarlyLeaveMinutes += minutes; if (!waived) chargeableEarlyLeaveMinutes += minutes; earlyLeaveDates.push({ date, minutes, waived }) }
  }
  const penaltyRate = schedule.useTimePenalty ? Number(schedule.penaltyPerMinute || 0) : minuteRate
  const lateDeduction = chargeableLateMinutes * penaltyRate
  const earlyLeaveDeduction = chargeableEarlyLeaveMinutes * penaltyRate
  const absenceDeduction = chargeableAbsentDays * shiftMinutes * minuteRate
  const totalDeduction = lateDeduction + earlyLeaveDeduction + absenceDeduction
  return {
    baseSalary: round(salary), netSalary: round(Math.max(0, salary - totalDeduction)), workingDaysInMonth: allWorkingDates.length,
    presentDays: elapsedDates.length - absentDates.length, absentDays: absentDates.length, absentDates, lateDates, earlyLeaveDates,
    totalWorkedMinutes, totalLateMinutes, totalEarlyLeaveMinutes,
    deductions: { minuteRate: round(minuteRate), penaltyRate: round(penaltyRate), lateDeduction: round(lateDeduction), earlyLeaveDeduction: round(earlyLeaveDeduction), absenceDeduction: round(absenceDeduction), totalDeduction: round(totalDeduction) },
  }
}
