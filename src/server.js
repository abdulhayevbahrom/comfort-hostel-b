import 'dotenv/config'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { app } from './app.js'
import { connectDatabase } from './config/db.js'
import { createContractExpiryNotification, createDebtorDeadlineNotification, scheduleDailyContractSync, syncContractStatuses } from './utils/contractStatus.js'
import { normalizeStoredPhoneNumbers } from './utils/normalizePhoneNumbers.js'
import { StudentContract } from './models/StudentContract.js'
import { Room } from './models/Room.js'
import { DebtorDeadline } from './models/DebtorDeadline.js'
import { DebtorSms } from './models/DebtorSms.js'
import { bootstrapInitialOwner } from './utils/bootstrapInitialOwner.js'
import { backfillContractBedNumbers } from './utils/backfillContractBedNumbers.js'
import { backfillFaceIdCodes } from './utils/backfillFaceIdCodes.js'
import { FaceAccessEvent } from './models/FaceAccessEvent.js'
import { FaceAccessState } from './models/FaceAccessState.js'
import { Student } from './models/Student.js'
import { Employee } from './models/Employee.js'
import { EmployeeAttendance } from './models/EmployeeAttendance.js'
import { EmployeeBonus } from './models/EmployeeBonus.js'
import { EmployeePenaltyWaiver } from './models/EmployeePenaltyWaiver.js'
import { FaceDevice } from './models/FaceDevice.js'
import { FaceDeviceEvent } from './models/FaceDeviceEvent.js'
import { StudentMovement } from './models/StudentMovement.js'
import { StudentPresence } from './models/StudentPresence.js'
import { StudentStaySession } from './models/StudentStaySession.js'
import { startFaceAccessSmsWorker } from './services/studentFaceAccess.service.js'
import { backfillStudentMovements } from './utils/backfillStudentMovements.js'
import { scheduleEmployeeExitReconciliation } from './utils/employeeSchedule.js'
import { ShopTransaction } from './models/ShopTransaction.js'
import { SalaryPayment } from './models/SalaryPayment.js'

const port = Number(process.env.PORT || 5000)
const httpServer = createServer(app)
const allowedOrigins = process.env.FRONTEND_URL?.split(',') || ['http://localhost:5173']
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'DELETE'] },
})

app.set('io', io)

try {
  await connectDatabase()
  await normalizeStoredPhoneNumbers()
  const bedBackfill = await backfillContractBedNumbers()
  if (bedBackfill.updated) console.log(`${bedBackfill.updated} ta shartnomaga o‘rin raqami berildi`)
  await StudentContract.syncIndexes()
  await Room.syncIndexes()
  await DebtorDeadline.syncIndexes()
  await DebtorSms.syncIndexes()
  await Student.syncIndexes()
  await FaceAccessEvent.syncIndexes()
  await FaceAccessState.syncIndexes()
  await Employee.syncIndexes()
  await EmployeeAttendance.syncIndexes()
  await EmployeeBonus.syncIndexes()
  await SalaryPayment.syncIndexes()
  await EmployeePenaltyWaiver.syncIndexes()
  await FaceDevice.syncIndexes()
  await FaceDeviceEvent.syncIndexes()
  await StudentMovement.syncIndexes()
  await StudentPresence.syncIndexes()
  await StudentStaySession.syncIndexes()
  await ShopTransaction.syncIndexes()
  const faceIdBackfill = await backfillFaceIdCodes()
  if (faceIdBackfill.updated) console.log(`FaceID kodlari berildi: ${faceIdBackfill.studentsUpdated} talaba, ${faceIdBackfill.employeesUpdated} xodim`)
  const movementBackfill = await backfillStudentMovements()
  if (movementBackfill.updated) console.log(`Talabalar kirish-chiqish tarixi tiklandi: ${movementBackfill.updated} ta event`)
  const bootstrapResult = await bootstrapInitialOwner()
  if (bootstrapResult.created) {
    console.log(`Dastlabki owner yaratildi: ${bootstrapResult.employee.fullName} (${bootstrapResult.employee.login})`)
  }
  await syncContractStatuses()
  await createContractExpiryNotification(io)
  await createDebtorDeadlineNotification(io)
  scheduleDailyContractSync(io)
  startFaceAccessSmsWorker({ io }).catch((error) => console.error(`FaceID SMS worker ishga tushmadi: ${error.message}`))
  scheduleEmployeeExitReconciliation()
  httpServer.listen(port, () => console.log(`API va WebSocket http://localhost:${port} manzilida ishlamoqda`))
} catch (error) {
  console.error(`Server ishga tushmadi: ${error.message}`)
  process.exit(1)
}
