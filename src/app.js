import cors from 'cors'
import express from 'express'
import { buildingBlockRouter } from './routes/buildingBlockRoutes.js'
import { employeeRouter } from './routes/employeeRoutes.js'
import { facultyRouter } from './routes/facultyRoutes.js'
import { generalSettingRouter } from './routes/generalSettingRoutes.js'
import { roomRouter } from './routes/roomRoutes.js'
import { studentRouter } from './routes/studentRoutes.js'
import { studentContractRouter } from './routes/studentContractRoutes.js'
import { universityRouter } from './routes/universityRoutes.js'
import { paymentRouter } from './routes/paymentRoutes.js'
import { authRouter } from './routes/authRoutes.js'
import { debtorRouter } from './routes/debtorRoutes.js'
import { attendanceRouter } from './routes/attendanceRoutes.js'
import { expenseRouter } from './routes/expenseRoutes.js'
import { fineRouter } from './routes/fineRoutes.js'
import { salaryRouter } from './routes/salaryRoutes.js'
import { dashboardRouter } from './routes/dashboardRoutes.js'
import { reportRouter } from './routes/reportRoutes.js'
import { notificationRouter } from './routes/notificationRoutes.js'
import { cashSessionRouter } from './routes/cashSessionRoutes.js'
import { faceAccessRouter, faceIdIntegrationRouter } from './routes/faceAccessRoutes.js'
import { faceDeviceRouter } from './routes/faceDeviceRoutes.js'
import { employeeAttendanceRouter } from './routes/employeeAttendanceRoutes.js'
import { ApiResponse } from './utils/response.js'

export const app = express()

app.set('trust proxy', 1)
app.use(cors({ origin: process.env.FRONTEND_URL?.split(',') || 'http://localhost:5173' }))
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => ApiResponse.ok(res, { status: 'ok' }))
app.use('/api/auth', authRouter)
app.use('/api/employees', employeeRouter)
app.use('/api/rooms', roomRouter)
app.use('/api/universities', universityRouter)
app.use('/api/faculties', facultyRouter)
app.use('/api/building-blocks', buildingBlockRouter)
app.use('/api/settings/general', generalSettingRouter)
app.use('/api/students', studentRouter)
app.use('/api/student-contracts', studentContractRouter)
app.use('/api/payments', paymentRouter)
app.use('/api/debtors', debtorRouter)
app.use('/api/attendance', attendanceRouter)
app.use('/api/expenses', expenseRouter)
app.use('/api/fines', fineRouter)
app.use('/api/salaries', salaryRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/reports', reportRouter)
app.use('/api/notifications', notificationRouter)
app.use('/api/cash-sessions', cashSessionRouter)
app.use('/api/integrations/faceid', faceIdIntegrationRouter)
app.use('/api/face-access', faceAccessRouter)
app.use('/api/faceid', faceDeviceRouter)
app.use('/api/employee-attendance', employeeAttendanceRouter)

app.use((_req, res) => ApiResponse.notFound(res, 'API manzili topilmadi'))
app.use((error, _req, res, _next) => {
  console.error(error)
  if (error?.code === 11000) {
    const message = error.keyPattern?.roomNumber
      ? 'Bu bino yoki blokning shu qavatida bunday xona raqami mavjud'
      : error.keyPattern?.isupDeviceId
        ? 'Bu ISUP Device ID avval boshqa qurilmaga biriktirilgan'
      : error.keyPattern?.login
        ? 'Bu login avval ro‘yxatdan o‘tgan'
        : error.keyPattern?.jshr
          ? 'Bu JSHR bilan talaba avval kiritilgan'
          : error.keyPattern?.passportSeries || error.keyPattern?.passportNumber
            ? 'Bu pasport ma’lumotlari avval kiritilgan'
        : 'Bu nom avval kiritilgan'
    return ApiResponse.conflict(res, message)
  }
  if (error?.name === 'ValidationError') {
    return ApiResponse.badRequest(res, Object.values(error.errors).map((item) => item.message).join(', '))
  }
  return ApiResponse.internal(res)
})
