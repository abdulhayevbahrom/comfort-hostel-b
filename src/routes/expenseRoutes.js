import { Router } from 'express'
import { expenseController } from '../controllers/expenseController.js'
import { managerOrAdminOnly, requireAuth } from '../middleware/auth.js'

export const expenseRouter = Router()
expenseRouter.use(requireAuth)
expenseRouter.get('/', expenseController.list)
expenseRouter.post('/', expenseController.create)
expenseRouter.put('/:id', managerOrAdminOnly, expenseController.update)
expenseRouter.delete('/:id', managerOrAdminOnly, expenseController.remove)
