import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/authStore.js'

export const ProtectedRoutes = ({ allowedRoles }) => {
  const { isAuthenticated, user, isChecking } = useAuthStore()

  if (isChecking) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(user?.role)) return <Navigate to="/unauthorized" replace />

  return <Outlet />
}
