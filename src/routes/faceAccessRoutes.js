import { Router } from 'express'
import { faceAccessController } from '../controllers/faceAccessController.js'
import { verifyFaceIdIntegration } from '../middleware/faceIdIntegration.js'
import { managerOrAdminOnly, ownerOnly, requireAuth } from '../middleware/auth.js'

export const faceIdIntegrationRouter = Router()
faceIdIntegrationRouter.post('/access-check', verifyFaceIdIntegration, faceAccessController.check)

export const faceAccessRouter = Router()
faceAccessRouter.use(requireAuth, managerOrAdminOnly)
faceAccessRouter.get('/events', faceAccessController.events)
faceAccessRouter.get('/states', faceAccessController.states)
faceAccessRouter.get('/presence', faceAccessController.presence)
faceAccessRouter.get('/sessions', faceAccessController.sessions)
faceAccessRouter.post('/students/:studentId/reset', ownerOnly, faceAccessController.reset)
