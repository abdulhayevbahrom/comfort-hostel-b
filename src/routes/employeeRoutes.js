import { Router } from 'express'
import { employeeController } from '../controllers/employeeController.js'
import { managerOrAdminOnly, ownerOnly, requireAuth } from '../middleware/auth.js'

export const employeeRouter = Router()

employeeRouter.get('/', requireAuth, employeeController.list)
employeeRouter.get('/:id', requireAuth, employeeController.getById)
employeeRouter.post('/', requireAuth, ownerOnly, employeeController.create)
employeeRouter.put('/:id', requireAuth, managerOrAdminOnly, employeeController.update)
employeeRouter.put('/:id/rooms', requireAuth, ownerOnly, employeeController.assignRooms)
employeeRouter.delete('/:id', requireAuth, managerOrAdminOnly, employeeController.remove)
