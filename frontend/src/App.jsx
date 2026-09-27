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
import { ApprovalsInbox } from './components/tickets/ApprovalsInbox.jsx'
import { AdminDashboard } from './components/admin/AdminDashboard.jsx'
import { MyAssets } from './components/assets/MyAssets.jsx'
import { AssetList } from './components/assets/AssetList.jsx'
import { CreateAsset } from './components/assets/CreateAsset.jsx'
import { AssetDetail } from './components/assets/AssetDetail.jsx'
import { VendorList } from './components/vendors/VendorList.jsx'

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
          { path: 'my-assets', element: <MyAssets /> },
        ],
      },
      {
        element: <ProtectedRoutes allowedRoles={['MANAGER', 'ADMIN']} />,
        children: [
          { path: 'approvals', element: <ApprovalsInbox /> },
        ],
      },
      {
        element: <ProtectedRoutes allowedRoles={['ASSET_MANAGER', 'ADMIN', 'TECHNICIAN']} />,
        children: [
          { path: 'assets', element: <AssetList /> },
          { path: 'assets/:assetId', element: <AssetDetail /> },
        ],
      },
      {
        element: <ProtectedRoutes allowedRoles={['ASSET_MANAGER', 'ADMIN']} />,
        children: [
          { path: 'assets/new', element: <CreateAsset /> },
          { path: 'vendors', element: <VendorList /> },
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
