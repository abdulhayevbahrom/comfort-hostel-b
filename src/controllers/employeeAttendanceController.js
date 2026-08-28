import mongoose from 'mongoose'
import { Employee } from '../models/Employee.js'
import { EmployeeAttendance } from '../models/EmployeeAttendance.js'
import { dateKeyInTimeZone, minutesFromTime, minutesInTimeZone, shiftCrossesMidnight } from '../utils/faceTime.js'
import { ApiResponse } from '../utils/response.js'

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
const isWorkDay = (employee, date) => {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return (employee.workSchedule?.workDays || [1, 2, 3, 4, 5, 6]).includes(weekday)
}
const metrics = (employee, attendance, date) => {
  if (!attendance) return { status: !isWorkDay(employee, date) ? 'off_day' : date >= dateKeyInTimeZone(new Date()) ? 'pending' : 'absent', lateMinutes: 0, earlyLeaveMinutes: 0 }
  const schedule = employee.workSchedule || {}; const start = minutesFromTime(schedule.checkInTime); const crosses = shiftCrossesMidnight(schedule)
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
      const employees = await Employee.find({ isActive: true }).sort({ firstname: 1, lastname: 1 })
      const records = await EmployeeAttendance.find({ employee: { $in: employees.map((employee) => employee._id) }, date })
      const byEmployee = new Map(records.map((record) => [record.employee.toString(), record]))
      const rows = employees.map((employee) => {
        const attendance = byEmployee.get(employee.id) || null
        return { employee, attendance, ...metrics(employee, attendance, date) }
      })
      const summary = {
        total: rows.length,
        present: rows.filter((row) => row.attendance).length,
        absent: rows.filter((row) => row.status === 'absent').length,
        late: rows.filter((row) => row.lateMinutes > 0).length,
        inside: rows.filter((row) => row.attendance?.currentEntry).length,
        pending: rows.filter((row) => row.status === 'pending').length,
      }
      return ApiResponse.ok(res, { date, rows, summary })
    } catch (error) { return next(error) }
  }

  history = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.employeeId)) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : dateKeyInTimeZone(new Date()).slice(0, 7)
      const employee = await Employee.findById(req.params.employeeId)
      if (!employee) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const records = await EmployeeAttendance.find({ employee: employee._id, date: { $regex: `^${month}-` } }).sort({ date: 1 })
      const rows = records.map((attendance) => ({ attendance, ...metrics(employee, attendance, attendance.date) }))
      return ApiResponse.ok(res, { employee, month, rows, summary: { presentDays: rows.length, lateDays: rows.filter((row) => row.lateMinutes > 0).length, totalLateMinutes: rows.reduce((sum, row) => sum + row.lateMinutes, 0), totalEarlyLeaveMinutes: rows.reduce((sum, row) => sum + row.earlyLeaveMinutes, 0), totalWorkedHours: records.reduce((sum, record) => sum + Number(record.totalHours || 0), 0) } })
    } catch (error) { return next(error) }
  }
}

export const employeeAttendanceController = new EmployeeAttendanceController()
