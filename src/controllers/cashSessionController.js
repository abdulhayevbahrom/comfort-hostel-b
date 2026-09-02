import mongoose from 'mongoose'
import { CashSession } from '../models/CashSession.js'
import { Notification } from '../models/Notification.js'
import { Payment } from '../models/Payment.js'
import { Student } from '../models/Student.js'
import { ApiResponse } from '../utils/response.js'

const methods = ['cash', 'card', 'online', 'bank']
const emptyBreakdown = () => ({ cash: 0, card: 0, online: 0, bank: 0 })
const totalBreakdown = (breakdown) => methods.reduce((sum, method) => sum + Number(breakdown?.[method] || 0), 0)

const sumPaymentsByMethod = async (match) => {
  const rows = await Payment.aggregate([
    { $match: { ...match, cancelledAt: null } },
    { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  ])
  const breakdown = emptyBreakdown()
  let count = 0
  rows.forEach((row) => { if (methods.includes(row._id)) breakdown[row._id] = row.amount; count += row.count })
  return { breakdown, amount: totalBreakdown(breakdown), count }
}

const sumDepositsByMethod = async (cashSession) => {
  const rows = await Student.aggregate([
    { $match: { depositReturnedAt: null } },
    { $unwind: '$depositPayments' },
    { $match: { 'depositPayments.cashSession': cashSession } },
    { $group: { _id: '$depositPayments.method', amount: { $sum: '$depositPayments.amount' }, count: { $sum: 1 } } },
  ])
  const breakdown = emptyBreakdown()
  let count = 0
  rows.forEach((row) => { if (methods.includes(row._id)) breakdown[row._id] = row.amount; count += row.count })
  return { breakdown, amount: totalBreakdown(breakdown), count }
}

const transferredBreakdown = async (sourceSession) => {
  const transfers = await CashSession.find({ sourceSession, status: { $in: ['pending', 'approved'] } }).select('breakdown').lean()
  return transfers.reduce((result, transfer) => {
    methods.forEach((method) => { result[method] += Number(transfer.breakdown?.[method] || 0) })
    return result
  }, emptyBreakdown())
}

const openSessionBalance = async (session) => {
  if (!session) return { breakdown: emptyBreakdown(), balance: 0, paymentCount: 0 }
  const [payments, deposits, incoming] = await Promise.all([
    sumPaymentsByMethod({ cashSession: session._id }),
    sumDepositsByMethod(session._id),
    CashSession.find({ destinationSession: session._id, status: 'approved' }).select('breakdown').lean(),
  ])
  const transferred = await transferredBreakdown(session._id)
  const breakdown = emptyBreakdown()
  methods.forEach((method) => {
    const incomingAmount = incoming.reduce((sum, transfer) => sum + Number(transfer.breakdown?.[method] || 0), 0)
    breakdown[method] = Math.max(0, payments.breakdown[method] + deposits.breakdown[method] + incomingAmount - transferred[method])
  })
  return { breakdown, balance: totalBreakdown(breakdown), paymentCount: payments.count + deposits.count }
}

const allocateContributors = (contributors, breakdown) => {
  const available = contributors.map((item) => ({ ...item, remaining: Number(item.amount || 0) }))
  const allocated = []
  methods.forEach((method) => {
    let required = Number(breakdown?.[method] || 0)
    for (const item of available) {
      if (required <= 0 || item.method !== method || item.remaining <= 0) continue
      const amount = Math.min(required, item.remaining)
      allocated.push({ ...item, amount })
      item.remaining -= amount
      required -= amount
    }
  })
  return allocated
}

const reduceContributors = (contributors, used) => {
  const remaining = contributors.map((item) => ({ ...item, amount: Number(item.amount || 0) }))
  used.forEach((part) => {
    let amount = Number(part.amount || 0)
    for (const item of remaining) {
      if (amount <= 0 || item.sourceKey !== part.sourceKey || item.method !== part.method || item.amount <= 0) continue
      const deducted = Math.min(amount, item.amount)
      item.amount -= deducted
      amount -= deducted
    }
  })
  return remaining.filter((item) => item.amount > 0)
}

const sessionContributors = async (sessionId) => {
  const [payments, students, incomingTransfers] = await Promise.all([
    Payment.find({ cashSession: sessionId, status: 'active' }).populate('student', 'fullName').select('student amount method createdAt').lean(),
    Student.find({ 'depositPayments.cashSession': sessionId }).select('fullName depositPayments').lean(),
    CashSession.find({ destinationSession: sessionId, status: 'approved' }).select('contributors breakdown receivedAmount closedAt').lean(),
  ])
  let contributors = [
    ...payments.map((payment) => ({ sourceKey: `payment:${payment._id}`, sourceType: 'payment', student: payment.student?._id || null, studentName: payment.student?.fullName || 'Talaba', amount: Number(payment.amount || 0), method: payment.method, paidAt: payment.createdAt })),
    ...students.flatMap((student) => (student.depositPayments || []).filter((payment) => payment.cashSession?.toString() === sessionId.toString()).map((payment) => ({ sourceKey: `deposit:${student._id}:${payment._id}`, sourceType: 'deposit', student: student._id, studentName: student.fullName, amount: Number(payment.amount || 0), method: payment.method, paidAt: payment.paidAt }))),
    ...incomingTransfers.flatMap((transfer) => transfer.contributors?.length ? transfer.contributors : methods.filter((method) => Number(transfer.breakdown?.[method] || 0) > 0).map((method) => ({ sourceKey: `transfer:${transfer._id}:${method}`, sourceType: 'transfer', student: null, studentName: 'Avvalgi kassa topshirig‘i', amount: Number(transfer.breakdown?.[method] || 0), method, paidAt: transfer.closedAt }))),
  ]
  const previousTransfers = await CashSession.find({ sourceSession: sessionId, status: { $in: ['pending', 'approved'] } }).select('contributors breakdown').sort({ closedAt: 1, createdAt: 1 }).lean()
  previousTransfers.forEach((transfer) => {
    const used = transfer.contributors?.length ? transfer.contributors : allocateContributors(contributors, transfer.breakdown)
    contributors = reduceContributors(contributors, used)
  })
  return contributors
}

class CashSessionController {
  emit(req, action, session) {
    req.app.get('io')?.emit('cash-sessions:changed', { action, sessionId: session?.id || session?._id?.toString() })
  }

  list = async (req, res, next) => {
    try {
      if (['cashier', 'head_cashier'].includes(req.employee.role)) {
        const openSession = await CashSession.findOne({ cashier: req.employee._id, status: 'open' })
        const open = await openSessionBalance(openSession)
        const sessions = await CashSession.find({ cashier: req.employee._id, status: { $ne: 'open' } })
          .populate('reviewedBy', 'firstname lastname').sort({ closedAt: -1 }).limit(30)
        const pendingAmount = sessions.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.expectedAmount, 0)
        if (req.employee.role === 'cashier') return ApiResponse.ok(res, { role: 'cashier', open: { id: openSession?.id || null, ...open }, pendingAmount, sessions })
        const [incomingSessions, reviewedIncoming] = await Promise.all([
          CashSession.find({ transferStage: 'cashier_to_head', status: 'pending' }).populate('cashier', 'firstname lastname position').sort({ closedAt: 1 }),
          CashSession.find({ transferStage: 'cashier_to_head', status: { $in: ['approved', 'rejected'] }, reviewedBy: req.employee._id }).populate('cashier', 'firstname lastname position').sort({ reviewedAt: -1 }).limit(30),
        ])
        return ApiResponse.ok(res, { role: 'head_cashier', open: { id: openSession?.id || null, ...open }, pendingAmount, sessions, pendingSessions: incomingSessions, recentIncoming: reviewedIncoming })
      }

      if (!['owner', 'admin'].includes(req.employee.role)) return ApiResponse.forbidden(res, 'Kassa faqat kassir va owner uchun ochiq')
      const [pendingSessions, recentSessions, organizationPayments, approvedTransfers, openSessions, depositRows, returnedDepositRows, legacyDepositRows, legacyReturnedDepositRows] = await Promise.all([
        CashSession.find({ status: 'pending', $or: [{ transferStage: 'head_to_owner' }, { transferStage: null }] }).populate('cashier', 'firstname lastname position role').sort({ closedAt: 1 }),
        CashSession.find({ status: { $in: ['approved', 'rejected'] }, $or: [{ transferStage: 'head_to_owner' }, { transferStage: null }] }).populate('cashier', 'firstname lastname position role').populate('reviewedBy', 'firstname lastname').sort({ reviewedAt: -1 }).limit(30),
        sumPaymentsByMethod({ $or: [{ fundHolder: 'organization' }, { fundHolder: { $exists: false }, cashSession: null }] }),
        CashSession.find({ status: 'approved', $or: [{ transferStage: 'head_to_owner' }, { transferStage: null }] }).select('sourceSession transferStage breakdown expectedAmount').lean(),
        CashSession.find({ status: 'open' }).populate('cashier', 'firstname lastname position'),
        Student.aggregate([{ $unwind: '$depositPayments' }, { $match: { $or: [{ 'depositPayments.cashSession': null }, { 'depositPayments.cashSession': { $exists: false } }] } }, { $group: { _id: '$depositPayments.method', amount: { $sum: '$depositPayments.amount' } } }]),
        Student.aggregate([{ $match: { depositType: 'money', depositReturnedAt: { $ne: null } } }, { $unwind: '$depositPayments' }, { $group: { _id: '$depositPayments.method', amount: { $sum: '$depositPayments.amount' } } }]),
        Student.aggregate([{ $match: { depositType: 'money', depositReceivedAt: { $ne: null }, 'depositPayments.0': { $exists: false } } }, { $group: { _id: { $cond: [{ $in: ['$depositPaymentMethod', methods] }, '$depositPaymentMethod', 'cash'] }, amount: { $sum: '$depositAmount' } } }]),
        Student.aggregate([{ $match: { depositType: 'money', depositReceivedAt: { $ne: null }, depositReturnedAt: { $ne: null }, 'depositPayments.0': { $exists: false } } }, { $group: { _id: { $cond: [{ $in: ['$depositPaymentMethod', methods] }, '$depositPaymentMethod', 'cash'] }, amount: { $sum: '$depositAmount' } } }]),
      ])
      const pendingAmount = pendingSessions.reduce((sum, item) => sum + item.expectedAmount, 0)
      const centralBreakdown = { ...organizationPayments.breakdown }
      depositRows.forEach((row) => { if (methods.includes(row._id)) centralBreakdown[row._id] += Number(row.amount || 0) })
      legacyDepositRows.forEach((row) => { if (methods.includes(row._id)) centralBreakdown[row._id] += Number(row.amount || 0) })
      returnedDepositRows.forEach((row) => { if (methods.includes(row._id)) centralBreakdown[row._id] -= Number(row.amount || 0) })
      legacyReturnedDepositRows.forEach((row) => { if (methods.includes(row._id)) centralBreakdown[row._id] -= Number(row.amount || 0) })
      approvedTransfers.forEach((transfer) => {
        if (!transfer.sourceSession) centralBreakdown.cash += Number(transfer.expectedAmount || 0)
        else methods.forEach((method) => { centralBreakdown[method] += Number(transfer.breakdown?.[method] || 0) })
      })
      const cashierBalances = (await Promise.all(openSessions.map(async (session) => ({ sessionId: session.id, cashier: session.cashier, ...(await openSessionBalance(session)) })))).filter((item) => item.balance > 0)
      return ApiResponse.ok(res, {
        role: req.employee.role,
        summary: { centralCash: totalBreakdown(centralBreakdown), breakdown: centralBreakdown, pendingAmount, pendingCount: pendingSessions.length, cashierAmount: cashierBalances.reduce((sum, item) => sum + item.balance, 0) },
        cashierBalances,
        pendingSessions,
        recentSessions,
      })
    } catch (error) { return next(error) }
  }

  close = async (req, res, next) => {
    try {
      if (!['cashier', 'head_cashier'].includes(req.employee.role)) return ApiResponse.forbidden(res, 'Mablag‘ni faqat kassir yoki bosh kassir topshiradi')
      const session = await CashSession.findOne({ cashier: req.employee._id, status: 'open' })
      if (!session) return ApiResponse.badRequest(res, 'Topshirish uchun kassada mablag‘ yo‘q')
      const available = await openSessionBalance(session)
      const breakdown = emptyBreakdown()
      for (const method of methods) {
        const amount = Number(req.body.breakdown?.[method] || 0)
        if (!Number.isFinite(amount) || amount < 0) return ApiResponse.badRequest(res, 'Topshiriladigan summalarni to‘g‘ri kiriting')
        if (amount > available.breakdown[method]) return ApiResponse.badRequest(res, `${method} bo‘yicha maksimal summa: ${available.breakdown[method].toLocaleString('uz-UZ')} so‘m`)
        breakdown[method] = amount
      }
      if (methods.filter((method) => breakdown[method] > 0).length !== 1) return ApiResponse.badRequest(res, 'Bir topshirishda faqat bitta to‘lov turini tanlang')
      const expectedAmount = totalBreakdown(breakdown)
      if (expectedAmount <= 0) return ApiResponse.badRequest(res, 'Topshiriladigan summani kiriting')
      const transferStage = req.employee.role === 'head_cashier' ? 'head_to_owner' : 'cashier_to_head'
      const contributors = allocateContributors(await sessionContributors(session._id), breakdown)
      if (totalBreakdown(breakdown) !== contributors.reduce((sum, item) => sum + Number(item.amount || 0), 0)) return ApiResponse.badRequest(res, 'Topshirilayotgan mablag‘ manbalarini aniqlab bo‘lmadi. Kassa yozuvlarini tekshiring')
      const transfer = await CashSession.create({ cashier: req.employee._id, sourceSession: session._id, transferStage, status: 'pending', expectedAmount, paymentCount: available.paymentCount, breakdown, contributors, closedAt: new Date(), note: String(req.body.note || '').trim() })
      const cashierName = `${req.employee.firstname} ${req.employee.lastname}`.trim()
      await Notification.create({
        eventKey: `cash-session:${transfer.id}`,
        type: 'cash_session', title: 'Kassa topshirildi',
        message: `${cashierName} ${expectedAmount.toLocaleString('uz-UZ')} so‘mni ${transferStage === 'cashier_to_head' ? 'bosh kassirga' : 'ownerga'} topshirishga yubordi`,
        count: 1, targetPath: '/cash', targetRoles: transferStage === 'cashier_to_head' ? ['head_cashier'] : ['owner', 'admin'],
      })
      this.emit(req, 'closed', transfer)
      req.app.get('io')?.emit('notifications:changed', { type: 'cash_session' })
      return ApiResponse.ok(res, { session: transfer }, transferStage === 'cashier_to_head' ? 'Mablag‘ bosh kassir tasdig‘iga yuborildi' : 'Mablag‘ owner tasdig‘iga yuborildi')
    } catch (error) { return next(error) }
  }

  approve = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Kassa topilmadi')
      const session = await CashSession.findOne({ _id: req.params.id, status: 'pending' })
      if (!session) return ApiResponse.notFound(res, 'Tasdiqlanadigan kassa topilmadi')
      const isHeadApproval = session.transferStage === 'cashier_to_head' && req.employee.role === 'head_cashier'
      const isOwnerApproval = (session.transferStage === 'head_to_owner' || !session.transferStage) && ['owner', 'admin'].includes(req.employee.role)
      if (!isHeadApproval && !isOwnerApproval) return ApiResponse.forbidden(res, session.transferStage === 'cashier_to_head' ? 'Bu mablag‘ni faqat bosh kassir qabul qiladi' : 'Bu mablag‘ni faqat owner qabul qiladi')
      const receivedAmount = Number(req.body.receivedAmount)
      if (!Number.isFinite(receivedAmount) || receivedAmount < 0) return ApiResponse.badRequest(res, 'Olingan pul miqdorini kiriting')
      if (receivedAmount !== session.expectedAmount) {
        const difference = receivedAmount - session.expectedAmount
        return ApiResponse.badRequest(res, `Kassada ${Math.abs(difference).toLocaleString('uz-UZ')} so‘m ${difference < 0 ? 'kam' : 'ortiqcha'} chiqdi`)
      }
      if (isHeadApproval) {
        const destinationSession = await CashSession.findOneAndUpdate(
          { cashier: req.employee._id, status: 'open' },
          { $setOnInsert: { cashier: req.employee._id, status: 'open' } },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )
        session.destinationSession = destinationSession._id
      }
      session.status = 'approved'; session.receivedAmount = receivedAmount; session.reviewedAt = new Date()
      session.reviewedBy = req.employee._id; session.reviewNote = String(req.body.reviewNote || '').trim()
      await session.save()
      await Notification.deleteOne({ eventKey: `cash-session:${session.id}` })
      this.emit(req, 'approved', session)
      if (isOwnerApproval) req.app.get('io')?.emit('central-cash:changed', { action: 'approved', sessionId: session.id })
      req.app.get('io')?.emit('notifications:changed', { type: 'cash_session' })
      return ApiResponse.ok(res, { session }, isHeadApproval ? 'Mablag‘ bosh kassir kassasiga qabul qilindi' : 'Mablag‘ markaziy kassaga o‘tkazildi')
    } catch (error) { return next(error) }
  }

  cancel = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Kassa topshirish so‘rovi topilmadi')
      const session = await CashSession.findOne({ _id: req.params.id, status: 'pending' })
      if (!session) return ApiResponse.notFound(res, 'Bekor qilinadigan tasdiqlanmagan so‘rov topilmadi')
      const isOwnCashierRequest = ['cashier', 'head_cashier'].includes(req.employee.role) && session.cashier.toString() === req.employee._id.toString()
      const isOwner = ['owner', 'admin'].includes(req.employee.role)
      if (!isOwnCashierRequest && !isOwner) return ApiResponse.forbidden(res, 'Bu so‘rovni bekor qilishga ruxsatingiz yo‘q')
      session.status = 'rejected'
      session.reviewedAt = new Date()
      session.reviewedBy = isOwner ? req.employee._id : null
      session.reviewNote = isOwner ? 'Owner tomonidan bekor qilindi' : 'Kassir tomonidan bekor qilindi'
      await session.save()
      await Notification.deleteOne({ eventKey: `cash-session:${session.id}` })
      this.emit(req, 'cancelled', session)
      req.app.get('io')?.emit('notifications:changed', { type: 'cash_session' })
      return ApiResponse.ok(res, { session }, 'Kassa topshirish so‘rovi bekor qilindi')
    } catch (error) { return next(error) }
  }
}

export const cashSessionController = new CashSessionController()
