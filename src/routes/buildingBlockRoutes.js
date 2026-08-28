import { Router } from 'express'
import { buildingBlockController } from '../controllers/buildingBlockController.js'
import { managerOrAdminOnly, requireAuth } from '../middleware/auth.js'

export const buildingBlockRouter = Router()
buildingBlockRouter.get('/', buildingBlockController.list)
buildingBlockRouter.post('/', buildingBlockController.create)
buildingBlockRouter.put('/:id', requireAuth, managerOrAdminOnly, buildingBlockController.update)
buildingBlockRouter.delete('/:id', requireAuth, managerOrAdminOnly, buildingBlockController.remove)
