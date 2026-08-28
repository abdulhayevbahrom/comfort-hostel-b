import { Router } from 'express'
import { cashSessionController } from '../controllers/cashSessionController.js'
import { ownerOnly, requireAuth } from '../middleware/auth.js'

export const cashSessionRouter = Router()
cashSessionRouter.get('/', requireAuth, cashSessionController.list)
cashSessionRouter.post('/close', requireAuth, cashSessionController.close)
cashSessionRouter.put('/:id/approve', requireAuth, ownerOnly, cashSessionController.approve)
