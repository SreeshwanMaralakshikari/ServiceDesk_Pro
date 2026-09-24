import { NotificationModel } from '../models/NotificationModel.js'

export const createNotification = async ({ user, type, message, link }) => {
  try {
    await NotificationModel.create({ user, type, message, link })
  } catch (err) {
    console.log('notification create failed:', err.message)
  }
}

export const notifyMany = async (userIds, payload) => {
  await Promise.all(userIds.filter(Boolean).map((user) => createNotification({ ...payload, user })))
}
