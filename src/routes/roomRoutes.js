import { Router } from 'express'
import { roomController } from '../controllers/roomController.js'
import { parseRoomPayload, uploadRoomImages } from '../middleware/roomImages.js'
import { managerOrAdminOnly, requireAuth } from '../middleware/auth.js'

export const roomRouter = Router()
roomRouter.get('/', roomController.list)
roomRouter.get('/:id/students', roomController.students)
roomRouter.get('/:id', roomController.getById)
roomRouter.post('/', uploadRoomImages, parseRoomPayload, roomController.create)
roomRouter.put('/:id', requireAuth, managerOrAdminOnly, uploadRoomImages, parseRoomPayload, roomController.update)
roomRouter.delete('/:id', requireAuth, managerOrAdminOnly, roomController.remove)
