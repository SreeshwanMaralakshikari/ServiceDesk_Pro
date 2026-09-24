import exp from 'express'
import { DepartmentModel } from '../models/DepartmentModel.js'
import { CategoryModel } from '../models/CategoryModel.js'
import { SLAPolicyModel } from '../models/SLAPolicyModel.js'

export const metaApp = exp.Router()

// public: needed on the register form's department dropdown
metaApp.get('/departments', async (req, res, next) => {
  try {
    const filter = { isActive: true }
    if (req.query.kind) filter.kind = req.query.kind
    const departments = await DepartmentModel.find(filter).select('name code kind')
    //send res
    res.status(200).json({ message: 'departments fetched', payload: departments })
  } catch (err) {
    next(err)
  }
})

metaApp.get('/categories', async (req, res, next) => {
  try {
    const categories = await CategoryModel.find({ isActive: true }).populate('department', 'name kind')
    //send res
    res.status(200).json({ message: 'categories fetched', payload: categories })
  } catch (err) {
    next(err)
  }
})

metaApp.get('/priorities', async (req, res, next) => {
  try {
    const priorities = await SLAPolicyModel.find({ isActive: true }).sort({ level: 1 })
    //send res
    res.status(200).json({ message: 'priorities fetched', payload: priorities })
  } catch (err) {
    next(err)
  }
})
