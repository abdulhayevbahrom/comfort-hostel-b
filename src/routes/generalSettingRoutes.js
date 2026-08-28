import { Router } from 'express'
import { generalSettingController } from '../controllers/generalSettingController.js'
import { parseSettingPayload, uploadSettingLogo } from '../middleware/settingLogo.js'
import { managerOrAdminOnly, requireAuth } from '../middleware/auth.js'

export const generalSettingRouter = Router()
generalSettingRouter.get('/', generalSettingController.get)
generalSettingRouter.put('/', requireAuth, managerOrAdminOnly, uploadSettingLogo, parseSettingPayload, generalSettingController.update)
