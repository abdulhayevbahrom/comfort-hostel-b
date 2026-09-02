import mongoose from 'mongoose'
import { Payment } from '../models/Payment.js'
import { StudentContract } from '../models/StudentContract.js'
import { ContractInstallment } from '../models/ContractInstallment.js'
import { CashSession } from '../models/CashSession.js'
import { Employee } from '../models/Employee.js'
import { Notification } from '../models/Notification.js'
import { ApiResponse } from '../utils/response.js'

const paymentPopulate = [
  { path: 'student', select: 'fullName phone photo' },
  { path: 'contract', select: 'contractNumber totalAmount paymentType room', populate: { path: 'room', select: 'roomNumber block' } },
  { path: 'allocations.installment', select: 'periodKey dueDate amount paidAmount status' },
  { path: 'receivedBy', select: 'firstname lastname role' },
  { path: 'cashSession', select: 'status expectedAmount closedAt' },
  { path: 'cancelledBy', select: 'firstname lastname role' },
  { path: 'auditHistory.performedBy', select: 'firstname lastname role' },
]

const snapshot = (payment) => ({ amount: payment.amount, method: payment.method, payerType: payment.payerType, payerName: payment.payerName || '', note: payment.note || '' })

const adjustCashSession = async (payment, oldSnapshot, newSnapshot, cancelled = false, session = null) => {
  if (!payment.cashSession) return
  const oldCash = oldSnapshot.method === 'cash' ? oldSnapshot.amount : 0
  const newCash = cancelled ? 0 : (newSnapshot.method === 'cash' ? newSnapshot.amount : 0)
  const amountDelta = newCash - oldCash
  const countDelta = cancelled && oldCash > 0 ? -1 : oldCash <= 0 && newCash > 0 ? 1 : oldCash > 0 && newCash <= 0 ? -1 : 0
  const cashSessionQuery = CashSession.findById(payment.cashSession)
  if (session) cashSessionQuery.session(session)
  const cashSession = await cashSessionQuery
  if (!cashSession || cashSession.status === 'open') return
  cashSession.expectedAmount = Math.max(0, cashSession.expectedAmount + amountDelta)
  cashSession.paymentCount = Math.max(0, cashSession.paymentCount + countDelta)
  if (cashSession.status === 'approved' && cashSession.receivedAmount !== null) cashSession.receivedAmount = Math.max(0, cashSession.receivedAmount + amountDelta)
  await cashSession.save(session ? { session } : undefined)
}

class PaymentController {
  emit(req, action, payment) {
    req.app.get('io')?.emit('payments:changed', { action, paymentId: payment?.id || payment?._id?.toString(), studentId: payment?.student?._id?.toString?.() || payment?.student?.toString?.() })
    req.app.get('io')?.emit('student-contracts:changed', { action: `payment-${action}`, studentId: payment?.student?._id?.toString?.() || payment?.student?.toString?.() })
  }

  notifyCashier = async (req, payment, action, before = null) => {
    if (!payment.receivedBy || payment.receivedBy.toString() === req.employee.id) return
    const cashier = await Employee.findOne({ _id: payment.receivedBy, role: 'cashier' }).select('_id')
    if (!cashier) return
    const ownerName = `${req.employee.firstname} ${req.employee.lastname}`.trim()
    const student = await payment.populate({ path: 'student', select: 'fullName' })
    const actionText = action === 'updated' ? 'tahrirladi' : 'bekor qildi'
    const detail = action === 'updated' && before ? ` (${before.amount.toLocaleString('uz-UZ')} → ${payment.amount.toLocaleString('uz-UZ')} so‘m)` : ''
    await Notification.create({
      eventKey: `payment-${action}:${payment.id}:${Date.now()}`,
      type: 'payment_change', title: action === 'updated' ? 'To‘lov tahrirlandi' : 'To‘lov bekor qilindi',
      message: `${ownerName} siz qabul qilgan ${student.student?.fullName || 'talaba'} to‘lovini ${actionText}${detail}`,
      count: 1, targetPath: '/payments', targetEmployees: [cashier._id],
    })
    req.app.get('io')?.emit('notifications:changed', { type: 'payment_change', employeeId: cashier.id })
  }

  list = async (req, res, next) => {
    try {
      const { search = '', method = '', from = '', to = '', period = '' } = req.query
      const filter = {}
      if (method && ['cash', 'card', 'bank', 'online'].includes(method)) filter.method = method
      if (from || to) filter.createdAt = { ...(from ? { $gte: new Date(`${from}T00:00:00`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59.999`) } : {}) }
      const periodInstallments = period ? await ContractInstallment.find({ periodKey: period }).select('_id student amount paidAmount dueDate').lean() : []
      if (period) filter['allocations.installment'] = { $in: periodInstallments.map((item) => item._id) }
      let payments = await Payment.find(filter).populate(paymentPopulate).sort({ createdAt: -1 })
      const needle = String(search).trim().toLowerCase()
      if (needle) payments = payments.filter((item) => `${item.student?.fullName || ''} ${item.student?.phone || ''} ${item.contract?.contractNumber || ''}`.toLowerCase().includes(needle))
      const reportInstallments = period ? periodInstallments : await ContractInstallment.find({}).select('student amount paidAmount periodKey dueDate').lean()
      const billed = reportInstallments.reduce((sum, item) => sum + item.amount, 0)
      const paid = reportInstallments.reduce((sum, item) => sum + item.paidAmount, 0)
      const allStudents = new Set(reportInstallments.map((item) => item.student.toString()))
      const paidStudents = new Set(reportInstallments.filter((item) => item.paidAmount > 0).map((item) => item.student.toString()))
      const now = new Date(); const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
      const isFuturePeriod = Boolean(period && period > currentKey)
      const dueInstallments = reportInstallments.filter((item) => new Date(item.dueDate) <= todayEnd)
      const waitingInstallments = reportInstallments.filter((item) => new Date(item.dueDate) > todayEnd)
      const debt = dueInstallments.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      const dueStudentIds = new Set(dueInstallments.map((item) => item.student.toString()))
      const duePaidStudentIds = new Set(dueInstallments.filter((item) => item.paidAmount > 0).map((item) => item.student.toString()))
      const waitingStudentIds = new Set(waitingInstallments.filter((item) => item.paidAmount < item.amount).map((item) => item.student.toString()))
      return ApiResponse.ok(res, { payments, summary: { billed, paid, debt, paidStudents: paidStudents.size, unpaidStudents: Math.max(0, dueStudentIds.size - duePaidStudentIds.size), waitingStudents: waitingStudentIds.size, studentCount: allStudents.size, count: payments.length, period, isFuturePeriod } })
    } catch (error) { return next(error) }
  }

  options = async (_req, res, next) => {
    try {
      const contracts = await StudentContract.find({ status: { $in: ['active', 'cancelled', 'completed'] } }).populate('student', 'fullName phone').populate('room', 'roomNumber block').sort({ createdAt: -1 }).lean()
      const installments = await ContractInstallment.find({ contract: { $in: contracts.map((item) => item._id) } }).sort({ dueDate: 1 }).lean()
      const byContract = new Map()
      installments.forEach((item) => { const key = item.contract.toString(); if (!byContract.has(key)) byContract.set(key, []); byContract.get(key).push(item) })
      const options = contracts.map((contract) => ({ ...contract, installments: byContract.get(contract._id.toString()) || [], balance: (byContract.get(contract._id.toString()) || []).reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0) })).filter((contract) => contract.status === 'active' || contract.balance > 0)
      return ApiResponse.ok(res, { contracts: options })
    } catch (error) { return next(error) }
  }

  advance = async (_req, res, next) => {
    try {
      const payments = await Payment.find({ cancelledAt: null })
        .populate(paymentPopulate)
        .sort({ createdAt: -1 })
      const groups = new Map()
      for (const payment of payments) {
        const installment = payment.allocations?.[0]?.installment
        if (!installment?.periodKey) continue
        const paymentPeriod = new Date(payment.createdAt).toISOString().slice(0, 7)
        if (installment.periodKey <= paymentPeriod) continue
        const amount = payment.allocations?.[0]?.amount || payment.amount
        if (!groups.has(installment.periodKey)) {
          groups.set(installment.periodKey, {
            periodKey: installment.periodKey,
            totalAmount: 0,
            studentIds: new Set(),
            payments: [],
          })
        }
        const group = groups.get(installment.periodKey)
        group.totalAmount += amount
        if (payment.student?.id) group.studentIds.add(payment.student.id)
        group.payments.push({
          id: payment.id,
          student: payment.student,
          contract: payment.contract,
          amount,
          method: payment.method,
          note: payment.note,
          createdAt: payment.createdAt,
        })
      }
      const periods = [...groups.values()]
        .map(({ studentIds, ...group }) => ({
          ...group,
          studentCount: studentIds.size,
          paymentCount: group.payments.length,
        }))
        .sort((first, second) => second.periodKey.localeCompare(first.periodKey))
      return ApiResponse.ok(res, {
        periods,
        summary: {
          totalAmount: periods.reduce((sum, item) => sum + item.totalAmount, 0),
          studentCount: new Set(periods.flatMap((item) => item.payments.map((payment) => payment.student?.id).filter(Boolean))).size,
          paymentCount: periods.reduce((sum, item) => sum + item.paymentCount, 0),
          periodCount: periods.length,
        },
      })
    } catch (error) { return next(error) }
  }

  studentProfile = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.studentId)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const contracts = await StudentContract.find({ student: req.params.studentId }).populate('room', 'roomNumber block').sort({ startDate: -1 }).lean()
      const installments = await ContractInstallment.find({ contract: { $in: contracts.map((item) => item._id) } }).sort({ dueDate: 1, periodIndex: 1 }).lean()
      const payments = await Payment.find({ student: req.params.studentId }).populate(paymentPopulate).sort({ createdAt: -1 })
      const activeContractIds = new Set(contracts.filter((contract) => contract.status === 'active').map((contract) => contract._id.toString()))
      const activeInstallments = installments.filter((item) => activeContractIds.has(item.contract.toString()))
      const sortedInstallments = [...installments].sort((first, second) => {
        const firstActive = activeContractIds.has(first.contract.toString())
        const secondActive = activeContractIds.has(second.contract.toString())
        if (firstActive !== secondActive) return firstActive ? -1 : 1
        return new Date(first.dueDate).getTime() - new Date(second.dueDate).getTime()
      })
      const total = activeInstallments.reduce((sum, item) => sum + item.amount, 0)
      const paid = activeInstallments.reduce((sum, item) => sum + item.paidAmount, 0)
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
      const dueInstallments = activeInstallments.filter((item) => new Date(item.dueDate) <= todayEnd)
      const debt = dueInstallments.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      const upcoming = activeInstallments.filter((item) => new Date(item.dueDate) > todayEnd).reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      const overdue = activeInstallments.reduce((sum, item) => sum + (new Date(item.dueDate) < todayStart ? Math.max(0, item.amount - item.paidAmount) : 0), 0)
      return ApiResponse.ok(res, { contracts, installments: sortedInstallments, payments, summary: { total, paid, debt, overdue, upcoming, paymentCount: payments.filter((payment) => !payment.cancelledAt && payment.status !== 'cancelled').length } })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const { contract: contractId, installment: installmentId, method, payerType, note = '' } = req.body
      const amount = Number(req.body.amount)
      if (!mongoose.isValidObjectId(contractId)) return ApiResponse.badRequest(res, 'Shartnomani tanlang')
      if (!mongoose.isValidObjectId(installmentId)) return ApiResponse.badRequest(res, 'To‘lov oyini tanlang')
      if (!Number.isFinite(amount) || amount <= 0) return ApiResponse.badRequest(res, 'To‘lov summasini kiriting')
      if (!['cash', 'card', 'bank', 'online'].includes(method)) return ApiResponse.badRequest(res, 'To‘lov usulini tanlang')
      if (!String(payerType || '').trim()) return ApiResponse.badRequest(res, 'To‘lovni kim qilganini kiriting')
      const fundHolder = req.employee.role === 'cashier'
        ? (method === 'cash' ? 'cashier' : method === 'bank' ? 'organization' : req.body.fundHolder)
        : 'organization'
      if (req.employee.role === 'cashier' && !['cash', 'bank'].includes(method) && !['cashier', 'organization'].includes(fundHolder)) return ApiResponse.badRequest(res, 'Pul tushadigan hisobni tanlang')
      let payment
      let cashSession
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          const contract = await StudentContract.findById(contractId).session(session)
          if (!contract) throw Object.assign(new Error('Shartnoma topilmadi'), { statusCode: 404 })
          const installment = await ContractInstallment.findOne({ _id: installmentId, contract: contract._id }).session(session)
          if (!installment) throw Object.assign(new Error('Tanlangan to‘lov davri topilmadi'), { statusCode: 400 })
          const balance = Math.max(0, installment.amount - installment.paidAmount)
          if (amount > balance) throw Object.assign(new Error(`Maksimal to‘lov: ${balance.toLocaleString('uz-UZ')} so‘m`), { statusCode: 400 })

          installment.paidAmount += amount
          installment.status = installment.paidAmount >= installment.amount ? 'paid' : 'partial'
          await installment.save({ session })

          if (req.employee.role === 'cashier' && fundHolder === 'cashier') {
            cashSession = await CashSession.findOneAndUpdate(
              { cashier: req.employee._id, status: 'open' },
              { $setOnInsert: { cashier: req.employee._id, status: 'open' } },
              { new: true, upsert: true, setDefaultsOnInsert: true, session },
            )
          }
          [payment] = await Payment.create([{ student: contract.student, contract: contract._id, amount, method, fundHolder, payerType, note, receivedBy: req.employee._id, cashSession: cashSession?._id || null, allocations: [{ installment: installment._id, amount }], auditHistory: [{ action: 'created', performedBy: req.employee._id, after: { amount, method, payerType, note } }] }], { session })
        })
      } finally { await session.endSession() }
      await payment.populate(paymentPopulate); this.emit(req, 'created', payment)
      if (cashSession) req.app.get('io')?.emit('cash-sessions:changed', { action: 'payment-created', cashierId: req.employee.id })
      return ApiResponse.created(res, { payment }, 'To‘lov muvaffaqiyatli qabul qilindi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      const amount = Number(req.body.amount)
      const method = req.body.method
      const payerType = req.body.payerType
      if (!Number.isFinite(amount) || amount <= 0) return ApiResponse.badRequest(res, 'To‘lov summasini kiriting')
      if (!['cash', 'card', 'bank', 'online'].includes(method)) return ApiResponse.badRequest(res, 'To‘lov usulini tanlang')
      if (!String(payerType || '').trim()) return ApiResponse.badRequest(res, 'To‘lovni kim qilganini kiriting')
      let payment
      let before
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          payment = await Payment.findById(req.params.id).session(session)
          if (!payment) throw Object.assign(new Error('To‘lov topilmadi'), { statusCode: 404 })
          if (payment.status === 'cancelled' || payment.cancelledAt) throw Object.assign(new Error('Bekor qilingan to‘lovni tahrirlab bo‘lmaydi'), { statusCode: 400 })
          before = snapshot(payment)
          const allocation = payment.allocations[0]
          const installment = await ContractInstallment.findById(allocation?.installment).session(session)
          if (!installment) throw Object.assign(new Error('To‘lov davri topilmadi'), { statusCode: 400 })
          const available = Math.max(0, installment.amount - installment.paidAmount) + allocation.amount
          if (amount > available) throw Object.assign(new Error(`Maksimal to‘lov: ${available.toLocaleString('uz-UZ')} so‘m`), { statusCode: 400 })
          installment.paidAmount = Math.max(0, installment.paidAmount - allocation.amount) + amount
          installment.status = installment.paidAmount <= 0 ? 'unpaid' : installment.paidAmount >= installment.amount ? 'paid' : 'partial'
          await installment.save({ session })
          payment.amount = amount; payment.method = method; payment.payerType = payerType; payment.note = String(req.body.note || '').trim(); payment.allocations = [{ installment: installment._id, amount }]
          payment.auditHistory.push({ action: 'updated', performedBy: req.employee._id, before, after: snapshot(payment) })
          await adjustCashSession(payment, before, snapshot(payment), false, session)
          await payment.save({ session })
        })
      } finally { await session.endSession() }
      await this.notifyCashier(req, payment, 'updated', before); await payment.populate(paymentPopulate); this.emit(req, 'updated', payment)
      return ApiResponse.ok(res, { payment }, 'To‘lov yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'To‘lov topilmadi')
      let payment
      let before
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          payment = await Payment.findById(req.params.id).session(session)
          if (!payment) throw Object.assign(new Error('To‘lov topilmadi'), { statusCode: 404 })
          if (payment.status === 'cancelled' || payment.cancelledAt) throw Object.assign(new Error('To‘lov avval bekor qilingan'), { statusCode: 400 })
          before = snapshot(payment)
          for (const allocation of payment.allocations) {
            const installment = await ContractInstallment.findById(allocation.installment).session(session)
            if (installment) {
              installment.paidAmount = Math.max(0, installment.paidAmount - allocation.amount)
              installment.status = installment.paidAmount <= 0 ? 'unpaid' : installment.paidAmount >= installment.amount ? 'paid' : 'partial'
              await installment.save({ session })
            }
          }
          payment.status = 'cancelled'; payment.cancelledAt = new Date(); payment.cancelledBy = req.employee._id
          payment.auditHistory.push({ action: 'cancelled', performedBy: req.employee._id, before })
          await adjustCashSession(payment, before, before, true, session)
          await payment.save({ session })
        })
      } finally { await session.endSession() }
      await this.notifyCashier(req, payment, 'cancelled', before); await payment.populate(paymentPopulate); this.emit(req, 'cancelled', payment)
      return ApiResponse.ok(res, { payment }, 'To‘lov bekor qilindi')
    } catch (error) { return next(error) }
  }
}

export const paymentController = new PaymentController()
