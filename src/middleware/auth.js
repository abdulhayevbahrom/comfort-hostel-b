import { Employee } from '../models/Employee.js'
import { ApiResponse } from '../utils/response.js'
import { verifyAuthToken } from '../utils/authToken.js'

export async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    const payload = verifyAuthToken(token)
    if (!payload) return ApiResponse.unauthorized(res, 'Tizimga qayta kiring')
    const employee = await Employee.findById(payload.id)
    if (!employee || !employee.isActive || !employee.canLogin) return ApiResponse.unauthorized(res, 'Xodim hisobi faol emas')
    req.employee = employee
    return next()
  } catch (_error) { return ApiResponse.unauthorized(res, 'Tizimga qayta kiring') }
}

export function ownerOnly(req, res, next) {
  if (!['owner', 'admin'].includes(req.employee?.role)) return ApiResponse.forbidden(res, 'Bu amal faqat owner uchun ruxsat etilgan')
  return next()
}

export function strictOwnerOnly(req, res, next) {
  if (req.employee?.role !== 'owner') return ApiResponse.forbidden(res, 'Bu amal faqat owner uchun ruxsat etilgan')
  return next()
}

export function managerOrAdminOnly(req, res, next) {
  if (!['manager', 'owner', 'admin'].includes(req.employee?.role)) {
    return ApiResponse.forbidden(res, 'Bu amal faqat menejer yoki administrator uchun ruxsat etilgan')
  }
  return next()
}
