import mongoose from 'mongoose'
import { Faculty } from '../models/Faculty.js'
import { Student } from '../models/Student.js'
import { University } from '../models/University.js'
import { ApiResponse } from '../utils/response.js'

class FacultyController {
  cleanPayload(body) {
    return { name: String(body.name || '').trim(), university: body.university }
  }

  emitChange(req, action, faculty) {
    req.app.get('io')?.emit('directories:changed', { resource: 'faculties', action, id: faculty?.id || faculty?._id?.toString() })
  }

  list = async (req, res, next) => {
    try {
      const filter = mongoose.isValidObjectId(req.query.university) ? { university: req.query.university } : {}
      const faculties = await Faculty.find(filter).populate('university', 'name shortName').sort({ name: 1 })
      return ApiResponse.ok(res, { faculties })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const payload = this.cleanPayload(req.body)
      if (!mongoose.isValidObjectId(payload.university) || !(await University.exists({ _id: payload.university }))) return ApiResponse.badRequest(res, 'Universitetni to‘g‘ri tanlang')
      const faculty = await Faculty.create(payload)
      await faculty.populate('university', 'name shortName')
      this.emitChange(req, 'created', faculty)
      return ApiResponse.created(res, { faculty }, 'Fakultet qo‘shildi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Fakultet topilmadi')
      const payload = this.cleanPayload(req.body)
      if (!mongoose.isValidObjectId(payload.university) || !(await University.exists({ _id: payload.university }))) return ApiResponse.badRequest(res, 'Universitetni to‘g‘ri tanlang')
      const faculty = await Faculty.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true }).populate('university', 'name shortName')
      if (!faculty) return ApiResponse.notFound(res, 'Fakultet topilmadi')
      this.emitChange(req, 'updated', faculty)
      return ApiResponse.ok(res, { faculty }, 'Fakultet yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Fakultet topilmadi')
      if (await Student.exists({ faculty: req.params.id })) return ApiResponse.conflict(res, 'Bu fakultetga talabalar biriktirilgan')
      const faculty = await Faculty.findByIdAndDelete(req.params.id)
      if (!faculty) return ApiResponse.notFound(res, 'Fakultet topilmadi')
      this.emitChange(req, 'deleted', faculty)
      return ApiResponse.ok(res, { facultyId: faculty.id }, 'Fakultet o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const facultyController = new FacultyController()
