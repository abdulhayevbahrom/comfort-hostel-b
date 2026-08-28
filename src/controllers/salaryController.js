import mongoose from 'mongoose'
import { Employee } from '../models/Employee.js'
import { EmployeeAttendance } from '../models/EmployeeAttendance.js'
import { SalaryPayment } from '../models/SalaryPayment.js'
import { ApiResponse } from '../utils/response.js'
import { calculateEmployeePayroll } from '../utils/employeePayroll.js'
import { dateKeyInTimeZone } from '../utils/faceTime.js'

const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const monthIndex = (period) => {
  const [year, month] = period.split('-').map(Number)
  return year * 12 + month - 1
}
const periodFromIndex = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
const periodParts = (period) => period.split('-').map(Number)

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
      const employees = await Employee.find({ isActive: true }).sort({ firstname: 1, lastname: 1 })
      const earliestStart = employees.map((employee) => employee.payrollStartMonth || period).sort()[0] || period
      const [payments, attendances] = await Promise.all([
        SalaryPayment.find({ period: { $lte: period } }).populate('createdBy', 'firstname lastname').sort({ createdAt: -1 }),
        EmployeeAttendance.find({ employee: { $in: employees.map((employee) => employee._id) }, date: { $gte: `${earliestStart}-01`, $lte: `${period}-31` } }),
      ])
      const attendanceByEmployeePeriod = new Map()
      attendances.forEach((attendance) => {
        const key = `${attendance.employee}:${attendance.date.slice(0, 7)}`
        if (!attendanceByEmployeePeriod.has(key)) attendanceByEmployeePeriod.set(key, [])
        attendanceByEmployeePeriod.get(key).push(attendance)
      })
      const selectedIndex = monthIndex(period)
      const rows = employees.map((employee) => {
        const startPeriod = employee.payrollStartMonth || period
        const startIndex = monthIndex(startPeriod)
        const employeePayments = payments.filter((item) => item.employee.toString() === employee.id)
        const priorPaid = employeePayments.filter((item) => item.period < period).reduce((sum, item) => sum + item.amount, 0)
        const paidThisMonth = employeePayments.filter((item) => item.period === period).reduce((sum, item) => sum + item.amount, 0)
        let priorAccrued = 0
        for (let index = startIndex; index < selectedIndex; index += 1) {
          const payrollPeriod = periodFromIndex(index)
          const [payrollYear, payrollMonth] = periodParts(payrollPeriod)
          const monthly = calculateEmployeePayroll(employee, attendanceByEmployeePeriod.get(`${employee.id}:${payrollPeriod}`) || [], payrollYear, payrollMonth)
          priorAccrued += monthly.netSalary
        }
        const previousBalance = Number(employee.payrollOpeningBalance || 0) + priorAccrued - priorPaid
        const [year, month] = periodParts(period)
        const payroll = selectedIndex >= startIndex
          ? calculateEmployeePayroll(employee, attendanceByEmployeePeriod.get(`${employee.id}:${period}`) || [], year, month)
          : { baseSalary: 0, netSalary: 0, presentDays: 0, absentDays: 0, totalLateMinutes: 0, totalEarlyLeaveMinutes: 0, deductions: { totalDeduction: 0 } }
        const salaryForPeriod = payroll.netSalary
        const currentBalance = previousBalance + salaryForPeriod - paidThisMonth
        return {
          employee,
          salary: salaryForPeriod,
          baseSalary: payroll.baseSalary,
          payroll,
          previousBalance,
          paidThisMonth,
          currentBalance,
          payments: employeePayments.filter((item) => item.period === period),
        }
      })
      const totals = rows.reduce((result, row) => ({
        salary: result.salary + row.salary,
        paid: result.paid + row.paidThisMonth,
        receivable: result.receivable + Math.max(0, row.currentBalance),
        debt: result.debt + Math.max(0, -row.currentBalance),
      }), { salary: 0, paid: 0, receivable: 0, debt: 0 })
      return ApiResponse.ok(res, { period, rows, totals })
    } catch (error) { return next(error) }
  }

  history = async (req, res, next) => {
    try {
      const filter = {}
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
      if (!employee) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const payment = await SalaryPayment.create({
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

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      const payment = await SalaryPayment.findByIdAndDelete(req.params.id)
      if (!payment) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      this.emitChange(req, 'deleted', payment)
      return ApiResponse.ok(res, { paymentId: payment.id }, 'Oylik to‘lovi o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const salaryController = new SalaryController()
