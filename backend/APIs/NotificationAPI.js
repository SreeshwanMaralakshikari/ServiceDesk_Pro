import exp from 'express'
import { isValidObjectId } from 'mongoose'
import { NotificationModel } from '../models/NotificationModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { getPagination, toPage } from '../utils/pagination.js'

export const notificationApp = exp.Router()
const ALL_ROLES = ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER']
notificationApp.use(verifyToken(...ALL_ROLES))

notificationApp.get('/my-notifications', async (req, res, next) => {
  try {
    const paging = getPagination(req.query)
    const [items, total] = await Promise.all([
      NotificationModel.find({ user: req.user.id }).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit),
      NotificationModel.countDocuments({ user: req.user.id }),
    ])
    //send res
    res.status(200).json({ message: 'notifications fetched', payload: toPage(items, total, paging) })
  } catch (err) { next(err) }
})

notificationApp.get('/unread-count', async (req, res, next) => {
  try {
    const count = await NotificationModel.countDocuments({ user: req.user.id, isRead: false })
    //send res
    res.status(200).json({ message: 'unread count fetched', payload: { count } })
  } catch (err) { next(err) }
})

notificationApp.put('/mark-read/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      //send res
      return res.status(400).json({ message: 'invalid notification id' })
    }
    await NotificationModel.updateOne({ _id: req.params.id, user: req.user.id }, { isRead: true })
    //send res
    res.status(200).json({ message: 'marked read' })
  } catch (err) { next(err) }
})

notificationApp.put('/mark-all-read', async (req, res, next) => {
  try {
    await NotificationModel.updateMany({ user: req.user.id, isRead: false }, { isRead: true })
    //send res
    res.status(200).json({ message: 'all marked read' })
  } catch (err) { next(err) }
})
