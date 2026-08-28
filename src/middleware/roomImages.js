import multer from 'multer'
import { ApiResponse } from '../utils/response.js'

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, callback) => allowedTypes.has(file.mimetype) ? callback(null, true) : callback(new Error('Faqat JPG, PNG yoki WEBP rasm yuklash mumkin')),
}).array('images', 8)

export function uploadRoomImages(req, res, next) {
  upload(req, res, (error) => {
    if (!error) return next()
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'Har bir rasm 8 MB dan oshmasligi kerak' : ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(error.code) ? 'Eng ko‘pi 8 ta rasm yuklash mumkin' : error.message
    return ApiResponse.badRequest(res, message)
  })
}

export function parseRoomPayload(req, res, next) {
  try { req.body = JSON.parse(req.body.payload || '{}'); return next() }
  catch { return ApiResponse.badRequest(res, 'Xona ma’lumotlari noto‘g‘ri formatda') }
}
