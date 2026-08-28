import mongoose from 'mongoose'
import { Faculty } from '../models/Faculty.js'
import { University } from '../models/University.js'
import { ApiResponse } from '../utils/response.js'

class UniversityController {
  cleanPayload(body) {
    return {
      name: String(body.name || '').trim(),
      shortName: String(body.shortName || '').trim(),
    }
  }

  emitChange(req, action, university) {
    req.app.get('io')?.emit('directories:changed', { resource: 'universities', action, id: university?.id || university?._id?.toString() })
  }

  list = async (_req, res, next) => {
    try {
      const universities = await University.aggregate([
        { $lookup: { from: 'faculties', localField: '_id', foreignField: 'university', as: 'faculties' } },
        { $addFields: { facultyCount: { $size: '$faculties' }, id: { $toString: '$_id' } } },
        { $project: { _id: 0, __v: 0, faculties: 0 } },
        { $sort: { name: 1 } },
      ])
      return ApiResponse.ok(res, { universities })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const university = await University.create(this.cleanPayload(req.body))
      this.emitChange(req, 'created', university)
      return ApiResponse.created(res, { university }, 'Universitet qo‘shildi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Universitet topilmadi')
      const university = await University.findByIdAndUpdate(req.params.id, this.cleanPayload(req.body), { new: true, runValidators: true })
      if (!university) return ApiResponse.notFound(res, 'Universitet topilmadi')
      this.emitChange(req, 'updated', university)
      return ApiResponse.ok(res, { university }, 'Universitet yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Universitet topilmadi')
      if (await Faculty.exists({ university: req.params.id })) return ApiResponse.conflict(res, 'Avval ushbu universitetga biriktirilgan fakultetlarni o‘chiring')
      const university = await University.findByIdAndDelete(req.params.id)
      if (!university) return ApiResponse.notFound(res, 'Universitet topilmadi')
      this.emitChange(req, 'deleted', university)
      return ApiResponse.ok(res, { universityId: university.id }, 'Universitet o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const universityController = new UniversityController()
