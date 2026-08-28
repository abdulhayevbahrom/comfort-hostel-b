import { Room } from '../models/Room.js'
import { StudentContract } from '../models/StudentContract.js'

export async function backfillContractBedNumbers() {
  const contracts = await StudentContract.find({ bedNumber: { $exists: false } }).sort({ room: 1, status: 1, startDate: 1, createdAt: 1 }).lean()
  if (!contracts.length) return { updated: 0 }

  const rooms = await Room.find().select('capacity').lean()
  const capacities = new Map(rooms.map((room) => [room._id.toString(), room.capacity]))
  const activeContracts = await StudentContract.find({ status: 'active', bedNumber: { $exists: true } }).select('room bedNumber').lean()
  const usedBeds = new Map()
  activeContracts.forEach((contract) => {
    const roomId = contract.room.toString()
    const beds = usedBeds.get(roomId) || new Set()
    beds.add(contract.bedNumber)
    usedBeds.set(roomId, beds)
  })
  const operations = contracts.map((contract) => {
    const roomId = contract.room?.toString()
    const capacity = capacities.get(roomId) || 1
    let bedNumber = 1
    if (contract.status === 'active') {
      const beds = usedBeds.get(roomId) || new Set()
      bedNumber = Array.from({ length: capacity }, (_, index) => index + 1).find((number) => !beds.has(number))
      if (!bedNumber) throw new Error(`Xona ${roomId} uchun bo‘sh o‘rin topilmadi`)
      beds.add(bedNumber)
      usedBeds.set(roomId, beds)
    }
    return { updateOne: { filter: { _id: contract._id }, update: { $set: { bedNumber } } } }
  })
  if (operations.length) await StudentContract.bulkWrite(operations)
  return { updated: operations.length }
}
