import { Router } from 'express'
import { universityController } from '../controllers/universityController.js'
import { managerOrAdminOnly, requireAuth } from '../middleware/auth.js'

export const universityRouter = Router()
universityRouter.get('/', universityController.list)
universityRouter.post('/', universityController.create)
universityRouter.put('/:id', requireAuth, managerOrAdminOnly, universityController.update)
universityRouter.delete('/:id', requireAuth, managerOrAdminOnly, universityController.remove)
