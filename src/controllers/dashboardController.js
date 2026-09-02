import { Attendance } from '../models/Attendance.js'
import { ContractInstallment } from '../models/ContractInstallment.js'
import { Employee } from '../models/Employee.js'
import { Expense } from '../models/Expense.js'
import { Fine } from '../models/Fine.js'
import { FinePayment } from '../models/FinePayment.js'
import { Payment } from '../models/Payment.js'
import { Room } from '../models/Room.js'
import { SalaryPayment } from '../models/SalaryPayment.js'
import { StudentContract } from '../models/StudentContract.js'
import { Student } from '../models/Student.js'
import { ApiResponse } from '../utils/response.js'

const localKeys = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
  const dayKey = `${monthKey}-${String(now.getDate()).padStart(2, '0')}`
  return { now, monthKey, dayKey, monthStart: new Date(year, month, 1), monthEnd: new Date(year, month + 1, 1) }
}

const sumField = async (Model, match, field = 'amount') => {
  const [result] = await Model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: `$${field}` }, count: { $sum: 1 } } }])
  return { amount: result?.total || 0, count: result?.count || 0 }
}
const hostelUnitFilter = { businessUnit: { $ne: 'shop' } }

const recentPeriods = (now, count = 6) => Array.from({ length: count }, (_, index) => {
  const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
})

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime())

const rangeDays = (start, end) => {
  const rows = []
  for (let date = new Date(start); date < end; date.setDate(date.getDate() + 1)) rows.push({ day: `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`, key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` })
  return rows
}

class DashboardController {
  get = async (req, res, next) => {
    try {
      const current = localKeys()
      const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.period || '')) ? String(req.query.period) : current.monthKey
      const [selectedYear, selectedMonth] = monthKey.split('-').map(Number)
      const now = current.now
      const requestedStart = isDateKey(req.query.startDate) ? String(req.query.startDate) : null
      const requestedEnd = isDateKey(req.query.endDate) ? String(req.query.endDate) : null
      const fallbackDayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : current.dayKey
      const rangeStartKey = requestedStart && requestedEnd && requestedStart <= requestedEnd ? requestedStart : fallbackDayKey
      const rangeEndKey = requestedStart && requestedEnd && requestedStart <= requestedEnd ? requestedEnd : fallbackDayKey
      const dayKey = rangeEndKey
      const selectedDate = new Date(`${rangeEndKey}T00:00:00`)
      const monthStart = new Date(selectedYear, selectedMonth - 1, 1)
      const monthEnd = new Date(selectedYear, selectedMonth, 1)
      const dayStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())
      const dayEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1)
      const rangeStart = new Date(`${rangeStartKey}T00:00:00`)
      const rangeEnd = new Date(`${rangeEndKey}T00:00:00`)
      rangeEnd.setDate(rangeEnd.getDate() + 1)
      const selectedDayEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 23, 59, 59, 999)
      const activeContractFilter = { status: { $in: ['active', 'completed'] }, startDate: { $lte: selectedDayEnd }, endDate: { $gte: dayStart } }
      const [
        rooms,
        activeContracts,
        employees,
        income,
        monthlyFineIncome,
        expenses,
        salaryPaid,
        installments,
        fines,
        attendance,
        recentPayments,
        recentFinePayments,
        recentExpenses,
        recentSalaries,
        incomeTrend,
        fineIncomeTrend,
        expenseTrend,
        salaryTrend,
        todayIncome,
        todayFineIncome,
        todayExpense,
        paymentMethods,
        finePaymentMethods,
        dailyIncome,
        dailyFineIncome,
        dailyExpenses,
        dailyPaymentMethods,
        dailyFinePaymentMethods,
      ] = await Promise.all([
        Room.find().select('capacity status'),
        StudentContract.find(activeContractFilter).select('student room'),
        Employee.find({ isActive: true, ...hostelUnitFilter }).select('salary'),
        sumField(Payment, { createdAt: { $gte: rangeStart, $lt: rangeEnd } }),
        sumField(FinePayment, { createdAt: { $gte: rangeStart, $lt: rangeEnd } }),
        sumField(Expense, { createdAt: { $gte: rangeStart, $lt: rangeEnd } }),
        sumField(SalaryPayment, { createdAt: { $gte: rangeStart, $lt: rangeEnd }, ...hostelUnitFilter }),
        ContractInstallment.find({ periodKey: monthKey, dueDate: { $lte: selectedDayEnd } }).select('student contract amount paidAmount status dueDate').populate('student', 'fullName').populate({ path: 'contract', select: 'room', populate: { path: 'room', select: 'roomNumber block' } }),
        Fine.find({ $expr: { $lt: ['$paidAmount', '$amount'] } }).select('amount paidAmount student'),
        Attendance.find({ attendanceDate: dayKey }).select('status'),
        Payment.find({ createdAt: { $gte: rangeStart, $lt: rangeEnd } }).populate('student', 'fullName').sort({ createdAt: -1 }).limit(5),
        FinePayment.find({ createdAt: { $gte: rangeStart, $lt: rangeEnd } }).populate('student', 'fullName').sort({ createdAt: -1 }).limit(5),
        Expense.find({ createdAt: { $gte: rangeStart, $lt: rangeEnd } }).populate('createdBy', 'firstname lastname').sort({ createdAt: -1 }).limit(5),
        SalaryPayment.find({ createdAt: { $gte: rangeStart, $lt: rangeEnd }, ...hostelUnitFilter }).populate('employee', 'firstname lastname').sort({ createdAt: -1 }).limit(5),
        Payment.aggregate([{ $match: { createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$amount' } } }]),
        FinePayment.aggregate([{ $match: { createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$amount' } } }]),
        Expense.aggregate([{ $match: { createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$amount' } } }]),
        SalaryPayment.aggregate([{ $match: { period: { $gte: recentPeriods(now)[0] }, ...hostelUnitFilter } }, { $group: { _id: '$period', amount: { $sum: '$amount' } } }]),
        sumField(Payment, { createdAt: { $gte: rangeStart, $lt: rangeEnd } }),
        sumField(FinePayment, { createdAt: { $gte: rangeStart, $lt: rangeEnd } }),
        sumField(Expense, { createdAt: { $gte: rangeStart, $lt: rangeEnd } }),
        Payment.aggregate([{ $match: { createdAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        FinePayment.aggregate([{ $match: { createdAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        Payment.aggregate([{ $match: { createdAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$amount' } } }]),
        FinePayment.aggregate([{ $match: { createdAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$amount' } } }]),
        Expense.aggregate([{ $match: { createdAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$amount' } } }]),
        Payment.aggregate([{ $match: { createdAt: { $gte: dayStart, $lt: dayEnd } } }, { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        FinePayment.aggregate([{ $match: { createdAt: { $gte: dayStart, $lt: dayEnd } } }, { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      ])

      const [depositIncomeRows, depositTrend, dailyDepositIncome, dailyDepositMethods, todayDepositIncomeRows, returnedDepositRows, returnedDepositTrend, dailyReturnedDeposits, todayReturnedDepositRows] = await Promise.all([
        Student.aggregate([{ $unwind: '$depositPayments' }, { $match: { 'depositPayments.paidAt': { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: null, amount: { $sum: '$depositPayments.amount' }, count: { $sum: 1 } } }]),
        Student.aggregate([{ $unwind: '$depositPayments' }, { $match: { 'depositPayments.paidAt': { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$depositPayments.paidAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$depositPayments.amount' } } }]),
        Student.aggregate([{ $unwind: '$depositPayments' }, { $match: { 'depositPayments.paidAt': { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$depositPayments.paidAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$depositPayments.amount' } } }]),
        Student.aggregate([{ $unwind: '$depositPayments' }, { $match: { 'depositPayments.paidAt': { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: '$depositPayments.method', amount: { $sum: '$depositPayments.amount' }, count: { $sum: 1 } } }]),
        Student.aggregate([{ $unwind: '$depositPayments' }, { $match: { 'depositPayments.paidAt': { $gte: dayStart, $lt: dayEnd } } }, { $group: { _id: '$depositPayments.method', amount: { $sum: '$depositPayments.amount' }, count: { $sum: 1 } } }]),
        Student.aggregate([{ $match: { depositType: 'money', depositReturnedAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $unwind: '$depositPayments' }, { $group: { _id: null, amount: { $sum: '$depositPayments.amount' }, count: { $sum: 1 } } }]),
        Student.aggregate([{ $match: { depositType: 'money', depositReturnedAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } } }, { $unwind: '$depositPayments' }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$depositReturnedAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$depositPayments.amount' } } }]),
        Student.aggregate([{ $match: { depositType: 'money', depositReturnedAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $unwind: '$depositPayments' }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$depositReturnedAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$depositPayments.amount' } } }]),
        Student.aggregate([{ $match: { depositType: 'money', depositReturnedAt: { $gte: dayStart, $lt: dayEnd } } }, { $unwind: '$depositPayments' }, { $group: { _id: null, amount: { $sum: '$depositPayments.amount' }, count: { $sum: 1 } } }]),
      ])
      const legacyBase = { depositType: 'money', depositReceivedAt: { $ne: null }, 'depositPayments.0': { $exists: false } }
      const [legacyIncomeRows, legacyTrend, legacyDailyIncome, legacyMethods, legacyTodayMethods, legacyReturnedRows, legacyReturnedTrend, legacyDailyReturns, legacyTodayReturnedRows] = await Promise.all([
        Student.aggregate([{ $match: { ...legacyBase, depositReceivedAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: null, amount: { $sum: '$depositAmount' }, count: { $sum: 1 } } }]),
        Student.aggregate([{ $match: { ...legacyBase, depositReceivedAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$depositReceivedAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$depositAmount' } } }]),
        Student.aggregate([{ $match: { ...legacyBase, depositReceivedAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$depositReceivedAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$depositAmount' } } }]),
        Student.aggregate([{ $match: { ...legacyBase, depositReceivedAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: { $cond: [{ $in: ['$depositPaymentMethod', ['cash', 'online', 'card', 'bank']] }, '$depositPaymentMethod', 'cash'] }, amount: { $sum: '$depositAmount' }, count: { $sum: 1 } } }]),
        Student.aggregate([{ $match: { ...legacyBase, depositReceivedAt: { $gte: dayStart, $lt: dayEnd } } }, { $group: { _id: { $cond: [{ $in: ['$depositPaymentMethod', ['cash', 'online', 'card', 'bank']] }, '$depositPaymentMethod', 'cash'] }, amount: { $sum: '$depositAmount' }, count: { $sum: 1 } } }]),
        Student.aggregate([{ $match: { ...legacyBase, depositReturnedAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: null, amount: { $sum: '$depositAmount' }, count: { $sum: 1 } } }]),
        Student.aggregate([{ $match: { ...legacyBase, depositReturnedAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$depositReturnedAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$depositAmount' } } }]),
        Student.aggregate([{ $match: { ...legacyBase, depositReturnedAt: { $gte: rangeStart, $lt: rangeEnd } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$depositReturnedAt', timezone: 'Asia/Tashkent' } }, amount: { $sum: '$depositAmount' } } }]),
        Student.aggregate([{ $match: { ...legacyBase, depositReturnedAt: { $gte: dayStart, $lt: dayEnd } } }, { $group: { _id: null, amount: { $sum: '$depositAmount' }, count: { $sum: 1 } } }]),
      ])
      depositTrend.push(...legacyTrend)
      dailyDepositIncome.push(...legacyDailyIncome)
      dailyDepositMethods.push(...legacyMethods)
      todayDepositIncomeRows.push(...legacyTodayMethods)
      returnedDepositTrend.push(...legacyReturnedTrend)
      dailyReturnedDeposits.push(...legacyDailyReturns)
      const depositIncome = { amount: depositIncomeRows[0]?.amount || 0, count: depositIncomeRows[0]?.count || 0 }
      depositIncome.amount += legacyIncomeRows[0]?.amount || 0
      depositIncome.count += legacyIncomeRows[0]?.count || 0
      const todayDepositIncome = todayDepositIncomeRows.reduce((sum, item) => sum + Number(item.amount || 0), 0)
      const todayDepositCount = todayDepositIncomeRows.reduce((sum, item) => sum + Number(item.count || 0), 0)
      const returnedDeposit = { amount: returnedDepositRows[0]?.amount || 0, count: returnedDepositRows[0]?.count || 0 }
      const todayReturnedDeposit = { amount: todayReturnedDepositRows[0]?.amount || 0, count: todayReturnedDepositRows[0]?.count || 0 }
      returnedDeposit.amount += legacyReturnedRows[0]?.amount || 0
      returnedDeposit.count += legacyReturnedRows[0]?.count || 0
      todayReturnedDeposit.amount += legacyTodayReturnedRows[0]?.amount || 0
      todayReturnedDeposit.count += legacyTodayReturnedRows[0]?.count || 0
      const depositStudents = await Student.find({ depositReturnedAt: null, depositType: { $in: ['none', 'money'] } }).select('depositType depositAmount depositReceivedAt depositPayments')
      const depositDebtSummary = depositStudents.reduce((summary, student) => {
        const required = student.depositType === 'none' ? 700000 : Number(student.depositAmount || 700000)
        const paid = student.depositPayments?.length
          ? student.depositPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
          : student.depositType === 'money' && student.depositReceivedAt ? Number(student.depositAmount || 0) : 0
        const debt = Math.max(0, required - paid)
        if (debt > 0) { summary.amount += debt; summary.students += 1 }
        return summary
      }, { amount: 0, students: 0 })

      const activeStudentIds = new Set(activeContracts.map((item) => item.student.toString()))
      const occupiedByRoom = new Map()
      activeContracts.forEach((item) => occupiedByRoom.set(item.room.toString(), (occupiedByRoom.get(item.room.toString()) || 0) + 1))
      const usableRooms = rooms.filter((room) => room.status === 'available')
      const totalCapacity = usableRooms.reduce((sum, room) => sum + room.capacity, 0)
      const occupiedBeds = usableRooms.reduce((sum, room) => sum + Math.min(room.capacity, occupiedByRoom.get(room.id) || 0), 0)
      const debtAmount = installments.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      const debtorCount = new Set(installments.filter((item) => item.student && item.paidAmount < item.amount).map((item) => item.student.id)).size
      const debtorMap = new Map()
      installments.filter((item) => item.student && item.paidAmount < item.amount).forEach((item) => {
        const key = item.student.id
        if (!debtorMap.has(key)) debtorMap.set(key, { student: item.student, room: item.contract?.room || null, debt: 0 })
        debtorMap.get(key).debt += Math.max(0, item.amount - item.paidAmount)
      })
      const topDebtors = [...debtorMap.values()].sort((a, b) => b.debt - a.debt).slice(0, 5)
      const fineDebt = fines.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      const fineStudentCount = new Set(fines.map((item) => item.student.toString())).size
      const attendanceSummary = { total: activeStudentIds.size, present: 0, absent: 0, late: 0, unmarked: 0 }
      attendance.forEach((item) => { attendanceSummary[item.status] += 1 })
      attendanceSummary.unmarked = Math.max(0, attendanceSummary.total - attendance.length)
      const salaryFund = employees.reduce((sum, item) => sum + Number(item.salary || 0), 0)
      const totalIncome = income.amount + monthlyFineIncome.amount + depositIncome.amount
      const totalIncomeCount = income.count + monthlyFineIncome.count + depositIncome.count
      const totalTodayIncome = todayIncome.amount + todayFineIncome.amount + todayDepositIncome
      const totalTodayIncomeCount = todayIncome.count + todayFineIncome.count + todayDepositCount
      const outflow = expenses.amount + salaryPaid.amount + returnedDeposit.amount
      const trendMap = (rows) => rows.reduce((result, item) => result.set(item._id, (result.get(item._id) || 0) + Number(item.amount || 0)), new Map())
      const incomeByPeriod = trendMap(incomeTrend)
      const fineIncomeByPeriod = trendMap(fineIncomeTrend)
      const depositIncomeByPeriod = trendMap(depositTrend)
      const expenseByPeriod = trendMap(expenseTrend)
      const salaryByPeriod = trendMap(salaryTrend)
      const returnedDepositByPeriod = trendMap(returnedDepositTrend)
      const trends = recentPeriods(now).map((period) => ({ period, income: (incomeByPeriod.get(period) || 0) + (fineIncomeByPeriod.get(period) || 0) + (depositIncomeByPeriod.get(period) || 0), expenses: (expenseByPeriod.get(period) || 0) + (returnedDepositByPeriod.get(period) || 0), salaries: salaryByPeriod.get(period) || 0 }))
      const dailyIncomeMap = new Map(dailyIncome.map((item) => [item._id, item.amount]))
      const dailyFineIncomeMap = new Map(dailyFineIncome.map((item) => [item._id, item.amount]))
      const dailyDepositIncomeMap = new Map(dailyDepositIncome.map((item) => [item._id, item.amount]))
      const dailyExpenseMap = new Map(dailyExpenses.map((item) => [item._id, item.amount]))
      const dailyReturnedDepositMap = new Map(dailyReturnedDeposits.map((item) => [item._id, item.amount]))
      const dailyTrends = rangeDays(rangeStart, rangeEnd).map(({ day, key }) => ({ day, income: (dailyIncomeMap.get(key) || 0) + (dailyFineIncomeMap.get(key) || 0) + (dailyDepositIncomeMap.get(key) || 0), expenses: (dailyExpenseMap.get(key) || 0) + (dailyReturnedDepositMap.get(key) || 0) }))
      const mergeMethods = (primary, secondary) => {
        const methodMap = new Map()
        ;[...primary, ...secondary].forEach((item) => {
          const key = item._id === 'click' ? 'online' : item._id
          const current = methodMap.get(key) || { _id: key, amount: 0, count: 0 }
          current.amount += Number(item.amount || 0)
          current.count += Number(item.count || 0)
          methodMap.set(key, current)
        })
        return [...methodMap.values()]
      }

      const transactions = [
        ...recentPayments.map((item) => ({ id: `payment-${item.id}`, type: 'income', title: item.student?.fullName || 'Talaba to‘lovi', subtitle: 'Yotoqxona to‘lovi', amount: item.amount, createdAt: item.createdAt })),
        ...recentFinePayments.map((item) => ({ id: `fine-payment-${item.id}`, type: 'income', title: item.student?.fullName || 'Jarima to‘lovi', subtitle: 'Jarima to‘lovi', amount: item.amount, createdAt: item.createdAt })),
        ...recentExpenses.map((item) => ({ id: `expense-${item.id}`, type: 'expense', title: item.title, subtitle: item.category, amount: item.amount, createdAt: item.createdAt })),
        ...recentSalaries.map((item) => ({ id: `salary-${item.id}`, type: 'salary', title: `${item.employee?.firstname || ''} ${item.employee?.lastname || ''}`.trim() || 'Xodim', subtitle: 'Oylik to‘lovi', amount: item.amount, createdAt: item.createdAt })),
      ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8)

      return ApiResponse.ok(res, {
        period: monthKey,
        dateRange: { start: rangeStartKey, end: rangeEndKey },
        students: { active: activeStudentIds.size },
        rooms: { total: rooms.length, available: usableRooms.length, maintenance: rooms.length - usableRooms.length, capacity: totalCapacity, occupied: occupiedBeds, free: Math.max(0, totalCapacity - occupiedBeds), occupancyRate: totalCapacity ? Math.round((occupiedBeds / totalCapacity) * 100) : 0 },
        finance: { income: totalIncome, incomeCount: totalIncomeCount, fineIncome: monthlyFineIncome.amount, fineIncomeCount: monthlyFineIncome.count, depositIncome: depositIncome.amount, depositIncomeCount: depositIncome.count, returnedDeposit: returnedDeposit.amount, returnedDepositCount: returnedDeposit.count, expenses: expenses.amount + returnedDeposit.amount, expenseCount: expenses.count + returnedDeposit.count, salaryPaid: salaryPaid.amount, salaryPaymentCount: salaryPaid.count, salaryFund, outflow, balance: totalIncome - outflow, todayIncome: totalTodayIncome, todayIncomeCount: totalTodayIncomeCount, todayFineIncome: todayFineIncome.amount, todayReturnedDeposit: todayReturnedDeposit.amount, todayExpense: todayExpense.amount + todayReturnedDeposit.amount, todayBalance: totalTodayIncome - todayExpense.amount - todayReturnedDeposit.amount },
        debt: { amount: debtAmount, students: debtorCount, fineAmount: fineDebt, fineStudents: fineStudentCount, depositAmount: depositDebtSummary.amount, depositStudents: depositDebtSummary.students },
        attendance: attendanceSummary,
        employees: { active: employees.length },
        transactions,
        trends,
        dailyTrends,
        paymentMethods: mergeMethods(mergeMethods(paymentMethods, finePaymentMethods), dailyDepositMethods),
        dailyPaymentMethods: mergeMethods(mergeMethods(dailyPaymentMethods, dailyFinePaymentMethods), todayDepositIncomeRows),
        topDebtors,
        selectedDate: dayKey,
        generatedAt: now,
      })
    } catch (error) { return next(error) }
  }
}

export const dashboardController = new DashboardController()
