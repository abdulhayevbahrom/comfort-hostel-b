import { Router } from 'express'
import { paymentController } from '../controllers/paymentController.js'
import { managerOrAdminOnly, requireAuth } from '../middleware/auth.js'
import { uploadPaymentReceipt } from '../middleware/paymentReceipt.js'
import { ApiResponse } from '../utils/response.js'
import { paymentReceiptFile, savePaymentReceipt } from '../utils/paymentReceiptStorage.js'

export const paymentRouter = Router()
paymentRouter.get('/', paymentController.list)
paymentRouter.get('/options', paymentController.options)
paymentRouter.get('/advance', requireAuth, paymentController.advance)
paymentRouter.get('/student/:studentId', requireAuth, paymentController.studentProfile)
paymentRouter.post('/receipt', requireAuth, uploadPaymentReceipt, async (req, res, next) => {
  try {
    const receiptImage = await savePaymentReceipt(req.file)
    return ApiResponse.created(res, { receiptImage }, 'Kvitansiya yuklandi')
  } catch (error) { return next(error) }
})
paymentRouter.get('/receipt/:filename', requireAuth, (req, res) => {
  const filePath = paymentReceiptFile(req.params.filename)
  if (!filePath) return ApiResponse.notFound(res, 'Kvitansiya topilmadi')
  res.setHeader('Cache-Control', 'private, max-age=300')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  return res.sendFile(filePath, (error) => {
    if (error && !res.headersSent) ApiResponse.notFound(res, 'Kvitansiya topilmadi')
  })
})
paymentRouter.post('/', requireAuth, paymentController.create)
paymentRouter.put('/:id', requireAuth, managerOrAdminOnly, paymentController.update)
paymentRouter.delete('/:id', requireAuth, managerOrAdminOnly, paymentController.remove)
