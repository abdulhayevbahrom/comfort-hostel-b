import mongoose from 'mongoose'
import { Employee } from '../models/Employee.js'
import { Room } from '../models/Room.js'
import { hashPassword, validatePassword } from '../utils/bcrypt.js'
import { ApiResponse } from '../utils/response.js'

class EmployeeController {
  cleanPayload(body) {
    const payload = {
      firstname: body.firstname,
      lastname: body.lastname,
      position: body.position,
      salary: Number(body.salary || 0),
      payrollStartMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(body.payrollStartMonth || '')
        ? body.payrollStartMonth
        : new Date().toISOString().slice(0, 7),
      payrollOpeningBalance: Number(body.payrollOpeningBalance || 0),
      isActive: body.isActive ?? true,
      canLogin: Boolean(body.canLogin),
      sections: Array.isArray(body.sections) ? body.sections : [],
      assignedRooms: Array.isArray(body.assignedRooms)
        ? [...new Set(body.assignedRooms.filter((id) => mongoose.isValidObjectId(id)))]
        : [],
      businessUnit: body.businessUnit === 'shop' ? 'shop' : 'hostel',
    }

    if (payload.canLogin) {
      payload.role = body.role || 'employee'
      payload.login = body.login?.trim().toLowerCase()
    } else {
      payload.role = 'employee'
      payload.sections = []
    }

    if (body.faceAccessEnabled !== undefined) payload.faceAccessEnabled = body.faceAccessEnabled === true
    return payload
  }

  validateRooms = async (payload) => {
    if (!payload.assignedRooms.length) return true
    const roomCount = await Room.countDocuments({ _id: { $in: payload.assignedRooms } })
    return roomCount === payload.assignedRooms.length
  }

  emitChange(req, action, employee) {
    req.app.get('io')?.emit('employees:changed', {
      action,
      employeeId: employee?.id || employee?._id?.toString(),
      occurredAt: new Date().toISOString(),
    })
  }

  list = async (req, res, next) => {
    try {
      const filter = { businessUnit: req.query.businessUnit === 'shop' ? 'shop' : { $ne: 'shop' } }
      const search = req.query.search?.trim()
      if (search) {
        filter.$or = ['firstname', 'lastname', 'position', 'login'].map((field) => ({
          [field]: { $regex: search, $options: 'i' },
        }))
      }
      const employees = await Employee.find(filter)
        .populate('assignedRooms', 'roomNumber block floor')
        .sort({ createdAt: -1 })
      return ApiResponse.ok(res, { employees })
    } catch (error) {
      return next(error)
    }
  }

  getById = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const employee = await Employee.findById(req.params.id).populate('assignedRooms', 'roomNumber block floor')
      if (!employee) return ApiResponse.notFound(res, 'Xodim topilmadi')
      return ApiResponse.ok(res, { employee })
    } catch (error) {
      return next(error)
    }
  }

  create = async (req, res, next) => {
    try {
      const payload = this.cleanPayload(req.body)
      if (!(await this.validateRooms(payload))) return ApiResponse.badRequest(res, 'Tanlangan xonalardan biri topilmadi')
      if (payload.canLogin) {
        if (!payload.login) return ApiResponse.badRequest(res, 'Login kiritilishi shart')
        const passwordError = validatePassword(req.body.password)
        if (passwordError) return ApiResponse.badRequest(res, passwordError)
        payload.passwordHash = await hashPassword(req.body.password)
      }
      const employee = await Employee.create(payload)
      this.emitChange(req, 'created', employee)
      return ApiResponse.created(res, { employee }, 'Xodim qo‘shildi')
    } catch (error) {
      return next(error)
    }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const payload = this.cleanPayload(req.body)
      if (!(await this.validateRooms(payload))) return ApiResponse.badRequest(res, 'Tanlangan xonalardan biri topilmadi')
      if (payload.canLogin && !payload.login) return ApiResponse.badRequest(res, 'Login kiritilishi shart')
      if (payload.canLogin && req.body.password) {
        const passwordError = validatePassword(req.body.password)
        if (passwordError) return ApiResponse.badRequest(res, passwordError)
        payload.passwordHash = await hashPassword(req.body.password)
      }
      const update = payload.canLogin
        ? { $set: payload }
        : { $set: payload, $unset: { login: 1, passwordHash: 1 } }
      const employee = await Employee.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      if (!employee) return ApiResponse.notFound(res, 'Xodim topilmadi')
      this.emitChange(req, 'updated', employee)
      return ApiResponse.ok(res, { employee }, 'Xodim yangilandi')
    } catch (error) {
      return next(error)
    }
  }

  assignRooms = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const assignedRooms = Array.isArray(req.body.assignedRooms)
        ? [...new Set(req.body.assignedRooms.filter((id) => mongoose.isValidObjectId(id)))]
        : []
      if (!(await this.validateRooms({ assignedRooms }))) return ApiResponse.badRequest(res, 'Tanlangan xonalardan biri topilmadi')
      const employee = await Employee.findByIdAndUpdate(req.params.id, { $set: { assignedRooms } }, { new: true, runValidators: true })
        .populate('assignedRooms', 'roomNumber block floor')
      if (!employee) return ApiResponse.notFound(res, 'Xodim topilmadi')
      this.emitChange(req, 'rooms-assigned', employee)
      return ApiResponse.ok(res, { employee }, 'Xonalar biriktirildi')
    } catch (error) {
      return next(error)
    }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xodim topilmadi')
      const employee = await Employee.findByIdAndDelete(req.params.id)
      if (!employee) return ApiResponse.notFound(res, 'Xodim topilmadi')
      this.emitChange(req, 'deleted', employee)
      return ApiResponse.ok(res, { employeeId: employee.id }, 'Xodim o‘chirildi')
    } catch (error) {
      return next(error)
    }
  }
}

export const employeeController = new EmployeeController()
