import { Router } from 'express'
import { authController } from '../controllers/authController.js'
import { requireAuth } from '../middleware/auth.js'

export const authRouter = Router()
authRouter.post('/login', authController.login)
authRouter.get('/me', requireAuth, authController.me)
