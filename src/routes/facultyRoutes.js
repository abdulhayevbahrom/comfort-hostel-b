import { Router } from 'express'
import { facultyController } from '../controllers/facultyController.js'
import { managerOrAdminOnly, requireAuth } from '../middleware/auth.js'

export const facultyRouter = Router()
facultyRouter.get('/', facultyController.list)
facultyRouter.post('/', facultyController.create)
facultyRouter.put('/:id', requireAuth, managerOrAdminOnly, facultyController.update)
facultyRouter.delete('/:id', requireAuth, managerOrAdminOnly, facultyController.remove)
