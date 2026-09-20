import mongoose from 'mongoose'
import { BlacklistEntry } from '../models/BlacklistEntry.js'
import { CashSession } from '../models/CashSession.js'
import { Faculty } from '../models/Faculty.js'
import { Student } from '../models/Student.js'
import { StudentContract } from '../models/StudentContract.js'
import { University } from '../models/University.js'
import { faceIdCodeExists, isValidFaceIdCode, normalizeFaceIdCode } from '../utils/faceIdCode.js'
import { ApiResponse } from '../utils/response.js'
import { deleteImage, uploadImages } from '../utils/imgbb.js'
import { deletePrivateImage, privateImagePath, savePrivateImage } from '../utils/privateFileStorage.js'
import { isReceiptImageReference } from '../utils/paymentReceiptStorage.js'

const money = (value) => Number(value || 0).toLocaleString('uz-UZ')
const formatAuditDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}
const normalizeAuditValue = (value) => {
  if (value === undefined || value === null) return ''
  if (value instanceof Date) return formatAuditDate(value)
  if (typeof value === 'object' && value._id) return value._id.toString()
  if (typeof value === 'boolean') return value ? 'Ha' : 'Yo‘q'
  return String(value)
}
const auditChanged = (before, after) => normalizeAuditValue(before) !== normalizeAuditValue(after)

const studentAuditFields = [
  ['fullName', 'F.I.Sh.'],
  ['faceIdCode', 'FaceID kodi'],
  ['phone', 'Telefon'],
  ['gender', 'Jinsi'],
  ['fatherPhone', 'Otasi/bobosi telefoni'],
  ['motherPhone', 'Onasi/buvisi telefoni'],
  ['depositType', 'Depozit turi'],
  ['depositAmount', 'Depozit summasi', (value) => value ? `${money(value)} so‘m` : ''],
  ['depositReceivedAt', 'Depozit olingan sana', formatAuditDate],
  ['university', 'Universitet'],
  ['faculty', 'Fakultet'],
  ['address', 'Manzil'],
  ['course', 'Kurs'],
  ['educationType', 'Ta’lim turi'],
  ['hasTemporaryRegistration', 'Vaqtinchalik propiska'],
  ['temporaryRegistrationMonths', 'Vaqtinchalik propiska oyi'],
  ['studentStatus', 'Talaba holati'],
  ['plannedDepartureDate', 'Ketish sanasi', formatAuditDate],
  ['hasTaxContract', 'Soliq shartnomasi'],
  ['taxContractType', 'Soliq shartnomasi turi'],
  ['disciplinaryStatus', 'Intizomiy holat'],
  ['disciplinaryNote', 'Intizomiy izoh'],
  ['disabilityStatus', 'Nogironlik holati'],
  ['jshr', 'JSHR'],
  ['passportSeries', 'Pasport seriyasi'],
  ['passportNumber', 'Pasport raqami'],
  ['zaksSeries', 'ZAKS seriyasi'],
  ['zaksNumber', 'ZAKS raqami'],
]

const imageAuditChange = (field, label, before, after) => {
  const beforeExists = Boolean(before?.path || before?.url)
  const afterExists = Boolean(after?.path || after?.url)
  if (beforeExists === afterExists) return null
  return { field, label, before: beforeExists ? 'Yuklangan' : '', after: afterExists ? 'Yuklangan' : '' }
}

class StudentController {
  canReceivePayment = (employee) => ['cashier', 'head_cashier'].includes(employee?.role)

  canViewPrivateDocuments = (employee) => ['manager', 'owner', 'admin', 'cashier', 'head_cashier'].includes(employee?.role)

  getReceivingCashSession = async (employee) => {
    if (!this.canReceivePayment(employee)) return null
    return CashSession.findOneAndUpdate(
      { cashier: employee._id, status: 'open' },
      { $setOnInsert: { cashier: employee._id, status: 'open' } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
  }

  addDepositPayment = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const student = await Student.findById(req.params.id)
      if (!student) return ApiResponse.notFound(res, 'Talaba topilmadi')
      if (!['none', 'money'].includes(student.depositType)) return ApiResponse.badRequest(res, 'Talabada pul depoziti qabul qilib bo‘lmaydi')
      if (!this.canReceivePayment(req.employee)) return ApiResponse.forbidden(res, 'Depozit to‘lovini faqat kassir yoki bosh kassir qabul qilishi mumkin')
      const cashSession = await this.getReceivingCashSession(req.employee)
      const paymentGroup = new mongoose.Types.ObjectId()
      const parts = (Array.isArray(req.body.paymentParts) ? req.body.paymentParts : []).map((part) => ({ paymentGroup, method: part.method, amount: Number(part.amount), paidAt: part.paidAt ? new Date(part.paidAt) : null, receiptImage: part.receiptImage || '', receivedBy: req.employee._id, cashSession: cashSession?._id || null, auditHistory: [{ action: 'created', performedBy: req.employee._id, after: { amount: Number(part.amount), method: part.method, note: 'Depozit to‘lovi' } }] })).filter((part) => part.amount > 0)
      if (!parts.length || parts.some((part) => !['cash', 'online', 'card', 'bank'].includes(part.method))) return ApiResponse.badRequest(res, 'Depozit to‘lov usullarini kiriting')
      if (parts.some((part) => !part.paidAt || Number.isNaN(part.paidAt.getTime()))) return ApiResponse.badRequest(res, 'Har bir depozit to‘lovi sanasini kiriting')
      if (parts.some((part) => !isReceiptImageReference(part.receiptImage))) return ApiResponse.badRequest(res, 'Kvitansiya rasmi manzili noto‘g‘ri')
      const activeDeposits = (student.depositPayments || []).filter((payment) => payment.status !== 'cancelled' && !payment.cancelledAt)
      const paid = activeDeposits.length ? activeDeposits.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) : student.depositType === 'money' && student.depositReceivedAt ? Number(student.depositAmount || 0) : 0
      const amount = parts.reduce((sum, part) => sum + part.amount, 0)
      const required = Math.max(Number(student.depositAmount || 0), 700000)
      const balance = Math.max(0, required - paid)
      if (amount > balance) return ApiResponse.badRequest(res, `Maksimal depozit to‘lovi: ${balance.toLocaleString('uz-UZ')} so‘m`)
      student.depositPayments.push(...parts)
      student.depositType = 'money'
      if (!student.depositAmount || student.depositAmount < 700000) student.depositAmount = 700000
      if (!student.depositReceivedAt) student.depositReceivedAt = parts[0].paidAt
      student.depositPaymentMethod = student.depositPayments[0]?.method || parts[0].method
      await student.save()
      if (cashSession) req.app.get('io')?.emit('cash-sessions:changed', { action: 'deposit-created', cashierId: req.employee.id })
      this.emitChange(req, 'deposit-payment-created', student)
      return ApiResponse.created(res, { student, payments: parts, amount }, 'Depozit to‘lovi qabul qilindi')
    } catch (error) { return next(error) }
  }

  cancelDepositPayment = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.paymentId)) return ApiResponse.notFound(res, 'Depozit to‘lovi topilmadi')
      const session = await mongoose.startSession()
      let student
      let deposit
      try {
        await session.withTransaction(async () => {
          student = await Student.findById(req.params.id).session(session)
          if (!student) throw Object.assign(new Error('Talaba topilmadi'), { statusCode: 404 })
          deposit = student.depositPayments.id(req.params.paymentId)
          if (!deposit) throw Object.assign(new Error('Depozit to‘lovi topilmadi'), { statusCode: 404 })
          if (deposit.status === 'cancelled' || deposit.cancelledAt) throw Object.assign(new Error('Depozit to‘lovi avval bekor qilingan'), { statusCode: 400 })
          deposit.status = 'cancelled'
          deposit.cancelledAt = new Date()
          deposit.cancelledBy = req.employee._id
          deposit.auditHistory.push({ action: 'cancelled', performedBy: req.employee._id, before: { amount: deposit.amount, method: deposit.method, note: 'Depozit to‘lovi' } })
          if (deposit.cashSession) {
            const cashSession = await CashSession.findById(deposit.cashSession).session(session)
            if (cashSession && cashSession.status !== 'open') {
              const amount = Number(deposit.amount || 0)
              cashSession.expectedAmount = Math.max(0, Number(cashSession.expectedAmount || 0) - amount)
              cashSession.paymentCount = Math.max(0, Number(cashSession.paymentCount || 0) - 1)
              if (cashSession.breakdown?.[deposit.method] !== undefined) cashSession.breakdown[deposit.method] = Math.max(0, Number(cashSession.breakdown[deposit.method] || 0) - amount)
              if (cashSession.status === 'approved' && cashSession.receivedAmount !== null) cashSession.receivedAmount = Math.max(0, Number(cashSession.receivedAmount || 0) - amount)
              await cashSession.save({ session })
            }
          }
          await student.save({ session })
        })
      } finally { await session.endSession() }
      await student.populate([{ path: 'depositPayments.receivedBy', select: 'firstname lastname role' }, { path: 'depositPayments.cancelledBy', select: 'firstname lastname role' }, { path: 'depositPayments.auditHistory.performedBy', select: 'firstname lastname role' }])
      req.app.get('io')?.emit('payments:changed', { action: 'deposit-cancelled', studentId: student.id })
      req.app.get('io')?.emit('students:changed', { action: 'deposit-cancelled', studentId: student.id })
      req.app.get('io')?.emit('cash-sessions:changed', { action: 'deposit-cancelled', cashierId: req.employee.id })
      return ApiResponse.ok(res, { student }, 'Depozit to‘lovi bekor qilindi')
    } catch (error) { return next(error) }
  }

  history = async (req, res, next) => {
    try {
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const activeStudentIds = await StudentContract.distinct('student', { status: 'active', endDate: { $gte: todayStart } })
      const contractFilter = { student: { $nin: activeStudentIds }, $or: [{ status: { $in: ['completed', 'cancelled'] } }, { status: 'active', endDate: { $lt: todayStart } }] }
      if (/^\d{4}-\d{2}$/.test(String(req.query.month || ''))) {
        const start = new Date(`${req.query.month}-01T00:00:00`)
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
        contractFilter.$and = [{ $or: [{ cancelledAt: { $gte: start, $lt: end } }, { cancelledAt: null, endDate: { $gte: start, $lt: end } }] }]
      }
      const contracts = await StudentContract.find(contractFilter)
        .populate({ path: 'student', select: 'fullName phone fatherPhone motherPhone photo university faculty course gender jshr', populate: [{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }] })
        .populate('room', 'roomNumber block floor bedLayout')
        .sort({ endDate: -1, cancelledAt: -1 })
      const latestMap = new Map()
      contracts.filter((item) => item.student).forEach((item) => { if (!latestMap.has(item.student.id)) latestMap.set(item.student.id, item) })
      const latestByStudent = [...latestMap.values()]
      const search = String(req.query.search || '').trim().toLowerCase()
      let rows = search ? latestByStudent.filter((item) => `${item.student.fullName} ${item.student.phone} ${item.student.jshr} ${item.room?.block || ''} ${item.room?.roomNumber || ''} ${item.contractNumber}`.toLowerCase().includes(search)) : latestByStudent
      const total = rows.length
      const limit = 25
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), totalPages)
      rows = rows.slice((page - 1) * limit, page * limit).map((contract) => ({ student: contract.student, contract }))
      return ApiResponse.ok(res, { rows, summary: { total }, pagination: { page, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }

  cleanPayload(body) {
    const normalizePhone = (value) => String(value || '').replace(/\D/g, '').replace(/^998(?=\d{9}$)/, '')
    const depositPaymentsInput = body.depositPayments && typeof body.depositPayments === 'object' ? body.depositPayments : {}
    const depositPaymentDates = body.depositPaymentDates && typeof body.depositPaymentDates === 'object' ? body.depositPaymentDates : {}
    const depositReceivedAt = body.depositReceivedAt ? new Date(body.depositReceivedAt) : null
    const depositPaymentGroup = new mongoose.Types.ObjectId()
    const depositPayments = ['cash', 'online', 'card', 'bank'].map((method) => ({
      paymentGroup: depositPaymentGroup,
      method,
      amount: Number(depositPaymentsInput[method]) || 0,
      paidAt: depositPaymentDates[method] ? new Date(depositPaymentDates[method]) : depositReceivedAt,
    })).filter((item) => item.amount > 0)
    const payload = {
      fullName: String(body.fullName || '').trim(),
      phone: normalizePhone(body.phone),
      gender: body.gender,
      fatherPhone: normalizePhone(body.fatherPhone),
      motherPhone: normalizePhone(body.motherPhone),
      depositType: ['money', 'passport'].includes(body.depositType) ? body.depositType : 'none',
      depositAmount: Number(body.depositAmount) || 0,
      depositPaymentMethod: body.depositType === 'money' && ['cash', 'online', 'card', 'bank'].includes(body.depositPaymentMethod) ? body.depositPaymentMethod : '',
      depositReceivedAt,
      depositPayments: body.depositType === 'money' ? depositPayments : [],
      university: body.university,
      faculty: body.faculty,
      address: String(body.address || '').trim(),
      course: Number(body.course),
      educationType: ['daytime', 'evening', 'extramural', 'employed'].includes(body.educationType) ? body.educationType : 'daytime',
      hasTemporaryRegistration: body.hasTemporaryRegistration === true || body.hasTemporaryRegistration === 'true',
      temporaryRegistrationMonths: body.hasTemporaryRegistration === true || body.hasTemporaryRegistration === 'true' ? Number(body.temporaryRegistrationMonths) : null,
      studentStatus: ['green', 'warning', 'red'].includes(body.studentStatus) ? body.studentStatus : 'green',
      plannedDepartureDate: body.studentStatus === 'red' && body.plannedDepartureDate ? new Date(body.plannedDepartureDate) : null,
      hasTaxContract: body.hasTaxContract === true || body.hasTaxContract === 'true',
      taxContractType: body.hasTaxContract === true || body.hasTaxContract === 'true' ? String(body.taxContractType || '') : '',
      disciplinaryStatus: body.disciplinaryStatus || 'clear',
      disciplinaryNote: body.disciplinaryStatus === 'blacklisted' ? String(body.disciplinaryNote || '').trim() : '',
      disabilityStatus: body.disabilityStatus || 'none',
      jshr: String(body.jshr || '').replace(/\D/g, '') || undefined,
      passportSeries: String(body.passportSeries || '').trim().toUpperCase() || undefined,
      passportNumber: String(body.passportNumber || '').replace(/\D/g, '') || undefined,
      zaksSeries: String(body.zaksSeries || '').trim().toUpperCase() || undefined,
      zaksNumber: String(body.zaksNumber || '').replace(/\D/g, '') || undefined,
    }
    const faceIdCode = normalizeFaceIdCode(body.faceIdCode)
    if (faceIdCode) payload.faceIdCode = faceIdCode
    return payload
  }

  async validateFaceIdCode(payload, res, studentId) {
    if (!payload.faceIdCode) return null
    if (!isValidFaceIdCode(payload.faceIdCode)) return ApiResponse.badRequest(res, 'FaceID kodi 1–32 ta harf va raqamdan iborat bo‘lishi kerak')
    if (await faceIdCodeExists(payload.faceIdCode, { studentId })) return ApiResponse.conflict(res, 'Bu FaceID kodi boshqa talaba yoki xodimga biriktirilgan')
    return null
  }

  validateConditionalFields(payload, res) {
    if (payload.studentStatus === 'red' && (!payload.plannedDepartureDate || Number.isNaN(payload.plannedDepartureDate.getTime()))) return ApiResponse.badRequest(res, 'Ketish sanasini tanlang')
    if (payload.depositType === 'passport' && !payload.depositReceivedAt) return ApiResponse.badRequest(res, 'Depozit qabul qilingan sanani kiriting')
    if (payload.depositType === 'money' && (!Number.isFinite(payload.depositAmount) || payload.depositAmount <= 0)) return ApiResponse.badRequest(res, 'Pul depoziti summasini kiriting')
    const paidDepositAmount = payload.depositPayments.reduce((sum, item) => sum + item.amount, 0)
    if (payload.depositType === 'money' && paidDepositAmount > payload.depositAmount) return ApiResponse.badRequest(res, 'To‘langan depozit umumiy depozit summasidan oshmasligi kerak')
    if (payload.depositType === 'money' && paidDepositAmount > 0 && payload.depositPayments.some((item) => !item.paidAt || Number.isNaN(item.paidAt.getTime()))) return ApiResponse.badRequest(res, 'Har bir depozit to‘lovi sanasini kiriting')
    if (payload.hasTemporaryRegistration && (!Number.isInteger(payload.temporaryRegistrationMonths) || payload.temporaryRegistrationMonths < 1 || payload.temporaryRegistrationMonths > 12)) return ApiResponse.badRequest(res, 'Vaqtinchalik propiska muddatini 1 dan 12 oygacha kiriting')
    if (payload.hasTaxContract && !['student_contract', 'standard_contract'].includes(payload.taxContractType)) return ApiResponse.badRequest(res, 'Soliq shartnomasi turini tanlang')
    if (payload.gender === 'family' && (!payload.zaksSeries || !payload.zaksNumber)) return ApiResponse.badRequest(res, 'Oila uchun ZAKS seriyasi va raqamini kiriting')
    return null
  }

  async resolveEducation(payload, req, res) {
    const universityValue = String(payload.university || '').trim()
    const facultyValue = String(payload.faculty || '').trim()
    if (!universityValue) {
      payload.university = null
      payload.faculty = null
      return null
    }
    if (universityValue.length > 150) return ApiResponse.badRequest(res, 'Universitet nomi 150 ta belgidan oshmasin')
    if (facultyValue.length > 150) return ApiResponse.badRequest(res, 'Fakultet nomi 150 ta belgidan oshmasin')

    let university = mongoose.isValidObjectId(universityValue) ? await University.findById(universityValue) : null
    if (!university) {
      const escapedName = universityValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      university = await University.findOne({ name: { $regex: `^${escapedName}$`, $options: 'i' } })
    }
    if (!university) {
      try { university = await University.create({ name: universityValue, shortName: '' }) }
      catch (error) {
        if (error?.code !== 11000) throw error
        university = await University.findOne({ name: universityValue })
      }
      req.app.get('io')?.emit('directories:changed', { resource: 'universities', action: 'created', id: university.id })
    }

    if (!facultyValue) {
      payload.university = university._id
      payload.faculty = null
      return null
    }

    let faculty = mongoose.isValidObjectId(facultyValue) ? await Faculty.findOne({ _id: facultyValue, university: university._id }) : null
    if (!faculty) {
      const escapedName = facultyValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      faculty = await Faculty.findOne({ university: university._id, name: { $regex: `^${escapedName}$`, $options: 'i' } })
    }
    if (!faculty) {
      try { faculty = await Faculty.create({ name: facultyValue, university: university._id }) }
      catch (error) {
        if (error?.code !== 11000) throw error
        faculty = await Faculty.findOne({ university: university._id, name: facultyValue })
      }
      req.app.get('io')?.emit('directories:changed', { resource: 'faculties', action: 'created', id: faculty.id })
    }

    payload.university = university._id
    payload.faculty = faculty._id
    return null
  }

  emitChange(req, action, student) {
    req.app.get('io')?.emit('students:changed', { action, studentId: student?.id || student?._id?.toString(), occurredAt: new Date().toISOString() })
  }

  buildStudentAuditChanges(student, payload, oldImages = {}) {
    const changes = studentAuditFields
      .map(([field, label, formatter]) => {
        if (!auditChanged(student[field], payload[field])) return null
        const format = formatter || normalizeAuditValue
        return { field, label, before: format(student[field]), after: format(payload[field]) }
      })
      .filter(Boolean)
    const imageChanges = [
      imageAuditChange('photo', 'Talaba rasmi', oldImages.photo, payload.photo),
      imageAuditChange('marriageCertificate', 'ZAKS rasmi', oldImages.marriageCertificate, payload.marriageCertificate),
      imageAuditChange('passportImages.front', 'Pasport old rasmi', oldImages.passportFront, payload.passportImages?.front),
      imageAuditChange('passportImages.back', 'Pasport orqa rasmi', oldImages.passportBack, payload.passportImages?.back),
    ].filter(Boolean)
    return [...changes, ...imageChanges]
  }

  findBlacklist(payload) {
    const identities = []
    if (payload.jshr) identities.push({ jshr: payload.jshr })
    if (payload.passportSeries && payload.passportNumber) identities.push({ passportSeries: payload.passportSeries, passportNumber: payload.passportNumber })
    return identities.length ? BlacklistEntry.findOne({ active: true, $or: identities }) : null
  }

  async syncBlacklist(student) {
    const identity = { jshr: student.jshr, passportSeries: student.passportSeries, passportNumber: student.passportNumber }
    const identities = [{ sourceStudent: student._id }]
    if (student.jshr) identities.push({ jshr: student.jshr })
    if (student.passportSeries && student.passportNumber) identities.push({ passportSeries: student.passportSeries, passportNumber: student.passportNumber })
    const entry = await BlacklistEntry.findOne({ $or: identities })
    if (student.disciplinaryStatus === 'blacklisted') {
      if (entry) {
        entry.set({ ...identity, reason: student.disciplinaryNote, sourceStudent: student._id, active: true })
        await entry.save()
      } else await BlacklistEntry.create({ ...identity, reason: student.disciplinaryNote, sourceStudent: student._id, active: true })
    } else if (entry?.sourceStudent?.toString() === student.id) {
      entry.active = false
      await entry.save()
    }
  }

  checkBlacklist = async (req, res, next) => {
    try {
      const jshr = String(req.query.jshr || '').replace(/\D/g, '')
      const passport = String(req.query.passport || '').replace(/\s/g, '').toUpperCase()
      const passportSeries = passport.slice(0, 2)
      const passportNumber = passport.slice(2)
      const conditions = []
      if (/^\d{14}$/.test(jshr)) conditions.push({ jshr })
      if (/^[A-Z]{2}\d{7}$/.test(passport)) conditions.push({ passportSeries, passportNumber })
      if (!conditions.length) return ApiResponse.ok(res, { blocked: false })
      const entry = await BlacklistEntry.findOne({ active: true, $or: conditions }).sort({ updatedAt: -1 })
      return ApiResponse.ok(res, entry ? { blocked: true, reason: entry.reason, blockedAt: entry.updatedAt } : { blocked: false })
    } catch (error) { return next(error) }
  }

  list = async (req, res, next) => {
    try {
      const filter = {}
      const search = String(req.query.search || '').trim()
      if (search) {
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        filter.$or = ['fullName', 'phone', 'fatherPhone', 'motherPhone', 'jshr', 'passportNumber', 'faceIdCode'].map((field) => ({ [field]: { $regex: escapedSearch, $options: 'i' } }))
        const passportSearch = search.replace(/\s/g, '').toUpperCase()
        const passportMatch = passportSearch.match(/^([A-Z]{1,2})(\d{0,7})$/)
        if (passportMatch) {
          const [, series, number] = passportMatch
          filter.$or.push(number
            ? { $and: [{ passportSeries: { $regex: `^${series}`, $options: 'i' } }, { passportNumber: { $regex: `^${number}` } }] }
            : { passportSeries: { $regex: `^${series}`, $options: 'i' } })
        }
      }
      if (mongoose.isValidObjectId(req.query.university)) filter.university = req.query.university
      if (mongoose.isValidObjectId(req.query.faculty)) filter.faculty = req.query.faculty
      const course = Number.parseInt(req.query.course, 10)
      if (course >= 1 && course <= 6) filter.course = course
      if (['green', 'warning', 'red'].includes(req.query.studentStatus)) filter.studentStatus = req.query.studentStatus
      if (mongoose.isValidObjectId(req.query.room)) {
        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
        const studentIds = await StudentContract.distinct('student', { room: req.query.room, status: 'active', startDate: { $lte: todayEnd }, endDate: { $gte: todayStart } })
        filter._id = { $in: studentIds }
      }
      const limit = 25
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
      const total = await Student.countDocuments(filter)
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const currentPage = Math.min(page, totalPages)
      const students = await Student.find(filter)
        .populate('university', 'name shortName')
        .populate('faculty', 'name')
        .sort({ createdAt: -1 })
        .skip((currentPage - 1) * limit)
        .limit(limit)
      const activeContracts = await StudentContract.find({ student: { $in: students.map((student) => student._id) }, status: 'active' })
        .select('student endDate bedNumber room')
        .populate('room', 'roomNumber block floor')
      const contractByStudent = new Map(activeContracts.map((contract) => [contract.student.toString(), contract]))
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const oneMonthFromToday = new Date(today)
      oneMonthFromToday.setMonth(oneMonthFromToday.getMonth() + 1)
      const rows = students.map((student) => {
        const contract = contractByStudent.get(student.id)
        const room = contract?.room
        const bed = room?.bedLayout?.find((item) => item.slotNumbers?.map(Number).includes(Number(contract.bedNumber)))
        const bedSlotIndex = bed?.slotNumbers?.map(Number).indexOf(Number(contract?.bedNumber))
        const bedType = bed?.type === 'single' ? '[1]' : bed?.type === 'bunk' ? `[2.${bedSlotIndex === 0 ? 1 : 2}]` : ''
        const contractExpiresSoon = contract?.endDate && contract.endDate >= today && contract.endDate <= oneMonthFromToday
        return {
          ...student.toJSON(),
          studentStatus: contractExpiresSoon ? 'red' : student.studentStatus,
          plannedDepartureDate: contractExpiresSoon ? contract.endDate : student.plannedDepartureDate,
          activeContractEndDate: contract?.endDate || null,
          activeRoom: room ? { ...room.toJSON(), bedNumber: contract.bedNumber, bedType } : null,
        }
      })
      return ApiResponse.ok(res, { students: rows, pagination: { page: currentPage, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }

  getById = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const student = await Student.findById(req.params.id)
        .populate('university', 'name shortName')
        .populate('faculty', 'name')
        .populate('auditHistory.performedBy', 'firstname lastname role position')
      if (!student) return ApiResponse.notFound(res, 'Talaba topilmadi')
      return ApiResponse.ok(res, { student })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const payload = this.cleanPayload(req.body)
      if (await this.validateFaceIdCode(payload, res)) return undefined
      if (this.validateConditionalFields(payload, res)) return undefined
      if (await this.resolveEducation(payload, req, res)) return undefined
      if (payload.disciplinaryStatus === 'blacklisted' && !payload.disciplinaryNote) return ApiResponse.badRequest(res, 'Qora ro‘yxat sababini kiriting')
      if (payload.depositPayments.length && !this.canReceivePayment(req.employee)) return ApiResponse.forbidden(res, 'Depozit pulini kiritish uchun kassir yoki bosh kassir orqali to‘lov qabul qiling')
      const blocked = await this.findBlacklist(payload)
      if (blocked) return ApiResponse.conflict(res, `Bu shaxs qora ro‘yxatda: ${blocked.reason}`)
      const photoFile = req.files?.photo?.[0]
      const marriageCertificateFile = req.files?.marriageCertificate?.[0]
      const passportFrontFile = req.files?.passportFront?.[0]
      const passportBackFile = req.files?.passportBack?.[0]
      if (payload.gender === 'family' && !marriageCertificateFile) return ApiResponse.badRequest(res, 'Oila uchun ZAKS qog‘ozi rasmini yuklang')
      payload.photo = photoFile ? (await uploadImages([photoFile]))[0] : null
      payload.marriageCertificate = marriageCertificateFile ? (await uploadImages([marriageCertificateFile]))[0] : null
      payload.passportImages = {
        front: passportFrontFile ? await savePrivateImage(passportFrontFile, 'front') : null,
        back: passportBackFile ? await savePrivateImage(passportBackFile, 'back') : null,
      }
      const cashSession = await this.getReceivingCashSession(req.employee)
      payload.depositPayments = payload.depositPayments.map((payment) => ({ ...payment, receivedBy: req.employee?._id || null, cashSession: cashSession?._id || null, auditHistory: [{ action: 'created', performedBy: req.employee._id, after: { amount: payment.amount, method: payment.method, note: 'Depozit to‘lovi' } }] }))
      payload.depositPaymentMethod = payload.depositPayments[0]?.method || ''
      const student = await Student.create(payload)
      if (cashSession && payload.depositPayments.length) req.app.get('io')?.emit('cash-sessions:changed', { action: 'deposit-created', cashierId: req.employee.id })
      await this.syncBlacklist(student)
      await student.populate([{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }])
      this.emitChange(req, 'created', student)
      return ApiResponse.created(res, { student }, 'Talaba qo‘shildi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const student = await Student.findById(req.params.id)
      if (!student) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const payload = this.cleanPayload(req.body)
      if (await this.validateFaceIdCode(payload, res, student.id)) return undefined
      if (this.validateConditionalFields(payload, res)) return undefined
      if (await this.resolveEducation(payload, req, res)) return undefined
      if (payload.disciplinaryStatus === 'blacklisted' && !payload.disciplinaryNote) return ApiResponse.badRequest(res, 'Qora ro‘yxat sababini kiriting')
      const existingDepositPayments = student.depositPayments || []
      if (existingDepositPayments.length && payload.depositType !== student.depositType) return ApiResponse.badRequest(res, 'Depozit turi to‘lov mavjud bo‘lganda o‘zgartirilmaydi')
      if (payload.depositPayments.length && !this.canReceivePayment(req.employee) && !existingDepositPayments.length) return ApiResponse.forbidden(res, 'Depozit pulini kiritish uchun kassir yoki bosh kassir orqali to‘lov qabul qiling')
      const blocked = await this.findBlacklist(payload)
      if (blocked && blocked.sourceStudent?.toString() !== student.id) return ApiResponse.conflict(res, `Bu shaxs qora ro‘yxatda: ${blocked.reason}`)
      const oldPhoto = student.photo ? student.photo.toJSON?.() || student.photo : null
      const oldMarriageCertificate = student.marriageCertificate ? student.marriageCertificate.toJSON?.() || student.marriageCertificate : null
      const oldPassportFront = student.passportImages?.front ? student.passportImages.front.toJSON?.() || student.passportImages.front : null
      const oldPassportBack = student.passportImages?.back ? student.passportImages.back.toJSON?.() || student.passportImages.back : null
      const photoFile = req.files?.photo?.[0]
      const marriageCertificateFile = req.files?.marriageCertificate?.[0]
      const passportFrontFile = req.files?.passportFront?.[0]
      const passportBackFile = req.files?.passportBack?.[0]
      if (payload.gender === 'family' && !marriageCertificateFile && !student.marriageCertificate) return ApiResponse.badRequest(res, 'Oila uchun ZAKS qog‘ozi rasmini yuklang')
      const uploaded = photoFile ? (await uploadImages([photoFile]))[0] : null
      payload.photo = req.body.removePhoto ? null : uploaded || student.photo || null
      payload.marriageCertificate = marriageCertificateFile ? (await uploadImages([marriageCertificateFile]))[0] : student.marriageCertificate || null
      payload.passportImages = {
        front: passportFrontFile ? await savePrivateImage(passportFrontFile, 'front') : req.body.removePassportFront ? null : student.passportImages?.front || null,
        back: passportBackFile ? await savePrivateImage(passportBackFile, 'back') : req.body.removePassportBack ? null : student.passportImages?.back || null,
      }
      // Talaba kartasini tahrirlash pul qabul qilish emas. Avval yozilgan
      // depozit cheklari va ularning kassa sessiyasi o‘zgarmaydi.
      if (existingDepositPayments.length) {
        payload.depositPayments = existingDepositPayments
        payload.depositReceivedAt = student.depositReceivedAt
        payload.depositPaymentMethod = student.depositPaymentMethod || existingDepositPayments[0]?.method || ''
      } else if (payload.depositPayments.length) {
        const cashSession = await this.getReceivingCashSession(req.employee)
        payload.depositPayments = payload.depositPayments.map((payment) => ({ ...payment, receivedBy: req.employee._id, cashSession: cashSession._id, auditHistory: [{ action: 'created', performedBy: req.employee._id, after: { amount: payment.amount, method: payment.method, note: 'Depozit to‘lovi' } }] }))
        payload.depositPaymentMethod = payload.depositPayments[0]?.method || ''
        req.app.get('io')?.emit('cash-sessions:changed', { action: 'deposit-created', cashierId: req.employee.id })
      } else {
        payload.depositPaymentMethod = ''
        payload.depositReceivedAt = null
      }
      const auditChanges = this.buildStudentAuditChanges(student, payload, {
        photo: oldPhoto,
        marriageCertificate: oldMarriageCertificate,
        passportFront: oldPassportFront,
        passportBack: oldPassportBack,
      })
      if (auditChanges.length) {
        student.auditHistory.push({
          scope: 'student',
          action: 'updated',
          title: 'Talaba ma’lumotlari yangilandi',
          performedBy: req.employee._id,
          changes: auditChanges,
        })
      }
      student.set(payload)
      await student.save()
      if ((req.body.removePhoto || uploaded) && oldPhoto?.url) await deleteImage(oldPhoto).catch(() => {})
      if (passportFrontFile || req.body.removePassportFront) await deletePrivateImage(oldPassportFront).catch(() => {})
      if (passportBackFile || req.body.removePassportBack) await deletePrivateImage(oldPassportBack).catch(() => {})
      await this.syncBlacklist(student)
      await student.populate([{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }, { path: 'auditHistory.performedBy', select: 'firstname lastname role position' }])
      this.emitChange(req, 'updated', student)
      return ApiResponse.ok(res, { student }, 'Talaba yangilandi')
    } catch (error) { return next(error) }
  }

  returnDeposit = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const student = await Student.findById(req.params.id)
      if (!student) return ApiResponse.notFound(res, 'Talaba topilmadi')
      if (student.depositType === 'none') return ApiResponse.badRequest(res, 'Bu talaba uchun depozit olinmagan')
      if (student.depositReturnedAt) return ApiResponse.badRequest(res, 'Depozit avval qaytarilgan')
      student.depositReturnedAt = new Date()
      student.depositReturnedBy = req.employee._id
      await student.save()
      await student.populate([{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }, { path: 'depositReturnedBy', select: 'firstname lastname position' }])
      this.emitChange(req, 'deposit-returned', student)
      return ApiResponse.ok(res, { student }, 'Depozit qaytarildi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const student = await Student.findByIdAndDelete(req.params.id)
      if (!student) return ApiResponse.notFound(res, 'Talaba topilmadi')
      await Promise.all([
        deleteImage(student.photo).catch(() => {}),
        deletePrivateImage(student.passportImages?.front).catch(() => {}),
        deletePrivateImage(student.passportImages?.back).catch(() => {}),
      ])
      this.emitChange(req, 'deleted', student)
      return ApiResponse.ok(res, { studentId: student.id }, 'Talaba o‘chirildi')
    } catch (error) { return next(error) }
  }

  passportImage = async (req, res, next) => {
    try {
      if (!this.canViewPrivateDocuments(req.employee)) return ApiResponse.forbidden(res, 'Pasport rasmini ko‘rish uchun ruxsat yo‘q')
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const side = req.params.side === 'back' ? 'back' : req.params.side === 'front' ? 'front' : ''
      if (!side) return ApiResponse.notFound(res, 'Pasport rasmi topilmadi')
      const student = await Student.findById(req.params.id).select('passportImages')
      const image = student?.passportImages?.[side]
      const filePath = privateImagePath(image)
      if (!filePath) return ApiResponse.notFound(res, 'Pasport rasmi topilmadi')
      res.type(image.mimetype || 'image/jpeg')
      return res.sendFile(filePath)
    } catch (error) { return next(error) }
  }
}

export const studentController = new StudentController()
