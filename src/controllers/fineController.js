import mongoose from 'mongoose'
import { Fine } from '../models/Fine.js'
import { FinePayment } from '../models/FinePayment.js'
import { Student } from '../models/Student.js'
import { StudentContract } from '../models/StudentContract.js'
import { ApiResponse } from '../utils/response.js'

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

class FineController {
  emit(req, action, fine) {
    req.app.get('io')?.emit('fines:changed', { action, fineId: fine?.id, studentId: fine?.student?.id || fine?.student?.toString() })
  }

  list = async (req, res, next) => {
    try {
      const filter = {}
      if (mongoose.isValidObjectId(req.query.student)) filter.student = req.query.student
      if (/^\d{4}-\d{2}$/.test(String(req.query.month || ''))) {
        const start = new Date(`${req.query.month}-01T00:00:00`)
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
        filter.createdAt = { $gte: start, $lt: end }
      }
      const search = String(req.query.search || '').trim()
      if (search) {
        const regex = new RegExp(escapeRegex(search), 'i')
        const students = await Student.find({ $or: [{ fullName: regex }, { phone: regex }, { jshr: regex }] }).select('_id')
        filter.$or = [{ reason: regex }, { student: { $in: students.map((item) => item._id) } }]
      }
      const limit = 25
      const total = await Fine.countDocuments(filter)
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), totalPages)
      const [fines, summaryRows] = await Promise.all([
        Fine.find(filter)
          .populate({ path: 'student', select: 'fullName phone photo university faculty course', populate: [{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }] })
          .populate('issuedBy', 'firstname lastname position role')
          .populate('updatedBy', 'firstname lastname')
          .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        Fine.aggregate([{ $match: filter }, { $group: { _id: null, totalAmount: { $sum: '$amount' }, paidAmount: { $sum: '$paidAmount' }, count: { $sum: 1 }, students: { $addToSet: '$student' } } }]),
      ])
      const row = summaryRows[0]
      return ApiResponse.ok(res, { fines, summary: { totalAmount: row?.totalAmount || 0, paidAmount: row?.paidAmount || 0, remainingAmount: Math.max(0, (row?.totalAmount || 0) - (row?.paidAmount || 0)), count: row?.count || 0, studentCount: row?.students?.length || 0 }, pagination: { page, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }

  options = async (_req, res, next) => {
    try {
      const contracts = await StudentContract.find({ status: 'active' }).select('student room').populate('student', 'fullName phone photo').populate('room', 'roomNumber block')
      const students = [...new Map(contracts.filter((item) => item.student).map((item) => [item.student.id, { ...item.student.toJSON(), room: item.room }])).values()].sort((a, b) => a.fullName.localeCompare(b.fullName))
      return ApiResponse.ok(res, { students })
    } catch (error) { return next(error) }
  }

  studentProfile = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.studentId)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const fines = await Fine.find({ student: req.params.studentId }).populate('issuedBy', 'firstname lastname position role').sort({ createdAt: -1 })
      return ApiResponse.ok(res, { fines, summary: { count: fines.length, totalAmount: fines.reduce((sum, item) => sum + item.amount, 0), paidAmount: fines.reduce((sum, item) => sum + item.paidAmount, 0), remainingAmount: fines.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0) } })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.body.student) || !(await Student.exists({ _id: req.body.student }))) return ApiResponse.badRequest(res, 'Talabani to‘g‘ri tanlang')
      const reason = String(req.body.reason || '').trim()
      const amount = Number(req.body.amount)
      if (!reason) return ApiResponse.badRequest(res, 'Jarima sababini kiriting')
      if (!Number.isFinite(amount) || amount < 1) return ApiResponse.badRequest(res, 'Jarima summasini to‘g‘ri kiriting')
      const fine = await Fine.create({ student: req.body.student, reason, amount, issuedBy: req.employee._id })
      await fine.populate([{ path: 'student', select: 'fullName phone photo' }, { path: 'issuedBy', select: 'firstname lastname position role' }])
      this.emit(req, 'created', fine)
      return ApiResponse.created(res, { fine }, 'Jarima yozildi')
    } catch (error) { return next(error) }
  }

  pay = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Jarima topilmadi')
      const amount = Number(req.body.amount)
      const method = ['cash', 'card', 'click', 'bank'].includes(req.body.method) ? req.body.method : 'cash'
      if (!Number.isFinite(amount) || amount < 1) return ApiResponse.badRequest(res, 'To‘lov summasini to‘g‘ri kiriting')
      const fine = await Fine.findById(req.params.id)
      if (!fine) return ApiResponse.notFound(res, 'Jarima topilmadi')
      const remaining = Math.max(0, fine.amount - fine.paidAmount)
      if (remaining <= 0) return ApiResponse.conflict(res, 'Bu jarima to‘liq to‘langan')
      if (amount > remaining) return ApiResponse.badRequest(res, `To‘lov qolgan ${remaining.toLocaleString('uz-UZ')} so‘mdan oshmasligi kerak`)
      const payment = await FinePayment.create({ fine: fine._id, student: fine.student, amount, method, note: String(req.body.note || '').trim(), receivedBy: req.employee._id })
      fine.paidAmount += amount
      await fine.save()
      await payment.populate('receivedBy', 'firstname lastname position')
      this.emit(req, 'paid', fine)
      return ApiResponse.created(res, { payment, fine }, 'Jarima to‘lovi qabul qilindi')
    } catch (error) { return next(error) }
  }

  payments = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Jarima topilmadi')
      const payments = await FinePayment.find({ fine: req.params.id }).populate('receivedBy', 'firstname lastname position').sort({ createdAt: -1 })
      return ApiResponse.ok(res, { payments })
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Jarima topilmadi')
      const reason = String(req.body.reason || '').trim()
      const amount = Number(req.body.amount)
      if (!reason || !Number.isFinite(amount) || amount < 1) return ApiResponse.badRequest(res, 'Jarima ma’lumotlarini to‘g‘ri kiriting')
      const current = await Fine.findById(req.params.id)
      if (!current) return ApiResponse.notFound(res, 'Jarima topilmadi')
      if (amount < current.paidAmount) return ApiResponse.badRequest(res, `Jarima summasi to‘langan ${current.paidAmount.toLocaleString('uz-UZ')} so‘mdan kam bo‘lmasligi kerak`)
      const fine = await Fine.findByIdAndUpdate(req.params.id, { reason, amount, updatedBy: req.employee._id }, { new: true, runValidators: true })
      if (!fine) return ApiResponse.notFound(res, 'Jarima topilmadi')
      this.emit(req, 'updated', fine)
      return ApiResponse.ok(res, { fine }, 'Jarima yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Jarima topilmadi')
      const fine = await Fine.findByIdAndDelete(req.params.id)
      if (!fine) return ApiResponse.notFound(res, 'Jarima topilmadi')
      await FinePayment.deleteMany({ fine: fine._id })
      this.emit(req, 'deleted', fine)
      return ApiResponse.ok(res, { fineId: fine.id }, 'Jarima o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const fineController = new FineController()
