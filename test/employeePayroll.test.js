import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateEmployeePayroll } from '../src/utils/employeePayroll.js'

const employee = (workSchedule = {}) => ({
  salary: 3_000_000,
  workSchedule: {
    checkInTime: '09:00',
    checkOutTime: '18:00',
    workDays: [1, 2, 3, 4, 5, 6],
    lateAfterMinutes: 0,
    earlyLeaveMinutes: 0,
    useTimePenalty: false,
    penaltyPerMinute: 0,
    penaltyStartDate: '2026-01-01',
    ...workSchedule,
  },
})

test('joriy kun smena tugamasidan absent jarimasi yozilmaydi', () => {
  const result = calculateEmployeePayroll(employee(), [], 2026, 8, new Date('2026-08-28T10:00:00+05:00'))
  assert.equal(result.absentDates.includes('2026-08-28'), false)
})

test('FaceID joriy etilishidan oldingi oyga retroaktiv jarima yozilmaydi', () => {
  const result = calculateEmployeePayroll(employee({ penaltyStartDate: '2026-08-28' }), [], 2026, 7, new Date('2026-08-28T10:00:00+05:00'))
  assert.equal(result.deductions.totalDeduction, 0)
  assert.equal(result.netSalary, 3_000_000)
})

test('kelgan joriy kun uchun kechikish darhol hisoblanadi', () => {
  const result = calculateEmployeePayroll(employee({ useTimePenalty: true, penaltyPerMinute: 1000 }), [{
    date: '2026-08-28',
    firstEntry: new Date('2026-08-28T09:15:00+05:00'),
    lastExit: null,
    totalHours: 0,
  }], 2026, 8, new Date('2026-08-28T10:00:00+05:00'))
  assert.equal(result.totalLateMinutes, 15)
  assert.equal(result.deductions.lateDeduction, 15_000)
})

test('tungi smenada kechikish va erta ketish to‘g‘ri olinadi', () => {
  const result = calculateEmployeePayroll(employee({ checkInTime: '22:00', checkOutTime: '06:00', lateAfterMinutes: 5, useTimePenalty: true, penaltyPerMinute: 1000 }), [{
    date: '2026-08-28',
    firstEntry: new Date('2026-08-28T22:20:00+05:00'),
    lastExit: new Date('2026-08-29T05:30:00+05:00'),
    totalHours: 7.1667,
  }], 2026, 8, new Date('2026-09-01T10:00:00+05:00'))
  assert.equal(result.totalLateMinutes, 15)
  assert.equal(result.totalEarlyLeaveMinutes, 30)
  assert.equal(result.deductions.lateDeduction, 15_000)
  assert.equal(result.deductions.earlyLeaveDeduction, 30_000)
})
