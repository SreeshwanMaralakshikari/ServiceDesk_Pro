import exp from 'express'
import { DepartmentModel } from '../models/DepartmentModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'

export const metaApp = exp.Router()

// public, because the register form needs it before anyone can log in, so it
// only ever lists the business departments (IT teams are not for visitors)
metaApp.get('/departments', async (req, res, next) => {
  try {
    const filter = { isActive: true, kind: 'BUSINESS' }
    const departments = await DepartmentModel.find(filter).select('name code kind')
    //send res
    res.status(200).json({ message: 'departments fetched', payload: departments })
  } catch (err) {
    next(err)
  }
})

// everything below needs a login
metaApp.get('/categories', verifyToken(), async (req, res, next) => {
  try {
    const categories = await CategoryModel.find({ isActive: true }).select('-autoAssign -skills').populate('department', 'name kind') // routing internals stay private
    //send res
    res.status(200).json({ message: 'categories fetched', payload: categories })
  } catch (err) {
    next(err)
  }
})

metaApp.get('/priorities', verifyToken(), async (req, res, next) => {
  try {
    const priorities = await SLAPolicyModel.find({ isActive: true }).sort({ level: 1 })
    //send res
    res.status(200).json({ message: 'priorities fetched', payload: priorities })
  } catch (err) {
    next(err)
  }
})
