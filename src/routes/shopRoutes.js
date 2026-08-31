import { Router } from 'express'
import { shopController } from '../controllers/shopController.js'
import { managerOrAdminOnly, requireAuth } from '../middleware/auth.js'

export const shopRouter = Router()
shopRouter.use(requireAuth)
shopRouter.get('/overview', shopController.overview)
shopRouter.get('/transactions', shopController.list)
shopRouter.post('/transactions', managerOrAdminOnly, shopController.create)
shopRouter.put('/transactions/:id', managerOrAdminOnly, shopController.update)
shopRouter.delete('/transactions/:id', managerOrAdminOnly, shopController.remove)
