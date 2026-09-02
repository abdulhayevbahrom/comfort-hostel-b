import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDatabase } from '../config/db.js'
import { Employee } from '../models/Employee.js'
import { hashPassword } from '../utils/bcrypt.js'

if (!process.argv.includes('--confirm-reset')) {
  throw new Error('Bazani tozalash uchun --confirm-reset parametrini kiriting')
}

const accounts = [
  {
    firstname: process.env.INITIAL_OWNER_FIRSTNAME?.trim() || 'Owner',
    lastname: process.env.INITIAL_OWNER_LASTNAME?.trim() || 'Admin',
    position: 'Owner',
    role: 'owner',
    login: process.env.INITIAL_OWNER_LOGIN?.trim().toLowerCase() || 'admin',
    password: process.env.INITIAL_OWNER_PASSWORD || 'admin123',
    sections: [],
  },
  {
    firstname: 'Bosh',
    lastname: 'Kassir',
    position: 'Bosh kassir',
    role: 'head_cashier',
    login: process.env.INITIAL_HEAD_CASHIER_LOGIN?.trim().toLowerCase() || 'boshkassir',
    password: process.env.INITIAL_HEAD_CASHIER_PASSWORD || 'BoshKassir123',
    sections: ['students', 'contracts', 'payments', 'cash', 'debtors'],
  },
  {
    firstname: 'Kassir',
    lastname: 'Xodim',
    position: 'Kassir',
    role: 'cashier',
    login: process.env.INITIAL_CASHIER_LOGIN?.trim().toLowerCase() || 'kassir',
    password: process.env.INITIAL_CASHIER_PASSWORD || 'Kassir123',
    sections: ['students', 'contracts', 'payments', 'cash', 'debtors'],
  },
]

try {
  await connectDatabase()
  const databaseName = mongoose.connection.db.databaseName
  if (['admin', 'config', 'local'].includes(databaseName)) throw new Error(`Himoyalangan “${databaseName}” bazasini tozalash mumkin emas`)

  await mongoose.connection.db.dropDatabase()
  const employees = await Promise.all(accounts.map(async ({ password, ...account }) => Employee.create({
    ...account,
    passwordHash: await hashPassword(password),
    salary: 0,
    payrollOpeningBalance: 0,
    isActive: true,
    canLogin: true,
    assignedRooms: [],
    businessUnit: 'hostel',
  })))
  await Employee.syncIndexes()

  console.log(`“${databaseName}” bazasi tozalandi va ${employees.length} ta boshlang‘ich hisob yaratildi`)
  accounts.forEach((account) => console.log(`${account.position}: ${account.login}`))
} finally {
  await mongoose.disconnect()
}
