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
import { NotificationsPage } from './components/notifications/NotificationsPage.jsx'
import { ChangePassword } from './components/account/ChangePassword.jsx'
import { AdminDashboard } from './components/admin/AdminDashboard.jsx'
import { MyAssets } from './components/assets/MyAssets.jsx'
import { AssetList } from './components/assets/AssetList.jsx'
import { CreateAsset } from './components/assets/CreateAsset.jsx'
import { AssetDetail } from './components/assets/AssetDetail.jsx'
import { VendorList } from './components/vendors/VendorList.jsx'
import { KnowledgeBase } from './components/kb/KnowledgeBase.jsx'
import { ArticleDetail } from './components/kb/ArticleDetail.jsx'
import { ArticleForm } from './components/kb/ArticleForm.jsx'

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
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'account/password', element: <ChangePassword /> },
          { path: 'my-assets', element: <MyAssets /> },
          { path: 'kb', element: <KnowledgeBase /> },
          { path: 'kb/:articleId', element: <ArticleDetail /> },
        ],
      },
      {
        // authoring — react-router ranks the static `kb/new` above the dynamic
        // `kb/:articleId` regardless of block order, so this can't be swallowed
        element: <ProtectedRoutes allowedRoles={['TECHNICIAN', 'MANAGER', 'ADMIN']} />,
        children: [
          { path: 'kb/new', element: <ArticleForm /> },
          { path: 'kb/:articleId/edit', element: <ArticleForm /> },
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
