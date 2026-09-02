import { Router } from 'express'
import { studentController } from '../controllers/studentController.js'
import { parseStudentPayload, uploadStudentPhoto } from '../middleware/studentPhoto.js'
import { managerOrAdminOnly, requireAuth } from '../middleware/auth.js'

export const studentRouter = Router()
studentRouter.get('/', studentController.list)
studentRouter.get('/check-blacklist', studentController.checkBlacklist)
studentRouter.get('/history', studentController.history)
studentRouter.get('/:id', studentController.getById)
studentRouter.post('/', requireAuth, uploadStudentPhoto, parseStudentPayload, studentController.create)
studentRouter.post('/:id/deposit-return', requireAuth, managerOrAdminOnly, studentController.returnDeposit)
studentRouter.put('/:id', requireAuth, managerOrAdminOnly, uploadStudentPhoto, parseStudentPayload, studentController.update)
studentRouter.delete('/:id', requireAuth, managerOrAdminOnly, studentController.remove)
