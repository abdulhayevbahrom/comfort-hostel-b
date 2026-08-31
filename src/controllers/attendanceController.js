import mongoose from 'mongoose'
import { Attendance } from '../models/Attendance.js'
import { StudentContract } from '../models/StudentContract.js'
import { StudentStaySession } from '../models/StudentStaySession.js'
import { ApiResponse } from '../utils/response.js'

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
const validStatuses = ['present', 'absent', 'late']
const localDateKey = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

class AttendanceController {
  historyList = async (req, res, next) => {
    try {
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : new Date().toISOString().slice(0, 7)
      const monthStart = new Date(`${month}-01T00:00:00.000Z`)
      const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999))
      const contractFilter = { status: { $in: ['active', 'completed'] }, startDate: { $lte: monthEnd }, endDate: { $gte: monthStart } }
      if (mongoose.isValidObjectId(req.query.room)) contractFilter.room = req.query.room
      let contracts = await StudentContract.find(contractFilter)
        .populate({ path: 'student', select: 'fullName phone photo university faculty course', populate: [{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }] })
        .populate('room', 'roomNumber block floor')
      if (req.query.block) contracts = contracts.filter((item) => item.room?.block === req.query.block)
      let uniqueContracts = [...new Map(contracts.filter((item) => item.student && item.room).map((item) => [item.student.id, item])).values()]
      const search = String(req.query.search || '').trim().toLowerCase()
      if (search) uniqueContracts = uniqueContracts.filter((item) => `${item.student.fullName} ${item.student.phone} ${item.room.block} ${item.room.roomNumber}`.toLowerCase().includes(search))
      uniqueContracts.sort((a, b) => a.student.fullName.localeCompare(b.student.fullName))

      const studentIds = uniqueContracts.map((item) => item.student._id)
      const records = await Attendance.find({ student: { $in: studentIds }, attendanceDate: { $regex: `^${month}-` } })
        .select('student attendanceDate status note markedAt source firstEntry lastSeenAt')
        .sort({ attendanceDate: 1 })
      const recordsByStudent = new Map()
      records.forEach((record) => { const key = record.student.toString(); if (!recordsByStudent.has(key)) recordsByStudent.set(key, []); recordsByStudent.get(key).push(record) })
      const allRows = uniqueContracts.map((contract) => ({ student: contract.student, room: contract.room, records: recordsByStudent.get(contract.student.id) || [] }))
      const limit = 25
      const total = allRows.length
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), totalPages)
      const rows = allRows.slice((page - 1) * limit, page * limit)
      const summary = { totalRecords: records.length, present: 0, absent: 0, late: 0 }
      records.forEach((item) => { summary[item.status] += 1 })
      return ApiResponse.ok(res, { rows, summary, month, pagination: { page, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }

  history = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.studentId)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : new Date().toISOString().slice(0, 7)
      const records = await Attendance.find({ student: req.params.studentId, attendanceDate: { $regex: `^${month}-` } })
        .populate('markedBy', 'firstname lastname position role')
        .sort({ attendanceDate: 1 })
      const summary = {
        total: records.length,
        present: records.filter((item) => item.status === 'present').length,
        absent: records.filter((item) => item.status === 'absent').length,
        late: records.filter((item) => item.status === 'late').length,
      }
      return ApiResponse.ok(res, { records, summary, month })
    } catch (error) { return next(error) }
  }

  list = async (req, res, next) => {
    try {
      const attendanceDate = validDate(req.query.date) ? String(req.query.date) : new Date().toISOString().slice(0, 10)
      const contractFilter = { status: 'active', startDate: { $lte: new Date(`${attendanceDate}T23:59:59.999Z`) }, endDate: { $gte: new Date(`${attendanceDate}T00:00:00.000Z`) } }
      if (mongoose.isValidObjectId(req.query.room)) contractFilter.room = req.query.room

      let contracts = await StudentContract.find(contractFilter)
        .populate({ path: 'student', select: 'fullName phone photo university faculty course', populate: [{ path: 'university', select: 'name shortName' }, { path: 'faculty', select: 'name' }] })
        .populate('room', 'roomNumber block floor')
        .sort({ createdAt: -1 })
      if (req.query.block) contracts = contracts.filter((item) => item.room?.block === req.query.block)

      const uniqueContracts = [...new Map(contracts.filter((item) => item.student && item.room).map((item) => [item.student.id, item])).values()]
      const attendance = await Attendance.find({ attendanceDate, student: { $in: uniqueContracts.map((item) => item.student._id) } })
        .populate('markedBy', 'firstname lastname position role')
      const dayStart = new Date(`${attendanceDate}T00:00:00.000Z`)
      const dayEnd = new Date(`${attendanceDate}T23:59:59.999Z`)
      const sessions = await StudentStaySession.find({ student: { $in: uniqueContracts.map((item) => item.student._id) }, entryAt: { $gte: dayStart, $lte: dayEnd } }).select('student entryAt exitAt').sort({ entryAt: 1 })
      const byStudent = new Map(attendance.map((item) => [item.student.toString(), item]))
      const sessionsByStudent = new Map()
      sessions.forEach((session) => {
        const key = session.student.toString()
        const current = sessionsByStudent.get(key) || { entryAt: null, exitAt: null }
        if (!current.entryAt || session.entryAt < current.entryAt) current.entryAt = session.entryAt
        if (session.exitAt && (!current.exitAt || session.exitAt > current.exitAt)) current.exitAt = session.exitAt
        sessionsByStudent.set(key, current)
      })
      let rows = uniqueContracts.map((contract) => ({ student: contract.student, room: contract.room, attendance: byStudent.get(contract.student.id) || null, ...(sessionsByStudent.get(contract.student.id) || {}) }))

      const search = String(req.query.search || '').trim().toLowerCase()
      if (search) rows = rows.filter((row) => `${row.student.fullName} ${row.student.phone} ${row.room.block} ${row.room.roomNumber}`.toLowerCase().includes(search))
      if (validStatuses.includes(req.query.status)) rows = rows.filter((row) => row.attendance?.status === req.query.status)
      if (req.query.status === 'unmarked') rows = rows.filter((row) => !row.attendance)
      rows.sort((a, b) => a.room.block.localeCompare(b.room.block) || a.room.roomNumber.localeCompare(b.room.roomNumber, undefined, { numeric: true }) || a.student.fullName.localeCompare(b.student.fullName))

      const limit = 25
      const total = rows.length
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const requestedPage = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
      const page = Math.min(requestedPage, totalPages)
      rows = rows.slice((page - 1) * limit, page * limit)

      const summary = {
        total: uniqueContracts.length,
        present: attendance.filter((item) => item.status === 'present').length,
        absent: attendance.filter((item) => item.status === 'absent').length,
        late: attendance.filter((item) => item.status === 'late').length,
        unmarked: Math.max(0, uniqueContracts.length - attendance.length),
      }
      return ApiResponse.ok(res, { rows, summary, attendanceDate, pagination: { page, limit, total, totalPages } })
    } catch (error) { return next(error) }
  }

  save = async (req, res, next) => {
    try {
      const attendanceDate = String(req.body.attendanceDate || '')
      const records = Array.isArray(req.body.records) ? req.body.records : []
      if (!validDate(attendanceDate)) return ApiResponse.badRequest(res, 'Davomat sanasini to‘g‘ri kiriting')
      if (attendanceDate > localDateKey()) return ApiResponse.badRequest(res, 'Kelgusi kun uchun davomat belgilab bo‘lmaydi')
      if (!records.length) return ApiResponse.badRequest(res, 'Kamida bitta talaba holatini belgilang')
      if (records.length > 500) return ApiResponse.badRequest(res, 'Bir martada 500 tagacha davomat saqlash mumkin')
      const invalid = records.some((item) => !mongoose.isValidObjectId(item.student) || !validStatuses.includes(item.status))
      if (invalid) return ApiResponse.badRequest(res, 'Talaba yoki davomat holati noto‘g‘ri')

      const operations = records.map((item) => ({
        updateOne: {
          filter: { student: item.student, attendanceDate },
          update: { $set: { status: item.status, note: String(item.note || '').trim().slice(0, 500), markedBy: req.employee._id, markedAt: new Date(), source: 'manual' } },
          upsert: true,
        },
      }))
      await Attendance.bulkWrite(operations)
      req.app.get('io')?.emit('attendance:changed', { attendanceDate, studentIds: records.map((item) => item.student), occurredAt: new Date().toISOString() })
      return ApiResponse.ok(res, { savedCount: records.length }, `${records.length} ta davomat saqlandi`)
    } catch (error) { return next(error) }
  }
}

export const attendanceController = new AttendanceController()
