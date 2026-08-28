import { Employee } from '../models/Employee.js'
import { comparePassword } from '../utils/bcrypt.js'
import { createAuthToken } from '../utils/authToken.js'
import { ApiResponse } from '../utils/response.js'

class AuthController {
  login = async (req, res, next) => {
    try {
      const login = String(req.body.login || '').trim().toLowerCase()
      const employee = await Employee.findOne({ login, canLogin: true, isActive: true }).select('+passwordHash')
      if (!employee || !await comparePassword(req.body.password, employee.passwordHash)) return ApiResponse.unauthorized(res, 'Login yoki parol noto‘g‘ri')
      employee.passwordHash = undefined
      return ApiResponse.ok(res, { token: createAuthToken(employee), employee }, 'Tizimga kirildi')
    } catch (error) { return next(error) }
  }

  me = async (req, res) => ApiResponse.ok(res, { employee: req.employee })
}

export const authController = new AuthController()
