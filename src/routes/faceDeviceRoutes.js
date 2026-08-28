import express, { Router } from 'express'
import multer from 'multer'
import { faceDeviceController } from '../controllers/faceDeviceController.js'
import { ownerOnly, requireAuth } from '../middleware/auth.js'

const textBody = express.text({ type: ['text/*', 'application/xml', 'text/xml', 'application/octet-stream'], limit: '2mb' })
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 4, fields: 30 } })

export const faceDeviceRouter = Router()
faceDeviceRouter.post('/device/event/:key', textBody, upload.any(), faceDeviceController.event)
faceDeviceRouter.post('/isup/event', textBody, upload.any(), faceDeviceController.isupEvent)
faceDeviceRouter.get('/devices', requireAuth, ownerOnly, faceDeviceController.list)
faceDeviceRouter.post('/devices', requireAuth, ownerOnly, faceDeviceController.create)
faceDeviceRouter.put('/devices/:id', requireAuth, ownerOnly, faceDeviceController.update)
faceDeviceRouter.post('/devices/:id/test-door', requireAuth, ownerOnly, faceDeviceController.testDoor)
faceDeviceRouter.get('/events', requireAuth, ownerOnly, faceDeviceController.events)
