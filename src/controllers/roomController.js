import mongoose from 'mongoose'
import { BuildingBlock } from '../models/BuildingBlock.js'
import { Room } from '../models/Room.js'
import { StudentContract } from '../models/StudentContract.js'
import { ApiResponse } from '../utils/response.js'
import { uploadImages } from '../utils/imgbb.js'

const occupancyPeriod = (period) => {
  const value = String(period || '')
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { start, end }
  }

  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 1),
  }
}

class RoomController {
  cleanPayload(body) {
    const bunkBedCount = Number(body.bunkBedCount)
    const hasBunkBeds = Number.isInteger(bunkBedCount) && bunkBedCount >= 1 && bunkBedCount <= 25
    const rawLayout = Array.isArray(body.bedLayout) ? body.bedLayout : []
    let nextSlotNumber = 1
    const bedLayout = rawLayout.map((item) => {
      const type = item.type
      const slotCount = type === 'bunk' ? 2 : 1
      const slotNumbers = Array.isArray(item.slotNumbers) && item.slotNumbers.length === slotCount
        ? item.slotNumbers.map(Number)
        : Array.from({ length: slotCount }, () => nextSlotNumber++)
      if (slotNumbers.length) nextSlotNumber = Math.max(nextSlotNumber, ...slotNumbers) + 1
      return { number: Number(item.number), type, slotNumbers }
    }).filter((item) => Number.isInteger(item.number) && item.number >= 1 && item.number <= 99 && ['single', 'bunk'].includes(item.type) && item.slotNumbers.every((number) => Number.isFinite(number) && number >= 1))
    const uniqueNumbers = new Set(bedLayout.map((item) => item.number))
    const slotNumbers = bedLayout.flatMap((item) => item.slotNumbers)
    if (bedLayout.length !== rawLayout.length || uniqueNumbers.size !== bedLayout.length || new Set(slotNumbers).size !== slotNumbers.length) throw new Error('Krovat va o‘rin raqamlari takrorlanmasligi kerak')
    const capacity = bedLayout.length ? bedLayout.reduce((sum, item) => sum + (item.type === 'bunk' ? 2 : 1), 0) : hasBunkBeds ? bunkBedCount * 2 : Number(body.capacity)
    return {
      roomNumber: String(body.roomNumber || '').trim(),
      block: String(body.block || '').trim(),
      floor: String(body.floor ?? '').trim(),
      bunkBedCount: bedLayout.length ? bedLayout.filter((item) => item.type === 'bunk').length : hasBunkBeds ? bunkBedCount : null,
      bedLayout,
      capacity,
      category: body.category || '',
      gender: body.gender,
      status: body.status || 'available',
      note: String(body.note || '').trim(),
      images: Array.isArray(body.images) ? body.images : [],
    }
  }

  emitChange(req, action, room) {
    req.app.get('io')?.emit('rooms:changed', { action, roomId: room?.id || room?._id?.toString(), occurredAt: new Date().toISOString() })
  }

  list = async (req, res, next) => {
    try {
      const period = occupancyPeriod(req.query.period)
      if (!period) return ApiResponse.badRequest(res, 'Oy YYYY-MM formatida bo‘lishi kerak')
      const roomDocuments = await Room.find().sort({ block: 1, roomNumber: 1 })
      roomDocuments.sort((first, second) => (
        first.block.localeCompare(second.block, undefined, { numeric: true })
        || first.floor.localeCompare(second.floor, undefined, { numeric: true })
        || first.roomNumber.localeCompare(second.roomNumber, undefined, { numeric: true })
      ))
      const occupiedContracts = await StudentContract.find({ status: 'active', startDate: { $lt: period.end }, endDate: { $gte: period.start } })
        .select('room bedNumber _id')
        .lean()
      const occupiedByRoom = new Map()
      occupiedContracts.forEach((contract) => {
        const roomId = contract.room.toString()
        const beds = occupiedByRoom.get(roomId) || []
        beds.push(contract)
        occupiedByRoom.set(roomId, beds)
      })
      const rooms = roomDocuments.map((room) => {
        const contracts = occupiedByRoom.get(room.id) || []
        const occupiedBeds = new Map(contracts.map((contract) => [contract.bedNumber, contract]))
        const savedLayout = room.bedLayout?.length ? room.bedLayout : Array.from({ length: Math.ceil(room.capacity / 2) }, (_, index) => ({ number: index + 1, type: index * 2 + 2 <= room.capacity ? 'bunk' : 'single', slotNumbers: index * 2 + 2 <= room.capacity ? [index * 2 + 1, index * 2 + 2] : [index * 2 + 1] }))
        let fallbackSlotNumber = 0
        const beds = savedLayout.flatMap((bed) => (bed.type === 'bunk' ? ['lower', 'upper'] : ['single']).map((level, index) => {
          fallbackSlotNumber += 1
          const slotNumber = bed.slotNumbers?.[index] || fallbackSlotNumber
          const contract = occupiedBeds.get(slotNumber)
          const levelLabel = level === 'lower' ? 'pastki' : level === 'upper' ? 'yuqori' : 'bir qavatli'
          return { number: slotNumber, bedNumber: bed.number, level, label: `${bed.number}-krovat · ${levelLabel} o‘rin`, status: contract ? 'occupied' : 'available', contractId: contract?._id?.toString() || null }
        }))
        return {
          ...room.toJSON(),
          occupiedCount: contracts.length,
          beds,
        }
      })
      const summary = rooms.reduce((result, room) => {
        result.totalRooms += 1
        result.totalBeds += room.capacity
        if (room.gender === 'male') result.maleRooms += 1
        if (room.gender === 'female') result.femaleRooms += 1
        if (room.gender === 'family') result.familyRooms += 1
        if (room.gender === 'guest') result.guestRooms += 1
        if (room.status === 'maintenance') result.maintenanceRooms += 1
        return result
      }, { totalRooms: 0, totalBeds: 0, maleRooms: 0, femaleRooms: 0, familyRooms: 0, guestRooms: 0, maintenanceRooms: 0 })
      return ApiResponse.ok(res, { rooms, summary })
    } catch (error) { return next(error) }
  }

  getById = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xona topilmadi')
      const room = await Room.findById(req.params.id)
      if (!room) return ApiResponse.notFound(res, 'Xona topilmadi')
      return ApiResponse.ok(res, { room })
    } catch (error) { return next(error) }
  }

  students = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xona topilmadi')
      const room = await Room.findById(req.params.id)
      if (!room) return ApiResponse.notFound(res, 'Xona topilmadi')
      const period = occupancyPeriod(req.query.period)
      if (!period) return ApiResponse.badRequest(res, 'Oy YYYY-MM formatida bo‘lishi kerak')
      const contracts = await StudentContract.find({ room: room._id, status: 'active', startDate: { $lt: period.end }, endDate: { $gte: period.start } })
        .populate({ path: 'student', select: 'fullName phone parentPhone photo university faculty course gender', populate: [{ path: 'university', select: 'name' }, { path: 'faculty', select: 'name' }] })
        .sort({ startDate: 1 })
      const students = contracts.filter((item) => item.student).map((contract) => ({ student: contract.student, contract: { id: contract.id, bedNumber: contract.bedNumber, contractNumber: contract.contractNumber, startDate: contract.startDate, endDate: contract.endDate, paymentType: contract.paymentType, paymentAmount: contract.paymentAmount } }))
      return ApiResponse.ok(res, { room, students, occupiedCount: students.length, availableCount: Math.max(0, room.capacity - students.length) })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const payload = this.cleanPayload(req.body)
      if (payload.block && !(await BuildingBlock.exists({ name: payload.block }))) return ApiResponse.badRequest(res, 'Bino yoki blokni sozlamalardan tanlang')
      if ((req.files?.length || 0) > 8) return ApiResponse.badRequest(res, 'Eng ko‘pi 8 ta rasm yuklash mumkin')
      payload.images = await uploadImages(req.files)
      const room = await Room.create(payload)
      this.emitChange(req, 'created', room)
      return ApiResponse.created(res, { room }, 'Xona qo‘shildi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xona topilmadi')
      const room = await Room.findById(req.params.id)
      if (!room) return ApiResponse.notFound(res, 'Xona topilmadi')
      const payload = this.cleanPayload(req.body)
      if (payload.block && !(await BuildingBlock.exists({ name: payload.block }))) return ApiResponse.badRequest(res, 'Bino yoki blokni sozlamalardan tanlang')
      const activeContracts = await StudentContract.find({ room: room._id, status: 'active' }).select('bedNumber').lean()
      if (payload.capacity < activeContracts.length) return ApiResponse.conflict(res, 'Xona sig‘imini aktiv shartnomalardagi o‘rinlardan kamaytirib bo‘lmaydi')
      const availableSlots = new Set(payload.bedLayout.flatMap((bed) => bed.slotNumbers))
      if (payload.bedLayout.length && activeContracts.some((contract) => !availableSlots.has(contract.bedNumber))) return ApiResponse.conflict(res, 'Aktiv shartnomadagi o‘rin raqamlarini o‘zgartirib bo‘lmaydi')
      if (payload.images.length + (req.files?.length || 0) > 8) return ApiResponse.badRequest(res, 'Eng ko‘pi 8 ta rasm saqlash mumkin')
      const uploadedImages = await uploadImages(req.files)
      room.set({ ...payload, images: [...payload.images, ...uploadedImages] })
      await room.save()
      this.emitChange(req, 'updated', room)
      return ApiResponse.ok(res, { room }, 'Xona yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Xona topilmadi')
      const room = await Room.findById(req.params.id)
      if (!room) return ApiResponse.notFound(res, 'Xona topilmadi')
      await room.deleteOne()
      this.emitChange(req, 'deleted', room)
      return ApiResponse.ok(res, { roomId: room.id }, 'Xona o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const roomController = new RoomController()
