import { Router } from 'express'
import { debtorController } from '../controllers/debtorController.js'
import { ownerOnly, requireAuth } from '../middleware/auth.js'

export const debtorRouter = Router()
debtorRouter.get('/', requireAuth, debtorController.list)
debtorRouter.put('/:studentId/deadline', requireAuth, ownerOnly, debtorController.setDeadline)
debtorRouter.post('/:studentId/sms', requireAuth, ownerOnly, debtorController.sendSms)
