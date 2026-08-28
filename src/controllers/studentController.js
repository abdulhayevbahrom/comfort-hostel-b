import mongoose from 'mongoose'
import { BlacklistEntry } from '../models/BlacklistEntry.js'
import { Faculty } from '../models/Faculty.js'
import { Student } from '../models/Student.js'
import { StudentContract } from '../models/StudentContract.js'
import { University } from '../models/University.js'
import { ApiResponse } from '../utils/response.js'
import { uploadImages } from '../utils/imgbb.js'

class StudentController {
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
        .populate({ path: 'student', select: 'fullName phone parentPhone photo university faculty course gender jshr', populate: [{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }] })
        .populate('room', 'roomNumber block floor')
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
    return {
      fullName: String(body.fullName || '').trim(),
      phone: normalizePhone(body.phone),
      gender: body.gender,
      parentPhone: normalizePhone(body.parentPhone),
      depositType: ['money', 'passport'].includes(body.depositType) ? body.depositType : 'none',
      depositAmount: Number(body.depositAmount) || 0,
      depositReceivedAt: body.depositReceivedAt ? new Date(body.depositReceivedAt) : null,
      university: body.university,
      faculty: body.faculty,
      address: String(body.address || '').trim(),
      course: Number(body.course),
      educationType: ['daytime', 'evening', 'extramural', 'employed'].includes(body.educationType) ? body.educationType : 'daytime',
      hasTemporaryRegistration: body.hasTemporaryRegistration === true || body.hasTemporaryRegistration === 'true',
      temporaryRegistrationMonths: body.hasTemporaryRegistration === true || body.hasTemporaryRegistration === 'true' ? Number(body.temporaryRegistrationMonths) : null,
      studentStatus: ['green', 'warning', 'red'].includes(body.studentStatus) ? body.studentStatus : 'green',
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
  }

  validateConditionalFields(payload, res) {
    if (payload.depositType !== 'none' && !payload.depositReceivedAt) return ApiResponse.badRequest(res, 'Depozit qabul qilingan sanani kiriting')
    if (payload.depositType === 'money' && (!Number.isFinite(payload.depositAmount) || payload.depositAmount <= 0)) return ApiResponse.badRequest(res, 'Pul depoziti summasini kiriting')
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
        filter.$or = ['fullName', 'phone', 'jshr', 'passportNumber', 'faceIdCode'].map((field) => ({ [field]: { $regex: escapedSearch, $options: 'i' } }))
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
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      const todayEnd = new Date(today)
      todayEnd.setUTCHours(23, 59, 59, 999)
      const activeContracts = await StudentContract.find({ student: { $in: students.map((student) => student._id) }, status: 'active', startDate: { $lte: todayEnd }, endDate: { $gte: today } }).select('student endDate')
      const contractEndByStudent = new Map(activeContracts.map((contract) => [contract.student.toString(), contract.endDate]))
      const rows = students.map((student) => ({ ...student.toJSON(), activeContractEndDate: contractEndByStudent.get(student.id) || null }))
      return ApiResponse.ok(res, { students: rows, pagination: { page: currentPage, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }

  getById = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const student = await Student.findById(req.params.id).populate('university', 'name shortName').populate('faculty', 'name')
      if (!student) return ApiResponse.notFound(res, 'Talaba topilmadi')
      return ApiResponse.ok(res, { student })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const payload = this.cleanPayload(req.body)
      if (this.validateConditionalFields(payload, res)) return undefined
      if (await this.resolveEducation(payload, req, res)) return undefined
      if (payload.disciplinaryStatus === 'blacklisted' && !payload.disciplinaryNote) return ApiResponse.badRequest(res, 'Qora ro‘yxat sababini kiriting')
      const blocked = await this.findBlacklist(payload)
      if (blocked) return ApiResponse.conflict(res, `Bu shaxs qora ro‘yxatda: ${blocked.reason}`)
      const photoFile = req.files?.photo?.[0]
      const marriageCertificateFile = req.files?.marriageCertificate?.[0]
      if (payload.gender === 'family' && !marriageCertificateFile) return ApiResponse.badRequest(res, 'Oila uchun ZAKS qog‘ozi rasmini yuklang')
      payload.photo = photoFile ? (await uploadImages([photoFile]))[0] : null
      payload.marriageCertificate = marriageCertificateFile ? (await uploadImages([marriageCertificateFile]))[0] : null
      const student = await Student.create(payload)
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
      if (this.validateConditionalFields(payload, res)) return undefined
      if (await this.resolveEducation(payload, req, res)) return undefined
      if (payload.disciplinaryStatus === 'blacklisted' && !payload.disciplinaryNote) return ApiResponse.badRequest(res, 'Qora ro‘yxat sababini kiriting')
      const blocked = await this.findBlacklist(payload)
      if (blocked && blocked.sourceStudent?.toString() !== student.id) return ApiResponse.conflict(res, `Bu shaxs qora ro‘yxatda: ${blocked.reason}`)
      const photoFile = req.files?.photo?.[0]
      const marriageCertificateFile = req.files?.marriageCertificate?.[0]
      if (payload.gender === 'family' && !marriageCertificateFile && !student.marriageCertificate) return ApiResponse.badRequest(res, 'Oila uchun ZAKS qog‘ozi rasmini yuklang')
      const uploaded = photoFile ? (await uploadImages([photoFile]))[0] : null
      payload.photo = req.body.removePhoto ? null : uploaded || student.photo || null
      payload.marriageCertificate = marriageCertificateFile ? (await uploadImages([marriageCertificateFile]))[0] : student.marriageCertificate || null
      student.set(payload)
      await student.save()
      await this.syncBlacklist(student)
      await student.populate([{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }])
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
      this.emitChange(req, 'deleted', student)
      return ApiResponse.ok(res, { studentId: student.id }, 'Talaba o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const studentController = new StudentController()
