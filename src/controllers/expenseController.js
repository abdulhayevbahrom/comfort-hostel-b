import mongoose from 'mongoose'
import { Expense } from '../models/Expense.js'
import { ApiResponse } from '../utils/response.js'

const paymentTypes = ['cash', 'card', 'click', 'bank']
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const endOfDay = (value) => { const date = new Date(value); date.setHours(23, 59, 59, 999); return date }

class ExpenseController {
  cleanPayload(body) {
    return {
      title: String(body.title || '').trim(),
      category: String(body.category || '').trim(),
      amount: Number(body.amount),
      paymentType: paymentTypes.includes(body.paymentType) ? body.paymentType : 'cash',
      note: String(body.note || '').trim(),
    }
  }

  buildFilter(query) {
    const filter = {}
    const search = String(query.search || '').trim()
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: 'i' }
      filter.$or = [{ title: regex }, { note: regex }, { category: regex }]
    }
    if (query.category) filter.category = String(query.category).trim()
    if (paymentTypes.includes(query.paymentType)) filter.paymentType = query.paymentType
    if (query.startDate || query.endDate) {
      filter.createdAt = {}
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.startDate)) filter.createdAt.$gte = new Date(`${query.startDate}T00:00:00`)
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.endDate)) filter.createdAt.$lte = endOfDay(`${query.endDate}T00:00:00`)
      if (!Object.keys(filter.createdAt).length) delete filter.createdAt
    }
    return filter
  }

  list = async (req, res, next) => {
    try {
      const filter = this.buildFilter(req.query)
      const limit = 25
      const total = await Expense.countDocuments(filter)
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), totalPages)
      const [expenses, totals, categories] = await Promise.all([
        Expense.find(filter).populate('createdBy', 'firstname lastname position').populate('updatedBy', 'firstname lastname').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        Expense.aggregate([{ $match: filter }, { $group: { _id: '$paymentType', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        Expense.distinct('category'),
      ])
      const byPaymentType = Object.fromEntries(paymentTypes.map((type) => [type, 0]))
      totals.forEach((item) => { byPaymentType[item._id] = item.amount })
      const totalAmount = totals.reduce((sum, item) => sum + item.amount, 0)
      const expenseRows = expenses.map((item) => ({ ...item.toJSON(), spentAt: item.createdAt }))
      return ApiResponse.ok(res, { expenses: expenseRows, categories: categories.filter(Boolean).sort(), summary: { totalAmount, count: total, byPaymentType }, pagination: { page, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const payload = this.cleanPayload(req.body)
      if (!payload.title || !payload.category) return ApiResponse.badRequest(res, 'Xarajat nomi va kategoriyasini kiriting')
      if (!Number.isFinite(payload.amount) || payload.amount < 1) return ApiResponse.badRequest(res, 'Xarajat summasini to‘g‘ri kiriting')
      const expense = await Expense.create({ ...payload, createdBy: req.employee._id })
      await expense.populate('createdBy', 'firstname lastname position')
      req.app.get('io')?.emit('expenses:changed', { action: 'created', expenseId: expense.id })
      return ApiResponse.created(res, { expense }, 'Xarajat qo‘shildi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xarajat topilmadi')
      const payload = this.cleanPayload(req.body)
      if (!payload.title || !payload.category || !Number.isFinite(payload.amount) || payload.amount < 1) return ApiResponse.badRequest(res, 'Xarajat ma’lumotlarini to‘g‘ri kiriting')
      const expense = await Expense.findByIdAndUpdate(req.params.id, { ...payload, updatedBy: req.employee._id }, { new: true, runValidators: true }).populate('createdBy', 'firstname lastname position').populate('updatedBy', 'firstname lastname')
      if (!expense) return ApiResponse.notFound(res, 'Xarajat topilmadi')
      req.app.get('io')?.emit('expenses:changed', { action: 'updated', expenseId: expense.id })
      return ApiResponse.ok(res, { expense }, 'Xarajat yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xarajat topilmadi')
      const expense = await Expense.findByIdAndDelete(req.params.id)
      if (!expense) return ApiResponse.notFound(res, 'Xarajat topilmadi')
      req.app.get('io')?.emit('expenses:changed', { action: 'deleted', expenseId: expense.id })
      return ApiResponse.ok(res, { expenseId: expense.id }, 'Xarajat o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const expenseController = new ExpenseController()
