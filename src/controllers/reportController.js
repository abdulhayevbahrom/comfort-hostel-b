import { Expense } from '../models/Expense.js'
import { Employee } from '../models/Employee.js'
import { Fine } from '../models/Fine.js'
import { FinePayment } from '../models/FinePayment.js'
import { Payment } from '../models/Payment.js'
import { Room } from '../models/Room.js'
import { SalaryPayment } from '../models/SalaryPayment.js'
import { Student } from '../models/Student.js'
import { StudentContract } from '../models/StudentContract.js'
import { ApiResponse } from '../utils/response.js'

const MONTH_NAMES = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

const total = (rows) => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
const asMap = (rows) => new Map(rows.map((row) => [Number(row._id), Number(row.amount || 0)]))
const sumField = (rows, field = 'amount') => rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)

const aggregateByDay = (Model, match, dateField) => Model.aggregate([
  { $match: match },
  { $group: { _id: { $dayOfMonth: { date: `$${dateField}`, timezone: 'Asia/Tashkent' } }, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  { $sort: { _id: 1 } },
])

const aggregateByMonth = (Model, match, dateField) => Model.aggregate([
  { $match: match },
  { $group: { _id: { $month: { date: `$${dateField}`, timezone: 'Asia/Tashkent' } }, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  { $sort: { _id: 1 } },
])

class ReportController {
  getMonthly = async (req, res, next) => {
    try {
      const fallback = new Date()
      const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.period || ''))
        ? String(req.query.period)
        : `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}`
      const [year, month] = period.split('-').map(Number)
      const start = new Date(year, month - 1, 1)
      const end = new Date(year, month, 1)
      const dateMatch = { $gte: start, $lt: end }

      const [incomeRows, expenseRows, salaryRows, methods, categories, details] = await Promise.all([
        aggregateByDay(Payment, { createdAt: dateMatch }, 'createdAt'),
        aggregateByDay(Expense, { spentAt: dateMatch }, 'spentAt'),
        SalaryPayment.aggregate([{ $match: { period } }, { $group: { _id: { $dayOfMonth: { date: '$createdAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        Payment.aggregate([{ $match: { createdAt: dateMatch } }, { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
        Expense.aggregate([{ $match: { spentAt: dateMatch } }, { $group: { _id: '$category', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
        this.details({ dateMatch, period }),
      ])

      const incomeMap = asMap(incomeRows)
      const expenseMap = asMap(expenseRows)
      const salaryMap = asMap(salaryRows)
      const days = new Date(year, month, 0).getDate()
      const rows = Array.from({ length: days }, (_, index) => {
        const day = index + 1
        const income = incomeMap.get(day) || 0
        const expenses = expenseMap.get(day) || 0
        const salaries = salaryMap.get(day) || 0
        return { key: day, label: `${day}-${MONTH_NAMES[month - 1]}`, income, expenses, salaries, balance: income - expenses - salaries }
      })

      return ApiResponse.ok(res, { type: 'monthly', period, rows, summary: this.summary(incomeRows, expenseRows, salaryRows), methods, categories, details })
    } catch (error) { return next(error) }
  }

  getYearly = async (req, res, next) => {
    try {
      const currentYear = new Date().getFullYear()
      const year = /^\d{4}$/.test(String(req.query.year || '')) ? Number(req.query.year) : currentYear
      const start = new Date(year, 0, 1)
      const end = new Date(year + 1, 0, 1)
      const dateMatch = { $gte: start, $lt: end }
      const periodMatch = { $gte: `${year}-01`, $lte: `${year}-12` }

      const [incomeRows, expenseRows, salaryRows, methods, categories, details] = await Promise.all([
        aggregateByMonth(Payment, { createdAt: dateMatch }, 'createdAt'),
        aggregateByMonth(Expense, { spentAt: dateMatch }, 'spentAt'),
        SalaryPayment.aggregate([{ $match: { period: periodMatch } }, { $group: { _id: { $toInt: { $substrBytes: ['$period', 5, 2] } }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
        Payment.aggregate([{ $match: { createdAt: dateMatch } }, { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
        Expense.aggregate([{ $match: { spentAt: dateMatch } }, { $group: { _id: '$category', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
        this.details({ dateMatch, periodMatch }),
      ])

      const incomeMap = asMap(incomeRows)
      const expenseMap = asMap(expenseRows)
      const salaryMap = asMap(salaryRows)
      const rows = MONTH_NAMES.map((label, index) => {
        const key = index + 1
        const income = incomeMap.get(key) || 0
        const expenses = expenseMap.get(key) || 0
        const salaries = salaryMap.get(key) || 0
        return { key, label, income, expenses, salaries, balance: income - expenses - salaries }
      })

      return ApiResponse.ok(res, { type: 'yearly', year, rows, summary: this.summary(incomeRows, expenseRows, salaryRows), methods, categories, details })
    } catch (error) { return next(error) }
  }

  summary = (incomeRows, expenseRows, salaryRows) => {
    const income = total(incomeRows)
    const expenses = total(expenseRows)
    const salaries = total(salaryRows)
    return { income, expenses, salaries, outflow: expenses + salaries, balance: income - expenses - salaries }
  }

  details = async ({ dateMatch, period, periodMatch }) => {
    const contractMatch = { createdAt: dateMatch }
    const salaryMatch = period ? { period } : { period: periodMatch }
    const [
      studentTotal,
      studentNew,
      studentsByGender,
      studentsByStatus,
      roomTotal,
      roomsByStatus,
      roomCapacity,
      activeContracts,
      contractsCreated,
      contractsByStatus,
      contractTotals,
      finesIssued,
      finePayments,
      fineTotals,
      employeeTotal,
      activeEmployees,
      payrollTotals,
      salaryPayments,
    ] = await Promise.all([
      Student.countDocuments(),
      Student.countDocuments({ createdAt: dateMatch }),
      Student.aggregate([{ $group: { _id: '$gender', count: { $sum: 1 } } }]),
      Student.aggregate([{ $group: { _id: '$studentStatus', count: { $sum: 1 } } }]),
      Room.countDocuments(),
      Room.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Room.aggregate([{ $group: { _id: null, capacity: { $sum: '$capacity' } } }]),
      StudentContract.countDocuments({ status: 'active' }),
      StudentContract.countDocuments(contractMatch),
      StudentContract.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      StudentContract.aggregate([{ $match: contractMatch }, { $group: { _id: null, amount: { $sum: '$totalAmount' }, count: { $sum: 1 } } }]),
      Fine.countDocuments({ createdAt: dateMatch }),
      FinePayment.aggregate([{ $match: { createdAt: dateMatch } }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      Fine.aggregate([{ $group: { _id: null, amount: { $sum: '$amount' }, paid: { $sum: '$paidAmount' }, count: { $sum: 1 } } }]),
      Employee.countDocuments(),
      Employee.countDocuments({ isActive: true }),
      Employee.aggregate([{ $group: { _id: null, salary: { $sum: '$salary' } } }]),
      SalaryPayment.aggregate([{ $match: salaryMatch }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    ])

    const roomCapacityValue = Number(roomCapacity[0]?.capacity || 0)
    const fineAmount = Number(fineTotals[0]?.amount || 0)
    const finePaid = Number(fineTotals[0]?.paid || 0)

    return {
      students: { total: studentTotal, new: studentNew, byGender: studentsByGender, byStatus: studentsByStatus },
      rooms: { total: roomTotal, capacity: roomCapacityValue, occupied: activeContracts, free: Math.max(roomCapacityValue - activeContracts, 0), byStatus: roomsByStatus },
      contracts: { active: activeContracts, created: contractsCreated, amount: sumField(contractTotals), byStatus: contractsByStatus },
      fines: { issued: finesIssued, paidAmount: sumField(finePayments), paidCount: finePayments[0]?.count || 0, totalAmount: fineAmount, debt: Math.max(fineAmount - finePaid, 0) },
      employees: { total: employeeTotal, active: activeEmployees, inactive: Math.max(employeeTotal - activeEmployees, 0), payroll: Number(payrollTotals[0]?.salary || 0) },
      salaries: { paidAmount: sumField(salaryPayments), paidCount: salaryPayments[0]?.count || 0 },
    }
  }
}

export const reportController = new ReportController()
