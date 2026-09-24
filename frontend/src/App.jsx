import { createBrowserRouter } from 'react-router-dom'
import { RootLayout } from './components/RootLayout.jsx'
import { ProtectedRoutes } from './components/ProtectedRoutes.jsx'
import { Home } from './components/Home.jsx'
import { Login } from './components/Login.jsx'
import { Register } from './components/Register.jsx'
import { Unauthorized } from './components/Unauthorized.jsx'
import { NotFound } from './components/NotFound.jsx'
import { TicketList } from './components/tickets/TicketList.jsx'
import { CreateTicket } from './components/tickets/CreateTicket.jsx'
import { TicketDetail } from './components/tickets/TicketDetail.jsx'
import { AdminDashboard } from './components/admin/AdminDashboard.jsx'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <NotFound />,
    children: [
      { index: true, element: <Home /> },
      { path: 'login', element: <Login /> },
      { path: 'register', element: <Register /> },
      { path: 'unauthorized', element: <Unauthorized /> },
      {
        element: <ProtectedRoutes allowedRoles={['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER']} />,
        children: [
          { path: 'tickets', element: <TicketList /> },
          { path: 'tickets/new', element: <CreateTicket /> },
          { path: 'tickets/:ticketId', element: <TicketDetail /> },
        ],
      },
      {
        element: <ProtectedRoutes allowedRoles={['ADMIN']} />,
        children: [
          { path: 'admin', element: <AdminDashboard /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])
