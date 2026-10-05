# Route Structure Document

[README](../README.md) · [Backend](../backend/README.md) · [Frontend](../frontend/README.md) · **Routes** · [Database](Database_Schema_Document.md) · [Frontend ↔ API](Frontend_API_Integration_Guide.md) · [Demo script](Demo_Script.md)

> Generated from the code by `backend/scripts/generateDocs.js` (run `npm run docs` in `backend/`). Do not edit by hand: change the code and regenerate.

**77 routes** = `GET /health` + 76 in 13 routers.

| Router | Routes | What it covers |
|---|---|---|
| [`/auth`](#auth-commonapijs-5-routes) | 5 | Register, log in and out, session check, change password |
| [`/meta-api`](#meta-api-metaapijs-3-routes) | 3 | Lookup lists for forms: departments, categories, priorities |
| [`/ticket-api`](#ticket-api-ticketapijs-12-routes) | 12 | Tickets: create, list, detail, status actions, comments, rating, timeline, suggestions |
| [`/admin-api`](#admin-api-adminapijs-17-routes) | 17 | Users, departments, categories, SLA policies, business hours, audit log, admin dashboard |
| [`/notification-api`](#notification-api-notificationapijs-4-routes) | 4 | In-app notifications |
| [`/asset-api`](#asset-api-assetapijs-13-routes) | 13 | Assets: list, detail, lifecycle actions, maintenance, replace, statistics |
| [`/vendor-api`](#vendor-api-vendorapijs-3-routes) | 3 | Vendors |
| [`/kb-api`](#kb-api-knowledgebaseapijs-9-routes) | 9 | Knowledge-base articles and their review workflow |
| [`/ai-api`](#ai-api-aiapijs-2-routes) | 2 | AI category and priority suggestion, knowledge-base suggestions |
| [`/worklog-api`](#worklog-api-worklogapijs-2-routes) | 2 | Time a technician logs on a ticket |
| [`/tech-api`](#tech-api-techapijs-2-routes) | 2 | Technician's queue and dashboard |
| [`/manager-api`](#manager-api-managerapijs-1-route) | 1 | Team dashboard |
| [`/report-api`](#report-api-reportapijs-3-routes) | 3 | Ticket report and CSV exports |

The [action tables](#actions-behind-the-action-routes) at the end list every status change for tickets, assets and articles.

## How to call the API

- **Base path.** The browser calls everything under `/api` on the frontend's own domain. Vercel (`frontend/vercel.json`) and the Vite dev proxy (`frontend/vite.config.js`) strip `/api` and forward to Express, so `/api/ticket-api/tickets` reaches the route `/ticket-api/tickets` below. The cookie is therefore first-party.
- **Auth.** `POST /auth/login` sets an HTTP-only `token` cookie (JWT). Every guarded route re-reads the user from the database, so a role, department or active-flag change, or a password change, takes effect on the next request.
- **Success shape.** `{ message, payload }`. Routes marked **Paged** return `payload: { items, total, page, totalPages }` and accept `?page=` (from 1) and `?limit=` (default 20, max 50). Other routes that return several records (lookup lists, histories, the timeline, top-5 lists) return a plain array.
- **Error shape.** A route's own refusal is `{ message }` with 400, 401, 403, 404 or 409. Errors caught by the global handler (`middlewares/errorHandler.js`) are `{ message: 'error occurred', error: '<reason>' }`.
- **IDs.** `:ticketId`, `:assetId` and `:articleId` accept the public ID (`TKT-2026-00012`, `AST-…`, `KB-…`) or the Mongo `_id`.
- **Concurrency.** Every status change (the `:action` routes) must send the `version` the client last read. A stale `version` gets **409** and the client reloads.
- **Examples.** `backend/http/` has one REST Client file per area (auth, tickets, admin, assets, vendors, KB, AI, work logs, technician, reports) with working requests and the negative cases.

"Who may call it" is the role check in `verifyToken(...)`. Most routes then narrow further inside the handler: by department (team-scoped staff), by ownership (an employee's own tickets), or by the action tables below.

## Routes

### `/auth` (CommonAPI.js, 5 routes)

Register, log in and out, session check, change password.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| POST | `/auth/users` | public |  | registerLimiter | `CommonAPI.js:23` |
| POST | `/auth/login` | public |  | loginLimiter, loginEmailLimiter | `CommonAPI.js:54` |
| POST | `/auth/logout` | public |  |  | `CommonAPI.js:97` |
| GET | `/auth/check-auth` | any signed-in user |  |  | `CommonAPI.js:103` |
| PUT | `/auth/password` | any signed-in user |  |  | `CommonAPI.js:113` |

### `/meta-api` (MetaAPI.js, 3 routes)

Lookup lists for forms: departments, categories, priorities.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| GET | `/meta-api/departments` | public |  |  | `MetaAPI.js:11` |
| GET | `/meta-api/categories` | any signed-in user |  |  | `MetaAPI.js:23` |
| GET | `/meta-api/priorities` | any signed-in user |  |  | `MetaAPI.js:33` |

### `/ticket-api` (TicketAPI.js, 12 routes)

Tickets: create, list, detail, status actions, comments, rating, timeline, suggestions.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| GET | `/ticket-api/team-technicians` | MANAGER, ADMIN |  |  | `TicketAPI.js:39` |
| POST | `/ticket-api/tickets` | EMPLOYEE, ADMIN |  |  | `TicketAPI.js:65` |
| GET | `/ticket-api/tickets` | any signed-in user | yes |  | `TicketAPI.js:170` |
| GET | `/ticket-api/tickets/:ticketId` | any signed-in user |  |  | `TicketAPI.js:201` |
| GET | `/ticket-api/tickets/:ticketId/suggested-technicians` | MANAGER, ADMIN |  |  | `TicketAPI.js:241` |
| GET | `/ticket-api/tickets/:ticketId/similar` | TECHNICIAN, MANAGER, ADMIN |  |  | `TicketAPI.js:272` |
| GET | `/ticket-api/tickets/:ticketId/timeline` | any signed-in user |  |  | `TicketAPI.js:302` |
| PATCH | `/ticket-api/tickets/:ticketId/priority` | MANAGER, ADMIN |  |  | `TicketAPI.js:345` |
| PATCH | `/ticket-api/tickets/:ticketId/related-asset` | any signed-in user |  |  | `TicketAPI.js:413` |
| PATCH | `/ticket-api/tickets/:ticketId/:action` | any signed-in user |  |  | `TicketAPI.js:471` |
| POST | `/ticket-api/tickets/:ticketId/comments` | any signed-in user |  |  | `TicketAPI.js:704` |
| POST | `/ticket-api/tickets/:ticketId/csat` | any signed-in user |  |  | `TicketAPI.js:777` |

### `/admin-api` (AdminAPI.js, 17 routes)

Users, departments, categories, SLA policies, business hours, audit log, admin dashboard.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| GET | `/admin-api/users` | ADMIN | yes |  | `AdminAPI.js:50` |
| POST | `/admin-api/users` | ADMIN |  |  | `AdminAPI.js:102` |
| PATCH | `/admin-api/users/:userId` | ADMIN |  |  | `AdminAPI.js:156` |
| PATCH | `/admin-api/users/:userId/status` | ADMIN |  |  | `AdminAPI.js:263` |
| GET | `/admin-api/audit-logs` | ADMIN | yes |  | `AdminAPI.js:317` |
| GET | `/admin-api/departments` | ADMIN | yes |  | `AdminAPI.js:339` |
| POST | `/admin-api/departments` | ADMIN |  |  | `AdminAPI.js:376` |
| PATCH | `/admin-api/departments/:departmentId` | ADMIN |  |  | `AdminAPI.js:412` |
| GET | `/admin-api/categories` | ADMIN | yes |  | `AdminAPI.js:524` |
| POST | `/admin-api/categories` | ADMIN |  |  | `AdminAPI.js:549` |
| PATCH | `/admin-api/categories/:categoryId` | ADMIN |  |  | `AdminAPI.js:612` |
| GET | `/admin-api/sla-policies` | ADMIN | yes |  | `AdminAPI.js:723` |
| POST | `/admin-api/sla-policies` | ADMIN |  |  | `AdminAPI.js:735` |
| PATCH | `/admin-api/sla-policies/:policyId` | ADMIN |  |  | `AdminAPI.js:785` |
| GET | `/admin-api/org-settings` | ADMIN |  |  | `AdminAPI.js:871` |
| PUT | `/admin-api/org-settings` | ADMIN |  |  | `AdminAPI.js:879` |
| GET | `/admin-api/dashboard` | ADMIN |  |  | `AdminAPI.js:917` |

### `/notification-api` (NotificationAPI.js, 4 routes)

In-app notifications.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| GET | `/notification-api/my-notifications` | any signed-in user | yes |  | `NotificationAPI.js:11` |
| GET | `/notification-api/unread-count` | any signed-in user |  |  | `NotificationAPI.js:23` |
| PUT | `/notification-api/mark-read/:id` | any signed-in user |  |  | `NotificationAPI.js:31` |
| PUT | `/notification-api/mark-all-read` | any signed-in user |  |  | `NotificationAPI.js:43` |

### `/asset-api` (AssetAPI.js, 13 routes)

Assets: list, detail, lifecycle actions, maintenance, replace, statistics.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| GET | `/asset-api/assignable-users` | ASSET_MANAGER, ADMIN |  |  | `AssetAPI.js:25` |
| GET | `/asset-api/my-assets` | any signed-in user |  |  | `AssetAPI.js:34` |
| GET | `/asset-api/assets` | ASSET_MANAGER, ADMIN, TECHNICIAN | yes |  | `AssetAPI.js:43` |
| GET | `/asset-api/stats` | ASSET_MANAGER, ADMIN |  |  | `AssetAPI.js:73` |
| GET | `/asset-api/assets/warranty-expiring` | ASSET_MANAGER, ADMIN, TECHNICIAN | yes |  | `AssetAPI.js:86` |
| POST | `/asset-api/assets` | ASSET_MANAGER, ADMIN |  |  | `AssetAPI.js:106` |
| GET | `/asset-api/assets/:assetId` | ASSET_MANAGER, ADMIN, TECHNICIAN |  |  | `AssetAPI.js:127` |
| PATCH | `/asset-api/assets/:assetId` | ASSET_MANAGER, ADMIN |  |  | `AssetAPI.js:146` |
| POST | `/asset-api/assets/:assetId/maintenance` | ASSET_MANAGER, ADMIN, TECHNICIAN |  |  | `AssetAPI.js:179` |
| GET | `/asset-api/assets/:assetId/history` | ASSET_MANAGER, ADMIN, TECHNICIAN |  |  | `AssetAPI.js:201` |
| GET | `/asset-api/assets/:assetId/tickets` | ASSET_MANAGER, ADMIN, TECHNICIAN |  |  | `AssetAPI.js:217` |
| PATCH | `/asset-api/assets/:assetId/replace` | ASSET_MANAGER, ADMIN |  |  | `AssetAPI.js:240` |
| PATCH | `/asset-api/assets/:assetId/:action` | ASSET_MANAGER, ADMIN, TECHNICIAN |  |  | `AssetAPI.js:323` |

### `/vendor-api` (VendorAPI.js, 3 routes)

Vendors.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| GET | `/vendor-api/vendors` | ASSET_MANAGER, ADMIN |  |  | `VendorAPI.js:10` |
| POST | `/vendor-api/vendors` | ASSET_MANAGER, ADMIN |  |  | `VendorAPI.js:18` |
| PATCH | `/vendor-api/vendors/:vendorId` | ASSET_MANAGER, ADMIN |  |  | `VendorAPI.js:33` |

### `/kb-api` (KnowledgeBaseAPI.js, 9 routes)

Knowledge-base articles and their review workflow.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| GET | `/kb-api/articles` | any signed-in user | yes |  | `KnowledgeBaseAPI.js:58` |
| GET | `/kb-api/articles/mine` | TECHNICIAN, MANAGER, ADMIN |  |  | `KnowledgeBaseAPI.js:92` |
| POST | `/kb-api/articles` | TECHNICIAN, MANAGER, ADMIN |  |  | `KnowledgeBaseAPI.js:104` |
| GET | `/kb-api/articles/:articleId` | any signed-in user |  |  | `KnowledgeBaseAPI.js:152` |
| PATCH | `/kb-api/articles/:articleId` | TECHNICIAN, MANAGER, ADMIN |  |  | `KnowledgeBaseAPI.js:177` |
| GET | `/kb-api/articles/:articleId/history` | TECHNICIAN, MANAGER, ADMIN |  |  | `KnowledgeBaseAPI.js:229` |
| PATCH | `/kb-api/articles/:articleId/:action` | TECHNICIAN, MANAGER, ADMIN |  |  | `KnowledgeBaseAPI.js:253` |
| PUT | `/kb-api/articles/:articleId/helpful` | any signed-in user |  |  | `KnowledgeBaseAPI.js:337` |
| DELETE | `/kb-api/articles/:articleId` | TECHNICIAN, MANAGER, ADMIN |  |  | `KnowledgeBaseAPI.js:366` |

### `/ai-api` (AiAPI.js, 2 routes)

AI category and priority suggestion, knowledge-base suggestions.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| POST | `/ai-api/classify-ticket` | EMPLOYEE, ADMIN |  | aiLimiter | `AiAPI.js:50` |
| GET | `/ai-api/kb-suggestions/:ticketId` | TECHNICIAN, MANAGER, ADMIN |  | aiLimiter | `AiAPI.js:184` |

### `/worklog-api` (WorkLogAPI.js, 2 routes)

Time a technician logs on a ticket.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| POST | `/worklog-api/:ticketId` | TECHNICIAN |  |  | `WorkLogAPI.js:15` |
| GET | `/worklog-api/:ticketId` | TECHNICIAN, MANAGER, ADMIN | yes |  | `WorkLogAPI.js:46` |

### `/tech-api` (TechAPI.js, 2 routes)

Technician's queue and dashboard.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| GET | `/tech-api/queue` | TECHNICIAN |  |  | `TechAPI.js:23` |
| GET | `/tech-api/dashboard` | TECHNICIAN |  |  | `TechAPI.js:58` |

### `/manager-api` (ManagerAPI.js, 1 route)

Team dashboard.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| GET | `/manager-api/dashboard` | MANAGER, ADMIN |  |  | `ManagerAPI.js:13` |

### `/report-api` (ReportAPI.js, 3 routes)

Ticket report and CSV exports.

| Method | Path | Who may call it | Paged | Rate limit | Source |
|---|---|---|---|---|---|
| GET | `/report-api/tickets` | MANAGER, ADMIN | yes |  | `ReportAPI.js:67` |
| GET | `/report-api/tickets.csv` | MANAGER, ADMIN |  |  | `ReportAPI.js:91` |
| GET | `/report-api/assets.csv` | ASSET_MANAGER, ADMIN |  |  | `ReportAPI.js:122` |

## Actions behind the `:action` routes

### Tickets: `PATCH /ticket-api/tickets/:ticketId/:action` (`utils/ticketTransitions.js`)

| Action | From | To | Roles | Notes |
|---|---|---|---|---|
| `approve` | PENDING_APPROVAL | OPEN | MANAGER, ADMIN |  |
| `reject` | PENDING_APPROVAL | REJECTED | MANAGER, ADMIN | note required |
| `cancel` | PENDING_APPROVAL, OPEN, ASSIGNED | CANCELLED | EMPLOYEE, ADMIN | note required; requester only |
| `assign` | OPEN | ASSIGNED | MANAGER, ADMIN |  |
| `claim` | OPEN | ASSIGNED | TECHNICIAN |  |
| `reassign` | ASSIGNED, IN_PROGRESS, ON_HOLD, REOPENED | (no change) | MANAGER, ADMIN |  |
| `start` | ASSIGNED, REOPENED | IN_PROGRESS | TECHNICIAN | assigned technician only |
| `hold` | IN_PROGRESS | ON_HOLD | TECHNICIAN | note required; assigned technician only |
| `resume` | ON_HOLD | IN_PROGRESS | TECHNICIAN | assigned technician only |
| `resolve` | IN_PROGRESS | RESOLVED | TECHNICIAN | assigned technician only |
| `confirm` | RESOLVED | CLOSED | EMPLOYEE | requester only |
| `reopen` | RESOLVED, CLOSED | REOPENED | EMPLOYEE | note required; requester only |

Team-scoped actions also require the caller to belong to the ticket's department (Admin is exempt). `resolve` needs a `resolutionSummary`. A CLOSED ticket can be reopened only within 7 days of closing.

### Assets: `PATCH /asset-api/assets/:assetId/:action` (`utils/assetTransitions.js`)

| Action | From | To | Roles |
|---|---|---|---|
| `activate` | PROCURED | IN_STOCK | ASSET_MANAGER, ADMIN |
| `assign` | IN_STOCK | ASSIGNED | ASSET_MANAGER, ADMIN |
| `return` | ASSIGNED | IN_STOCK | ASSET_MANAGER, ADMIN |
| `repair` | ASSIGNED, IN_STOCK | IN_REPAIR | ASSET_MANAGER, ADMIN, TECHNICIAN |
| `reinstate` | IN_REPAIR | ASSIGNED | ASSET_MANAGER, ADMIN, TECHNICIAN |
| `restock` | IN_REPAIR | IN_STOCK | ASSET_MANAGER, ADMIN, TECHNICIAN |
| `retire` | IN_STOCK, REPLACED, IN_REPAIR | RETIRED | ASSET_MANAGER, ADMIN |

`PATCH /asset-api/assets/:assetId/replace` is separate: it marks an ASSIGNED (or IN_REPAIR) unit REPLACED and assigns an IN_STOCK unit to the same person, both writes in one transaction.

### Knowledge base: `PATCH /kb-api/articles/:articleId/:action` (`utils/kbTransitions.js`)

| Action | From | To | Roles |
|---|---|---|---|
| `request-review` | DRAFT | (no change) | TECHNICIAN, MANAGER, ADMIN |
| `publish` | DRAFT | PUBLISHED | MANAGER, ADMIN |
| `archive` | DRAFT, PUBLISHED | ARCHIVED | MANAGER, ADMIN |
| `restore` | ARCHIVED | DRAFT | MANAGER, ADMIN |

A technician may use `request-review` only on their own draft. Employees only ever see PUBLISHED articles.
