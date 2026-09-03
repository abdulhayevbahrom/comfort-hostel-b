import mongoose from 'mongoose'
import { Employee } from '../models/Employee.js'
import { EmployeeAttendance } from '../models/EmployeeAttendance.js'
import { EmployeeBonus } from '../models/EmployeeBonus.js'
import { EmployeePenaltyWaiver } from '../models/EmployeePenaltyWaiver.js'
import { SalaryPayment } from '../models/SalaryPayment.js'
import { ApiResponse } from '../utils/response.js'
import { calculateEmployeePayroll } from '../utils/employeePayroll.js'
import { dateKeyInTimeZone, shiftDurationMinutes } from '../utils/faceTime.js'
import { employeeSchedule, getEmployeeAttendanceSettings, reconcileScheduledEmployeeExits } from '../utils/employeeSchedule.js'

const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const monthIndex = (period) => {
  const [year, month] = period.split('-').map(Number)
  return year * 12 + month - 1
}
const periodFromIndex = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
const periodParts = (period) => period.split('-').map(Number)
const businessUnit = (req) => req.query?.businessUnit === 'shop' || req.body?.businessUnit === 'shop' ? 'shop' : 'hostel'
const unitFilter = (unit) => unit === 'shop' ? { businessUnit: 'shop' } : { businessUnit: { $ne: 'shop' } }

class SalaryController {
  emitChange(req, action, payment) {
    req.app.get('io')?.emit('salaries:changed', {
      action,
      employeeId: payment?.employee?._id?.toString?.() || payment?.employee?.toString?.(),
      period: payment?.period,
    })
  }

  summary = async (req, res, next) => {
    try {
      const period = periodPattern.test(req.query.period || '') ? req.query.period : dateKeyInTimeZone(new Date()).slice(0, 7)
      const unit = businessUnit(req)
      const employees = await Employee.find({ isActive: true, ...unitFilter(unit) }).sort({ firstname: 1, lastname: 1 })
      const earliestStart = employees.map((employee) => employee.payrollStartMonth || period).sort()[0] || period
      const attendanceSettings = await getEmployeeAttendanceSettings()
      await reconcileScheduledEmployeeExits(attendanceSettings.schedule)
      const [payments, attendances, bonuses, waivers] = await Promise.all([
        SalaryPayment.find({ period: { $lte: period }, ...unitFilter(unit) }).populate('createdBy', 'firstname lastname').sort({ createdAt: -1 }),
        EmployeeAttendance.find({ employee: { $in: employees.map((employee) => employee._id) }, date: { $gte: `${earliestStart}-01`, $lte: `${period}-31` } }),
        EmployeeBonus.find({ period: { $lte: period }, ...unitFilter(unit) }).populate('createdBy', 'firstname lastname').sort({ createdAt: -1 }),
        EmployeePenaltyWaiver.find({ employee: { $in: employees.map((employee) => employee._id) }, date: { $gte: `${earliestStart}-01`, $lte: `${period}-31` } }),
      ])
      const attendanceByEmployeePeriod = new Map()
      attendances.forEach((attendance) => {
        const key = `${attendance.employee}:${attendance.date.slice(0, 7)}`
        if (!attendanceByEmployeePeriod.has(key)) attendanceByEmployeePeriod.set(key, [])
        attendanceByEmployeePeriod.get(key).push(attendance)
      })
      const waivedDatesByEmployeePeriod = new Map()
      waivers.forEach((waiver) => {
        const key = `${waiver.employee}:${waiver.date.slice(0, 7)}`
        if (!waivedDatesByEmployeePeriod.has(key)) waivedDatesByEmployeePeriod.set(key, new Set())
        waivedDatesByEmployeePeriod.get(key).add(waiver.date)
      })
      const selectedIndex = monthIndex(period)
      const rows = employees.map((employee) => {
        const startPeriod = employee.payrollStartMonth || period
        const startIndex = monthIndex(startPeriod)
        const employeePayments = payments.filter((item) => item.employee.toString() === employee.id)
        const employeeBonuses = bonuses.filter((item) => item.employee.toString() === employee.id)
        const priorPaid = employeePayments.filter((item) => item.period < period).reduce((sum, item) => sum + item.amount, 0)
        const paidThisMonth = employeePayments.filter((item) => item.period === period).reduce((sum, item) => sum + item.amount, 0)
        let priorAccrued = 0
        for (let index = startIndex; index < selectedIndex; index += 1) {
          const payrollPeriod = periodFromIndex(index)
          const [payrollYear, payrollMonth] = periodParts(payrollPeriod)
          const monthly = calculateEmployeePayroll(employee, attendanceByEmployeePeriod.get(`${employee.id}:${payrollPeriod}`) || [], payrollYear, payrollMonth, new Date(), {
            schedule: employeeSchedule(employee, attendanceSettings.schedule),
            waivedDates: waivedDatesByEmployeePeriod.get(`${employee.id}:${payrollPeriod}`) || new Set(),
          })
          const monthlyBonus = employeeBonuses.filter((item) => item.period === payrollPeriod).reduce((sum, item) => sum + item.amount, 0)
          priorAccrued += monthly.netSalary + monthlyBonus
        }
        const previousBalance = Number(employee.payrollOpeningBalance || 0) + priorAccrued - priorPaid
        const [year, month] = periodParts(period)
        const payroll = selectedIndex >= startIndex
          ? calculateEmployeePayroll(employee, attendanceByEmployeePeriod.get(`${employee.id}:${period}`) || [], year, month, new Date(), {
            schedule: employeeSchedule(employee, attendanceSettings.schedule),
            waivedDates: waivedDatesByEmployeePeriod.get(`${employee.id}:${period}`) || new Set(),
          })
          : { baseSalary: 0, netSalary: 0, presentDays: 0, absentDays: 0, totalLateMinutes: 0, totalEarlyLeaveMinutes: 0, deductions: { totalDeduction: 0 } }
        const schedule = employeeSchedule(employee, attendanceSettings.schedule)
        const waivedDates = waivedDatesByEmployeePeriod.get(`${employee.id}:${period}`) || new Set()
        const penaltyRows = [
          ...(payroll.lateDates || []).map((item) => ({ date: item.date, type: 'late', label: 'Kechikish', detail: `${item.minutes} daq.`, amount: item.waived ? 0 : item.minutes * Number(payroll.deductions?.penaltyRate || 0), waived: item.waived })),
          ...(payroll.earlyLeaveDates || []).map((item) => ({ date: item.date, type: 'early_leave', label: 'Erta ketish', detail: `${item.minutes} daq.`, amount: item.waived ? 0 : item.minutes * Number(payroll.deductions?.penaltyRate || 0), waived: item.waived })),
          ...(payroll.absentDates || []).map((date) => ({ date, type: 'absent', label: 'Kelmagan kun', detail: '1 kun', amount: waivedDates.has(date) ? 0 : Number(payroll.deductions?.minuteRate || 0) * shiftDurationMinutes(schedule), waived: waivedDates.has(date) })),
        ].sort((left, right) => left.date.localeCompare(right.date))
        const currentBonuses = employeeBonuses.filter((item) => item.period === period)
        const bonusAmount = currentBonuses.reduce((sum, item) => sum + item.amount, 0)
        const salaryForPeriod = payroll.netSalary + bonusAmount
        const currentBalance = previousBalance + salaryForPeriod - paidThisMonth
        return {
          employee,
          salary: salaryForPeriod,
          baseSalary: payroll.baseSalary,
          payroll,
          penaltyRows,
          bonusAmount,
          bonuses: currentBonuses,
          previousBalance,
          paidThisMonth,
          currentBalance,
          payments: employeePayments.filter((item) => item.period === period),
        }
      })
      const totals = rows.reduce((result, row) => ({
        salary: result.salary + row.salary,
        baseSalary: result.baseSalary + row.baseSalary,
        bonuses: result.bonuses + row.bonusAmount,
        deductions: result.deductions + Number(row.payroll?.deductions?.totalDeduction || 0),
        paid: result.paid + row.paidThisMonth,
        receivable: result.receivable + Math.max(0, row.currentBalance),
        debt: result.debt + Math.max(0, -row.currentBalance),
      }), { salary: 0, baseSalary: 0, bonuses: 0, deductions: 0, paid: 0, receivable: 0, debt: 0 })
      return ApiResponse.ok(res, { period, businessUnit: unit, rows, totals })
    } catch (error) { return next(error) }
  }

  history = async (req, res, next) => {
    try {
      const filter = {}
      Object.assign(filter, unitFilter(businessUnit(req)))
      if (req.query.employeeId) {
        if (!mongoose.isValidObjectId(req.query.employeeId)) return ApiResponse.badRequest(res, 'Xodim noto‘g‘ri tanlangan')
        filter.employee = req.query.employeeId
      }
      if (periodPattern.test(req.query.period || '')) filter.period = req.query.period
      const payments = await SalaryPayment.find(filter)
        .populate('employee', 'firstname lastname position salary')
        .populate('createdBy', 'firstname lastname')
        .sort({ createdAt: -1 })
        .limit(500)
      return ApiResponse.ok(res, { payments })
    } catch (error) { return next(error) }
  }

  pay = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.body.employeeId)) return ApiResponse.badRequest(res, 'Xodimni tanlang')
      if (!periodPattern.test(req.body.period || '')) return ApiResponse.badRequest(res, 'Oylik davrini tanlang')
      const amount = Number(req.body.amount)
      if (!Number.isFinite(amount) || amount < 1) return ApiResponse.badRequest(res, 'To‘lov summasini to‘g‘ri kiriting')
      const employee = await Employee.findById(req.body.employeeId)
      const unit = businessUnit(req)
      if (!employee || (employee.businessUnit || 'hostel') !== unit) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const payment = await SalaryPayment.create({
        businessUnit: unit,
        employee: employee._id,
        period: req.body.period,
        amount,
        paymentType: ['cash', 'card', 'bank'].includes(req.body.paymentType) ? req.body.paymentType : 'cash',
        note: String(req.body.note || '').trim(),
        createdBy: req.employee._id,
      })
      await payment.populate([{ path: 'employee', select: 'firstname lastname position salary' }, { path: 'createdBy', select: 'firstname lastname' }])
      this.emitChange(req, 'created', payment)
      return ApiResponse.created(res, { payment }, 'Oylik to‘lovi saqlandi')
    } catch (error) { return next(error) }
  }

  addBonus = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.body.employeeId)) return ApiResponse.badRequest(res, 'Xodimni tanlang')
      if (!periodPattern.test(req.body.period || '')) return ApiResponse.badRequest(res, 'Bonus davrini tanlang')
      const amount = Number(req.body.amount)
      if (!Number.isFinite(amount) || amount < 1) return ApiResponse.badRequest(res, 'Bonus summasini to‘g‘ri kiriting')
      const reason = String(req.body.reason || '').trim()
      if (!reason) return ApiResponse.badRequest(res, 'Bonus sababini kiriting')
      const employee = await Employee.findById(req.body.employeeId)
      const unit = businessUnit(req)
      if (!employee || (employee.businessUnit || 'hostel') !== unit) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const bonus = await EmployeeBonus.create({ businessUnit: unit, employee: employee._id, period: req.body.period, amount, reason, createdBy: req.employee._id })
      await bonus.populate([{ path: 'employee', select: 'firstname lastname position salary' }, { path: 'createdBy', select: 'firstname lastname' }])
      this.emitChange(req, 'bonus-created', bonus)
      return ApiResponse.created(res, { bonus }, 'Bonus oylik hisobiga qo‘shildi')
    } catch (error) { return next(error) }
  }

  removeBonus = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Bonus topilmadi')
      const bonus = await EmployeeBonus.findOneAndDelete({ _id: req.params.id, ...unitFilter(businessUnit(req)) })
      if (!bonus) return ApiResponse.notFound(res, 'Bonus topilmadi')
      this.emitChange(req, 'bonus-deleted', bonus)
      return ApiResponse.ok(res, { bonusId: bonus.id }, 'Bonus o‘chirildi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      const payment = await SalaryPayment.findOneAndDelete({ _id: req.params.id, ...unitFilter(businessUnit(req)) })
      if (!payment) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      this.emitChange(req, 'deleted', payment)
      return ApiResponse.ok(res, { paymentId: payment.id }, 'Oylik to‘lovi o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const salaryController = new SalaryController()
