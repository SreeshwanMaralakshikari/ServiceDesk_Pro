# Frontend API Integration Guide

[README](../README.md) · [Backend](../backend/README.md) · [Frontend](../frontend/README.md) · [Routes](Route_Structure_Document.md) · [Database](Database_Schema_Document.md) · **Frontend ↔ API** · [Demo script](Demo_Script.md)

> The two tables are generated from the code by `backend/scripts/generateDocs.js` (run `npm run docs` in `backend/`): every API path written in `frontend/src` is matched to the Express route that serves it. The script fails if the frontend names a path the backend does not have.

## How the frontend talks to the backend

- **One axios instance** (`src/axiosInstance.js`): `baseURL: '/api'`, `withCredentials: true` (sends the auth cookie), 20-second timeout. A GET that times out, cannot connect, or gets 502/503/504 is retried once after 1.5 s; POST/PATCH/PUT/DELETE are never retried, so nothing is done twice.
- **Waking banner.** Any request pending for more than 4 s shows "Waking the server up…" (`WakingBanner.jsx` + `store/networkStore.js`), because Render's free tier sleeps.
- **Reads** go through `useFetch(url, params)` (`src/hooks/useFetch.js`): it returns `{ data, loading, error, reload }`, sets `data` to the response's `payload`, and aborts the request when the page unmounts or the parameters change, so a slow old answer never overwrites a new one. Passing `null` as the URL skips the call (used for admin-only extras).
- **Lists** render with `DataTable` and ask for `{ page, limit: 15 }` (the audit log uses 20). The backend answers `{ items, total, page, totalPages }`.
- **Writes** call `axiosInstance.post/patch/put/delete` directly in the page and show a toast.
- **Errors** are shown with `getErrorMessage(err, fallback)` (`src/utils/errors.js`), which prefers the global handler's `error` field over its generic `message`, and explains timeouts and lost connections in plain words.
- **Status changes** send the `version` the page last loaded. On **409** (someone else changed the record first) the ticket, asset and article pages reload the record and say so.
- **Sign-in.** `RootLayout` checks the session once on load (`GET /auth/check-auth`), and `ProtectedRoutes` guards each page; the [frontend README](../frontend/README.md#sign-in-and-role-checks) explains both. The page-level role lists only decide what the app shows; the backend checks every request again.
- **CSV downloads** (`components/reports/downloadCsv.js`) fetch the file as a blob with the same cookie and save it in the browser.

## Route → where the frontend calls it

76 routes, 74 called by the frontend. The 2 marked "not called" are API-only today: they answer (see the requests in `backend/http/`), but no page uses them yet.

| Method | Route | Called from (`frontend/src/`) |
|---|---|---|
| POST | `/auth/users` | `components/Register.jsx` |
| POST | `/auth/login` | `store/authStore.js` |
| POST | `/auth/logout` | `store/authStore.js` |
| GET | `/auth/check-auth` | `store/authStore.js` |
| PUT | `/auth/password` | `components/account/ChangePassword.jsx` |
| GET | `/meta-api/departments` | `components/Register.jsx` |
| GET | `/meta-api/categories` | `components/kb/ArticleForm.jsx`, `components/kb/KnowledgeBase.jsx`, `components/tickets/CreateTicket.jsx` |
| GET | `/meta-api/priorities` | `components/reports/ReportsPage.jsx`, `components/tickets/CreateTicket.jsx`, `components/tickets/TicketDetail.jsx` |
| GET | `/ticket-api/team-technicians` | `components/tickets/TicketDetail.jsx` |
| POST | `/ticket-api/tickets` | `components/tickets/CreateTicket.jsx` |
| GET | `/ticket-api/tickets` | `components/home/Welcome.jsx`, `components/tickets/ApprovalsInbox.jsx`, `components/tickets/TicketList.jsx` |
| GET | `/ticket-api/tickets/:ticketId` | `components/tickets/TicketDetail.jsx` |
| GET | `/ticket-api/tickets/:ticketId/suggested-technicians` | `components/tickets/TicketDetail.jsx` |
| GET | `/ticket-api/tickets/:ticketId/similar` | `components/tickets/SimilarPanel.jsx` |
| GET | `/ticket-api/tickets/:ticketId/timeline` | `components/tickets/TimelinePanel.jsx` |
| PATCH | `/ticket-api/tickets/:ticketId/priority` | `components/tickets/TicketDetail.jsx` |
| PATCH | `/ticket-api/tickets/:ticketId/related-asset` | `components/tickets/RelatedAssetPanel.jsx` |
| PATCH | `/ticket-api/tickets/:ticketId/:action` | `components/tickets/TicketDetail.jsx` |
| POST | `/ticket-api/tickets/:ticketId/comments` | `components/tickets/TicketDetail.jsx` |
| POST | `/ticket-api/tickets/:ticketId/csat` | `components/tickets/CsatPanel.jsx` |
| GET | `/admin-api/users` | `components/admin/DepartmentsPage.jsx`, `components/admin/UsersPage.jsx` |
| POST | `/admin-api/users` | `components/admin/UsersPage.jsx` |
| PATCH | `/admin-api/users/:userId` | `components/admin/UsersPage.jsx` |
| PATCH | `/admin-api/users/:userId/status` | `components/admin/UsersPage.jsx` |
| GET | `/admin-api/audit-logs` | `components/admin/AuditPage.jsx`, `components/tickets/AuditPanel.jsx` |
| GET | `/admin-api/departments` | `components/admin/CategoriesPage.jsx`, `components/admin/DepartmentsPage.jsx`, `components/admin/UsersPage.jsx`, `components/reports/ManagerDashboard.jsx`, `components/reports/ReportsPage.jsx` |
| POST | `/admin-api/departments` | `components/admin/DepartmentsPage.jsx` |
| PATCH | `/admin-api/departments/:departmentId` | `components/admin/DepartmentsPage.jsx` |
| GET | `/admin-api/categories` | `components/admin/CategoriesPage.jsx` |
| POST | `/admin-api/categories` | `components/admin/CategoriesPage.jsx` |
| PATCH | `/admin-api/categories/:categoryId` | `components/admin/CategoriesPage.jsx` |
| GET | `/admin-api/sla-policies` | `components/admin/CategoriesPage.jsx`, `components/admin/SlaPage.jsx` |
| POST | `/admin-api/sla-policies` | `components/admin/SlaPage.jsx` |
| PATCH | `/admin-api/sla-policies/:policyId` | `components/admin/SlaPage.jsx` |
| GET | `/admin-api/org-settings` | `components/admin/SettingsPage.jsx` |
| PUT | `/admin-api/org-settings` | `components/admin/SettingsPage.jsx` |
| GET | `/admin-api/dashboard` | `components/admin/AdminDashboard.jsx` |
| GET | `/notification-api/my-notifications` | `components/notifications/NotificationBell.jsx`, `components/notifications/NotificationsPage.jsx` |
| GET | `/notification-api/unread-count` | `components/home/Welcome.jsx`, `components/notifications/NotificationBell.jsx` |
| PUT | `/notification-api/mark-read/:id` | `components/notifications/NotificationBell.jsx`, `components/notifications/NotificationsPage.jsx` |
| PUT | `/notification-api/mark-all-read` | `components/notifications/NotificationBell.jsx`, `components/notifications/NotificationsPage.jsx` |
| GET | `/asset-api/assignable-users` | `components/assets/AssetDetail.jsx` |
| GET | `/asset-api/my-assets` | `components/assets/MyAssets.jsx`, `components/tickets/RelatedAssetPanel.jsx` |
| GET | `/asset-api/assets` | `components/assets/AssetDetail.jsx`, `components/assets/AssetList.jsx` |
| GET | `/asset-api/stats` | `components/assets/AssetStats.jsx`, `components/home/Welcome.jsx` |
| GET | `/asset-api/assets/warranty-expiring` | `components/assets/AssetList.jsx` |
| POST | `/asset-api/assets` | `components/assets/CreateAsset.jsx` |
| GET | `/asset-api/assets/:assetId` | `components/assets/AssetDetail.jsx` |
| PATCH | `/asset-api/assets/:assetId` | `components/assets/AssetDetail.jsx` |
| POST | `/asset-api/assets/:assetId/maintenance` | `components/assets/AssetDetail.jsx` |
| GET | `/asset-api/assets/:assetId/history` | (not called by the frontend) |
| GET | `/asset-api/assets/:assetId/tickets` | (not called by the frontend) |
| PATCH | `/asset-api/assets/:assetId/replace` | `components/assets/AssetDetail.jsx` |
| PATCH | `/asset-api/assets/:assetId/:action` | `components/assets/AssetDetail.jsx` |
| GET | `/vendor-api/vendors` | `components/assets/AssetDetail.jsx`, `components/assets/CreateAsset.jsx`, `components/vendors/VendorList.jsx` |
| POST | `/vendor-api/vendors` | `components/vendors/VendorList.jsx` |
| PATCH | `/vendor-api/vendors/:vendorId` | `components/vendors/VendorList.jsx` |
| GET | `/kb-api/articles` | `components/kb/KnowledgeBase.jsx` |
| GET | `/kb-api/articles/mine` | `components/kb/KnowledgeBase.jsx` |
| POST | `/kb-api/articles` | `components/kb/ArticleForm.jsx` |
| GET | `/kb-api/articles/:articleId` | `components/kb/ArticleDetail.jsx`, `components/kb/ArticleForm.jsx` |
| PATCH | `/kb-api/articles/:articleId` | `components/kb/ArticleForm.jsx` |
| GET | `/kb-api/articles/:articleId/history` | `components/kb/ArticleDetail.jsx` |
| PATCH | `/kb-api/articles/:articleId/:action` | `components/kb/ArticleDetail.jsx` |
| PUT | `/kb-api/articles/:articleId/helpful` | `components/kb/ArticleDetail.jsx` |
| DELETE | `/kb-api/articles/:articleId` | `components/kb/ArticleDetail.jsx` |
| POST | `/ai-api/classify-ticket` | `components/tickets/CreateTicket.jsx` |
| GET | `/ai-api/kb-suggestions/:ticketId` | `components/tickets/TicketDetail.jsx` |
| POST | `/worklog-api/:ticketId` | `components/tickets/WorkLogPanel.jsx` |
| GET | `/worklog-api/:ticketId` | `components/tickets/WorkLogPanel.jsx` |
| GET | `/tech-api/queue` | `components/home/Welcome.jsx`, `components/tech/MyQueue.jsx` |
| GET | `/tech-api/dashboard` | `components/tech/TechDashboard.jsx` |
| GET | `/manager-api/dashboard` | `components/reports/ManagerDashboard.jsx` |
| GET | `/report-api/tickets` | `components/reports/ReportsPage.jsx` |
| GET | `/report-api/tickets.csv` | `components/reports/ReportsPage.jsx` |
| GET | `/report-api/assets.csv` | `components/assets/AssetStats.jsx` |

## Page → routes it calls

| File (`frontend/src/`) | Calls |
|---|---|
| `components/account/ChangePassword.jsx` | `PUT /auth/password` |
| `components/admin/AdminDashboard.jsx` | `GET /admin-api/dashboard` |
| `components/admin/AuditPage.jsx` | `GET /admin-api/audit-logs` |
| `components/admin/CategoriesPage.jsx` | `POST /admin-api/categories`<br>`PATCH /admin-api/categories/:categoryId`<br>`GET /admin-api/categories`<br>`GET /admin-api/departments`<br>`GET /admin-api/sla-policies` |
| `components/admin/DepartmentsPage.jsx` | `GET /admin-api/users`<br>`POST /admin-api/departments`<br>`PATCH /admin-api/departments/:departmentId`<br>`GET /admin-api/departments` |
| `components/admin/SettingsPage.jsx` | `GET /admin-api/org-settings`<br>`PUT /admin-api/org-settings` |
| `components/admin/SlaPage.jsx` | `POST /admin-api/sla-policies`<br>`PATCH /admin-api/sla-policies/:policyId`<br>`GET /admin-api/sla-policies` |
| `components/admin/UsersPage.jsx` | `POST /admin-api/users`<br>`PATCH /admin-api/users/:userId`<br>`GET /admin-api/users`<br>`GET /admin-api/departments`<br>`PATCH /admin-api/users/:userId/status` |
| `components/assets/AssetDetail.jsx` | `GET /vendor-api/vendors`<br>`PATCH /asset-api/assets/:assetId`<br>`GET /asset-api/assets/:assetId`<br>`GET /asset-api/assignable-users`<br>`GET /asset-api/assets`<br>`PATCH /asset-api/assets/:assetId/:action`<br>`PATCH /asset-api/assets/:assetId/replace`<br>`POST /asset-api/assets/:assetId/maintenance` |
| `components/assets/AssetList.jsx` | `GET /asset-api/assets/warranty-expiring`<br>`GET /asset-api/assets` |
| `components/assets/AssetStats.jsx` | `GET /asset-api/stats`<br>`GET /report-api/assets.csv` |
| `components/assets/CreateAsset.jsx` | `GET /vendor-api/vendors`<br>`POST /asset-api/assets` |
| `components/assets/MyAssets.jsx` | `GET /asset-api/my-assets` |
| `components/home/Welcome.jsx` | `GET /ticket-api/tickets`<br>`GET /tech-api/queue`<br>`GET /asset-api/stats`<br>`GET /notification-api/unread-count` |
| `components/kb/ArticleDetail.jsx` | `GET /kb-api/articles/:articleId`<br>`GET /kb-api/articles/:articleId/history`<br>`PATCH /kb-api/articles/:articleId/:action`<br>`PUT /kb-api/articles/:articleId/helpful`<br>`DELETE /kb-api/articles/:articleId` |
| `components/kb/ArticleForm.jsx` | `GET /meta-api/categories`<br>`GET /kb-api/articles/:articleId`<br>`PATCH /kb-api/articles/:articleId`<br>`POST /kb-api/articles` |
| `components/kb/KnowledgeBase.jsx` | `GET /meta-api/categories`<br>`GET /kb-api/articles/mine`<br>`GET /kb-api/articles` |
| `components/notifications/NotificationBell.jsx` | `GET /notification-api/unread-count`<br>`GET /notification-api/my-notifications`<br>`PUT /notification-api/mark-read/:id`<br>`PUT /notification-api/mark-all-read` |
| `components/notifications/NotificationsPage.jsx` | `GET /notification-api/my-notifications`<br>`PUT /notification-api/mark-read/:id`<br>`PUT /notification-api/mark-all-read` |
| `components/Register.jsx` | `GET /meta-api/departments`<br>`POST /auth/users` |
| `components/reports/ManagerDashboard.jsx` | `GET /admin-api/departments`<br>`GET /manager-api/dashboard` |
| `components/reports/ReportsPage.jsx` | `GET /meta-api/priorities`<br>`GET /admin-api/departments`<br>`GET /report-api/tickets`<br>`GET /report-api/tickets.csv` |
| `components/tech/MyQueue.jsx` | `GET /tech-api/queue` |
| `components/tech/TechDashboard.jsx` | `GET /tech-api/dashboard` |
| `components/tickets/ApprovalsInbox.jsx` | `GET /ticket-api/tickets` |
| `components/tickets/AuditPanel.jsx` | `GET /admin-api/audit-logs` |
| `components/tickets/CreateTicket.jsx` | `POST /ai-api/classify-ticket`<br>`GET /meta-api/categories`<br>`GET /meta-api/priorities`<br>`POST /ticket-api/tickets` |
| `components/tickets/CsatPanel.jsx` | `POST /ticket-api/tickets/:ticketId/csat` |
| `components/tickets/RelatedAssetPanel.jsx` | `GET /asset-api/my-assets`<br>`PATCH /ticket-api/tickets/:ticketId/related-asset` |
| `components/tickets/SimilarPanel.jsx` | `GET /ticket-api/tickets/:ticketId/similar` |
| `components/tickets/TicketDetail.jsx` | `GET /ticket-api/tickets/:ticketId`<br>`GET /ai-api/kb-suggestions/:ticketId`<br>`GET /meta-api/priorities`<br>`GET /ticket-api/team-technicians`<br>`GET /ticket-api/tickets/:ticketId/suggested-technicians`<br>`PATCH /ticket-api/tickets/:ticketId/priority`<br>`PATCH /ticket-api/tickets/:ticketId/:action`<br>`POST /ticket-api/tickets/:ticketId/comments` |
| `components/tickets/TicketList.jsx` | `GET /ticket-api/tickets` |
| `components/tickets/TimelinePanel.jsx` | `GET /ticket-api/tickets/:ticketId/timeline` |
| `components/tickets/WorkLogPanel.jsx` | `GET /worklog-api/:ticketId`<br>`POST /worklog-api/:ticketId` |
| `components/vendors/VendorList.jsx` | `GET /vendor-api/vendors`<br>`POST /vendor-api/vendors`<br>`PATCH /vendor-api/vendors/:vendorId` |
| `store/authStore.js` | `GET /auth/check-auth`<br>`POST /auth/login`<br>`POST /auth/logout` |
