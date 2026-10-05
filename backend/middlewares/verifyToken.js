import jwt from 'jsonwebtoken'
import { UserModel } from '../models/UserModel.js'
import { tokenIsStale } from '../utils/sessionRules.js'

const { verify } = jwt

// factory: verifyToken("ADMIN", "MANAGER") -> middleware allowing only those roles
// (call with no args to just require any authenticated, active user)
export const verifyToken = (...allowedRoles) => {
  return async (req, res, next) => {
    const token = req.cookies?.token

    if (!token) {
      //send res
      return res.status(401).json({ message: 'Please login first' })
    }
    try {
      const decoded = verify(token, process.env.JWT_SECRET)

      // always trust the DB for role/department/active state, not the token's
      // copy, so an admin's edit takes effect immediately
      const user = await UserModel.findById(decoded.id).select('role department isActive passwordChangedAt')
      if (!user || !user.isActive) {
        //send res
        return res.status(401).json({ message: 'Account not found or deactivated' })
      }
      // a password change or reset signs out every older session
      if (tokenIsStale(decoded.iat, user.passwordChangedAt)) {
        //send res
        return res.status(401).json({ message: 'Session expired, please login again' })
      }
      if (allowedRoles.length && !allowedRoles.includes(user.role)) {
        //send res
        return res.status(403).json({ message: 'You are not authorized for this action' })
      }

      req.user = { id: user._id.toString(), role: user.role, department: user.department?.toString() }
      next()
    } catch {
      //send res
      res.status(401).json({ message: 'Session expired, please login again' })
    }
  }
}
