import { GeneralSetting } from '../models/GeneralSetting.js'
import { ApiResponse } from '../utils/response.js'
import { uploadImages } from '../utils/imgbb.js'
import { normalizeEmployeeSchedule } from '../utils/employeeSchedule.js'

class GeneralSettingController {
  get = async (_req, res, next) => {
    try {
      const settings = await GeneralSetting.findOneAndUpdate(
        { key: 'general' },
        { $setOnInsert: { key: 'general' } },
        { new: true, upsert: true, runValidators: true },
      )
      return ApiResponse.ok(res, { settings })
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      const current = await GeneralSetting.findOne({ key: 'general' })
      if (current?.logo && req.file && !req.body.removeLogo) return ApiResponse.badRequest(res, 'Avval mavjud logoni o‘chiring, keyin yangi logo yuklang')
      const uploaded = req.file ? (await uploadImages([req.file]))[0] : null
      const logo = uploaded || (req.body.removeLogo ? null : current?.logo || null)
      const settings = await GeneralSetting.findOneAndUpdate(
        { key: 'general' },
        {
          hostelName: String(req.body.hostelName || '').trim(),
          organizationPhone: String(req.body.organizationPhone || '').replace(/\D/g, '').replace(/^998(?=\d{9}$)/, ''),
          organizationAddress: String(req.body.organizationAddress || '').trim(),
          receiptThankYou: String(req.body.receiptThankYou || '').trim(),
          employeeFaceAttendanceEnabled: req.body.employeeFaceAttendanceEnabled !== false,
          employeeWorkSchedule: normalizeEmployeeSchedule(req.body.employeeWorkSchedule || current?.employeeWorkSchedule || {}),
          logo,
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      req.app.get('io')?.emit('settings:changed', { occurredAt: new Date().toISOString() })
      return ApiResponse.ok(res, { settings }, 'Umumiy sozlamalar saqlandi')
    } catch (error) { return next(error) }
  }
}

export const generalSettingController = new GeneralSettingController()
