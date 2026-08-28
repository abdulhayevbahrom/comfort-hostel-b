import mongoose from 'mongoose'
import { BuildingBlock } from '../models/BuildingBlock.js'
import { Room } from '../models/Room.js'
import { ApiResponse } from '../utils/response.js'

class BuildingBlockController {
  cleanName(body) {
    return String(body.name || '').trim()
  }

  emitChange(req, action, block) {
    req.app.get('io')?.emit('directories:changed', { resource: 'building-blocks', action, id: block?.id || block?._id?.toString() })
  }

  list = async (_req, res, next) => {
    try {
      const blocks = await BuildingBlock.aggregate([
        { $lookup: { from: 'rooms', localField: 'name', foreignField: 'block', as: 'rooms' } },
        { $addFields: { roomCount: { $size: '$rooms' }, id: { $toString: '$_id' } } },
        { $project: { _id: 0, __v: 0, rooms: 0 } },
        { $sort: { name: 1 } },
      ])
      return ApiResponse.ok(res, { blocks })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const block = await BuildingBlock.create({ name: this.cleanName(req.body) })
      this.emitChange(req, 'created', block)
      return ApiResponse.created(res, { block }, 'Bino yoki blok qo‘shildi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Bino yoki blok topilmadi')
      const block = await BuildingBlock.findById(req.params.id)
      if (!block) return ApiResponse.notFound(res, 'Bino yoki blok topilmadi')
      const oldName = block.name
      block.name = this.cleanName(req.body)
      await block.save()
      if (oldName !== block.name) await Room.updateMany({ block: oldName }, { $set: { block: block.name } })
      this.emitChange(req, 'updated', block)
      req.app.get('io')?.emit('rooms:changed', { action: 'blocks-updated', occurredAt: new Date().toISOString() })
      return ApiResponse.ok(res, { block }, 'Bino yoki blok yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Bino yoki blok topilmadi')
      const block = await BuildingBlock.findById(req.params.id)
      if (!block) return ApiResponse.notFound(res, 'Bino yoki blok topilmadi')
      if (await Room.exists({ block: block.name })) return ApiResponse.conflict(res, 'Bu blokka xonalar biriktirilgan. Avval xonalarni boshqa blokka o‘tkazing')
      await block.deleteOne()
      this.emitChange(req, 'deleted', block)
      return ApiResponse.ok(res, { blockId: block.id }, 'Bino yoki blok o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const buildingBlockController = new BuildingBlockController()
