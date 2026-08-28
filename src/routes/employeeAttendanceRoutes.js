import { Router } from 'express'
import { employeeAttendanceController } from '../controllers/employeeAttendanceController.js'
import { managerOrAdminOnly, requireAuth } from '../middleware/auth.js'

export const employeeAttendanceRouter = Router()
employeeAttendanceRouter.use(requireAuth, managerOrAdminOnly)
employeeAttendanceRouter.get('/', employeeAttendanceController.list)
employeeAttendanceRouter.get('/:employeeId/history', employeeAttendanceController.history)
