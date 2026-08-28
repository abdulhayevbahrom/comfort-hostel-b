import { Router } from 'express'
import { salaryController } from '../controllers/salaryController.js'
import { managerOrAdminOnly, requireAuth, strictOwnerOnly } from '../middleware/auth.js'

export const salaryRouter = Router()
salaryRouter.use(requireAuth)
salaryRouter.get('/', salaryController.summary)
salaryRouter.get('/history', salaryController.history)
salaryRouter.post('/payments', strictOwnerOnly, salaryController.pay)
salaryRouter.delete('/payments/:id', managerOrAdminOnly, salaryController.remove)
