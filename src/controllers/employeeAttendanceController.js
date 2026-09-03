import mongoose from 'mongoose'
import { Employee } from '../models/Employee.js'
import { EmployeeAttendance } from '../models/EmployeeAttendance.js'
import { EmployeePenaltyWaiver } from '../models/EmployeePenaltyWaiver.js'
import { dateKeyInTimeZone, minutesFromTime, minutesInTimeZone, shiftCrossesMidnight, shiftDurationMinutes } from '../utils/faceTime.js'
import { calculateEmployeePayroll } from '../utils/employeePayroll.js'
import { employeeSchedule, getEmployeeAttendanceSettings, reconcileScheduledEmployeeExits } from '../utils/employeeSchedule.js'
import { ApiResponse } from '../utils/response.js'

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
const isWorkDay = (schedule, date) => {
  if (Array.isArray(schedule.offDates) && schedule.offDates.includes(date)) return false
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return (schedule.workDays || [1, 2, 3, 4, 5, 6]).includes(weekday)
}
const metrics = (schedule, attendance, date) => {
  if (!attendance) return { status: !isWorkDay(schedule, date) ? 'off_day' : date >= dateKeyInTimeZone(new Date()) ? 'pending' : 'absent', lateMinutes: 0, earlyLeaveMinutes: 0 }
  const start = minutesFromTime(schedule.checkInTime); const crosses = shiftCrossesMidnight(schedule)
  const rawEntry = minutesInTimeZone(attendance.firstEntry); const entry = rawEntry !== null && crosses && rawEntry < start ? rawEntry + 1440 : rawEntry
  const allowedEntry = start + Number(schedule.lateAfterMinutes || 0)
  const rawExit = minutesInTimeZone(attendance.lastExit); const exit = rawExit !== null && crosses && rawExit <= start ? rawExit + 1440 : rawExit
  const expectedExit = minutesFromTime(schedule.checkOutTime) + (crosses ? 1440 : 0) - Number(schedule.earlyLeaveMinutes || 0)
  const lateMinutes = entry !== null ? Math.max(0, entry - allowedEntry) : 0
  const earlyLeaveMinutes = exit !== null ? Math.max(0, expectedExit - exit) : 0
  return { status: lateMinutes ? 'late' : attendance.currentEntry ? 'inside' : 'present', lateMinutes, earlyLeaveMinutes }
}

class EmployeeAttendanceController {
  list = async (req, res, next) => {
    try {
      const date = validDate(req.query.date) ? String(req.query.date) : dateKeyInTimeZone(new Date())
      const attendanceSettings = await getEmployeeAttendanceSettings()
      const exitState = await reconcileScheduledEmployeeExits(attendanceSettings.schedule)
      const unitFilter = req.query.businessUnit === 'shop' ? { businessUnit: 'shop' } : { businessUnit: { $ne: 'shop' } }
      const employees = await Employee.find({ isActive: true, ...unitFilter }).sort({ firstname: 1, lastname: 1 })
      const records = await EmployeeAttendance.find({ employee: { $in: employees.map((employee) => employee._id) }, date })
      const byEmployee = new Map(records.map((record) => [record.employee.toString(), record]))
      const rows = employees.map((employee) => {
        const attendance = byEmployee.get(employee.id) || null
        const schedule = employeeSchedule(employee, attendanceSettings.schedule)
        return { employee, attendance, schedule, ...metrics(schedule, attendance, date) }
      })
      const summary = {
        total: rows.length,
        present: rows.filter((row) => row.attendance).length,
        absent: rows.filter((row) => row.status === 'absent').length,
        late: rows.filter((row) => row.lateMinutes > 0).length,
        inside: rows.filter((row) => row.attendance?.currentEntry).length,
        pending: rows.filter((row) => row.status === 'pending').length,
      }
      return ApiResponse.ok(res, { date, rows, summary, schedule: attendanceSettings.schedule, hasOutDevice: exitState.hasOutDevice })
    } catch (error) { return next(error) }
  }

  history = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.employeeId)) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : dateKeyInTimeZone(new Date()).slice(0, 7)
      const employee = await Employee.findById(req.params.employeeId)
      if (!employee) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const attendanceSettings = await getEmployeeAttendanceSettings()
      const exitState = await reconcileScheduledEmployeeExits(attendanceSettings.schedule)
      const records = await EmployeeAttendance.find({ employee: employee._id, date: { $regex: `^${month}-` } }).sort({ date: 1 })
      const waivers = await EmployeePenaltyWaiver.find({ employee: employee._id, date: { $regex: `^${month}-` } })
        .populate('waivedBy', 'firstname lastname position')
        .sort({ createdAt: -1 })
      const waiverByDate = new Map(waivers.map((waiver) => [waiver.date, waiver]))
      const [year, monthNumber] = month.split('-').map(Number)
      const schedule = employeeSchedule(employee, attendanceSettings.schedule)
      const payroll = calculateEmployeePayroll(employee, records, year, monthNumber, new Date(), { schedule, waivedDates: new Set(waiverByDate.keys()) })
      const penaltyRate = Number(payroll.deductions.penaltyRate || 0)
      const rows = records.map((attendance) => {
        const row = metrics(schedule, attendance, attendance.date)
        const waiver = waiverByDate.get(attendance.date) || null
        return {
          date: attendance.date,
          ...row,
          attendance,
          penaltyWaived: Boolean(waiver),
          penaltyWaiver: waiver,
          latePenalty: waiver ? 0 : row.lateMinutes * penaltyRate,
          earlyLeavePenalty: waiver ? 0 : row.earlyLeaveMinutes * penaltyRate,
          originalLatePenalty: row.lateMinutes * penaltyRate,
          originalEarlyLeavePenalty: row.earlyLeaveMinutes * penaltyRate,
          originalAbsencePenalty: 0,
        }
      })
      for (const date of payroll.absentDates) {
        if (records.some((attendance) => attendance.date === date)) continue
        const waiver = waiverByDate.get(date) || null
        const originalAbsencePenalty = Number(payroll.deductions.minuteRate || 0) * shiftDurationMinutes(schedule)
        rows.push({
          date,
          attendance: null,
          ...metrics(schedule, null, date),
          penaltyWaived: Boolean(waiver),
          penaltyWaiver: waiver,
          latePenalty: 0,
          earlyLeavePenalty: 0,
          absencePenalty: waiver ? 0 : originalAbsencePenalty,
          originalLatePenalty: 0,
          originalEarlyLeavePenalty: 0,
          originalAbsencePenalty,
        })
      }
      rows.sort((left, right) => left.date.localeCompare(right.date))
      return ApiResponse.ok(res, {
        employee,
        month,
        rows,
        payroll,
        summary: {
          presentDays: records.length,
          lateDays: rows.filter((row) => row.lateMinutes > 0).length,
          earlyLeaveDays: rows.filter((row) => row.earlyLeaveMinutes > 0).length,
          totalLateMinutes: rows.reduce((sum, row) => sum + row.lateMinutes, 0),
          totalEarlyLeaveMinutes: rows.reduce((sum, row) => sum + row.earlyLeaveMinutes, 0),
          totalWorkedHours: records.reduce((sum, record) => sum + Number(record.totalHours || 0), 0),
          lateDeduction: payroll.deductions.lateDeduction,
          earlyLeaveDeduction: payroll.deductions.earlyLeaveDeduction,
          absenceDeduction: payroll.deductions.absenceDeduction,
          totalDeduction: payroll.deductions.totalDeduction,
          waivedAmount: waivers.reduce((sum, waiver) => sum + Number(waiver.totalAmount || 0), 0),
        },
        waivers,
        schedule,
        hasOutDevice: exitState.hasOutDevice,
      })
    } catch (error) { return next(error) }
  }

  waivePenalty = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.employeeId)) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const date = String(req.params.date || '')
      if (!validDate(date)) return ApiResponse.badRequest(res, 'Sana noto‘g‘ri')
      const reason = String(req.body.reason || '').trim()
      if (reason.length < 3) return ApiResponse.badRequest(res, 'Jarimani bekor qilish sababini kiriting')
      const employee = await Employee.findById(req.params.employeeId)
      if (!employee) return ApiResponse.notFound(res, 'Xodim topilmadi')
      if (await EmployeePenaltyWaiver.exists({ employee: employee._id, date })) return ApiResponse.conflict(res, 'Bu kun jarimasi avval bekor qilingan')
      const attendanceSettings = await getEmployeeAttendanceSettings()
      await reconcileScheduledEmployeeExits(attendanceSettings.schedule)
      const attendance = await EmployeeAttendance.findOne({ employee: employee._id, date })
      const [year, month] = date.slice(0, 7).split('-').map(Number)
      const schedule = employeeSchedule(employee, attendanceSettings.schedule)
      const payroll = calculateEmployeePayroll(employee, attendance ? [attendance] : [], year, month, new Date(), { schedule })
      const row = metrics(schedule, attendance, date)
      const penaltyRate = Number(payroll.deductions.penaltyRate || 0)
      const latePenalty = row.lateMinutes * penaltyRate
      const earlyLeavePenalty = row.earlyLeaveMinutes * penaltyRate
      const absencePenalty = !attendance && payroll.absentDates.includes(date)
        ? Number(payroll.deductions.minuteRate || 0) * shiftDurationMinutes(schedule)
        : 0
      const totalAmount = latePenalty + earlyLeavePenalty + absencePenalty
      if (totalAmount <= 0) return ApiResponse.badRequest(res, 'Bu kunda bekor qilinadigan jarima yo‘q')
      const waiver = await EmployeePenaltyWaiver.create({
        employee: employee._id,
        date,
        reason,
        latePenalty,
        earlyLeavePenalty,
        absencePenalty,
        totalAmount,
        waivedBy: req.employee._id,
      })
      await waiver.populate('waivedBy', 'firstname lastname position')
      req.app.get('io')?.emit('employee-attendance:changed', { employeeId: employee.id, date, action: 'penalty-waived' })
      req.app.get('io')?.emit('salaries:changed', { employeeId: employee.id, period: date.slice(0, 7), action: 'penalty-waived' })
      return ApiResponse.created(res, { waiver }, 'Kunlik jarima bekor qilindi')
    } catch (error) { return next(error) }
  }
}

export const employeeAttendanceController = new EmployeeAttendanceController()
