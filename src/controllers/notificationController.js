import mongoose from 'mongoose'
import { Notification } from '../models/Notification.js'
import { ApiResponse } from '../utils/response.js'

class NotificationController {
  list = async (req, res, next) => {
    try {
      const notifications = await Notification.find({
        readBy: { $ne: req.employee._id },
        $or: [
          { targetEmployees: req.employee._id },
          {
            $and: [
              { $or: [{ targetEmployees: { $exists: false } }, { targetEmployees: { $size: 0 } }] },
              { $or: [{ targetRoles: { $exists: false } }, { targetRoles: { $size: 0 } }, { targetRoles: req.employee.role }] },
            ],
          },
        ],
      }).sort({ createdAt: -1 }).limit(30)
      const rows = notifications.map((notification) => ({
        ...notification.toJSON(),
        isRead: notification.readBy.some((employeeId) => employeeId.toString() === req.employee.id),
      }))
      return ApiResponse.ok(res, { notifications: rows, unreadCount: rows.length })
    } catch (error) { return next(error) }
  }

  markRead = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Bildirishnoma topilmadi')
      const notification = await Notification.findByIdAndUpdate(req.params.id, { $addToSet: { readBy: req.employee._id } }, { new: true })
      if (!notification) return ApiResponse.notFound(res, 'Bildirishnoma topilmadi')
      return ApiResponse.ok(res, { notificationId: notification.id })
    } catch (error) { return next(error) }
  }
}

export const notificationController = new NotificationController()
