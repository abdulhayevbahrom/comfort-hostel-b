import { Router } from 'express'
import { notificationController } from '../controllers/notificationController.js'
import { requireAuth } from '../middleware/auth.js'

export const notificationRouter = Router()
notificationRouter.use(requireAuth)
notificationRouter.get('/', notificationController.list)
notificationRouter.put('/:id/read', notificationController.markRead)
