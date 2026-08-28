import { Employee } from '../models/Employee.js'
import { hashPassword } from './bcrypt.js'

function getInitialOwnerConfig() {
  return {
    firstname: process.env.INITIAL_OWNER_FIRSTNAME?.trim() || 'test',
    lastname: process.env.INITIAL_OWNER_LASTNAME?.trim() || 'test',
    login: (process.env.INITIAL_OWNER_LOGIN?.trim().toLowerCase() || 'admin'),
    password: process.env.INITIAL_OWNER_PASSWORD || 'admin123',
  }
}

export async function bootstrapInitialOwner() {
  const employeeCount = await Employee.countDocuments()
  if (employeeCount > 0) return { created: false, reason: 'employees-exist' }

  const config = getInitialOwnerConfig()

  const passwordHash = await hashPassword(config.password)
  const payload = {
    firstname: config.firstname,
    lastname: config.lastname,
    position: 'Owner',
    salary: Number(process.env.INITIAL_OWNER_SALARY || 0),
    payrollOpeningBalance: Number(process.env.INITIAL_OWNER_OPENING_BALANCE || 0),
    isActive: true,
    canLogin: true,
    role: 'owner',
    login: config.login,
    sections: [],
    assignedRooms: [],
    passwordHash,
  }

  const payrollStartMonth = process.env.INITIAL_OWNER_PAYROLL_START_MONTH?.trim()
  if (payrollStartMonth) payload.payrollStartMonth = payrollStartMonth

  const employee = await Employee.create(payload)

  return { created: true, employee }
}
