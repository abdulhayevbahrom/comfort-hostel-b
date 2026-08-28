import { Router } from 'express'
import { reportController } from '../controllers/reportController.js'
import { requireAuth } from '../middleware/auth.js'

export const reportRouter = Router()
reportRouter.get('/monthly', requireAuth, reportController.getMonthly)
reportRouter.get('/yearly', requireAuth, reportController.getYearly)
