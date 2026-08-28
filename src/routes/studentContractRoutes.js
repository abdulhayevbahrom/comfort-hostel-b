import { Router } from 'express'
import { studentContractController } from '../controllers/studentContractController.js'
import { managerOrAdminOnly, requireAuth } from '../middleware/auth.js'

export const studentContractRouter = Router()
studentContractRouter.get('/active', studentContractController.listActive)
studentContractRouter.get('/student/:studentId', studentContractController.listByStudent)
studentContractRouter.post('/', studentContractController.create)
studentContractRouter.put('/:id', requireAuth, managerOrAdminOnly, studentContractController.update)
studentContractRouter.delete('/:id', requireAuth, managerOrAdminOnly, studentContractController.remove)
