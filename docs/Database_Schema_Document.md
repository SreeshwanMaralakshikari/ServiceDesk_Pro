# Database Schema Document

[README](../README.md) · [Backend](../backend/README.md) · [Frontend](../frontend/README.md) · [Routes](Route_Structure_Document.md) · **Database** · [Frontend ↔ API](Frontend_API_Integration_Guide.md) · [Demo script](Demo_Script.md)

> Generated from the Mongoose schemas by `backend/scripts/generateDocs.js` (run `npm run docs` in `backend/`). Do not edit by hand: change the model and regenerate.

**14 collections.** Rules that hold for all of them:

- **Strict schemas.** Every schema uses `strict: 'throw'` (an unknown field is an error, not silently dropped) and `versionKey: false`.
- **Nothing is hard-deleted.** Tickets, assets and articles have `isDeleted`; users, departments, categories, vendors and SLA policies have `isActive`.
- **Public IDs** (`TKT-2026-00012`, `AST-…`, `KB-…`) come from the `counters` collection: one atomic `$inc` per ID, keyed by prefix and year (India time), so two requests never get the same number.
- **`version`** on tickets, assets and articles is the optimistic-concurrency counter: every status change is a single `findOneAndUpdate` that matches the expected status and `version` and increments it.
- **Implicit fields.** Every collection has an `_id`, and `createdAt`/`updatedAt` where its "timestamps" line says so; the field tables below leave them out.

| Collection | What it stores |
|---|---|
| [`ailogs`](#ailogmodel-collection-ailogs-model-name-ailog) | One row per AI call: result, latency, cache hit, a short input snippet |
| [`assets`](#assetmodel-collection-assets-model-name-asset) | Hardware and software assets, with their maintenance log and lifecycle history |
| [`auditlogs`](#auditlogmodel-collection-auditlogs-model-name-auditlog) | The audit log: who changed what, and when |
| [`categories`](#categorymodel-collection-categories-model-name-category) | Ticket categories: handling team, default priority, approval, auto-assign, required skills |
| [`counters`](#countermodel-collection-counters-model-name-counter) | The sequence counters behind the public IDs |
| [`departments`](#departmentmodel-collection-departments-model-name-department) | Business departments and IT teams |
| [`knowledgearticles`](#knowledgearticlemodel-collection-knowledgearticles-model-name-knowledgearticle) | Knowledge-base articles and their edit history |
| [`notifications`](#notificationmodel-collection-notifications-model-name-notification) | In-app notifications, one per user and event |
| [`orgsettings`](#orgsettingsmodel-collection-orgsettings-model-name-orgsettings) | Organisation name and business hours |
| [`slapolicies`](#slapolicymodel-collection-slapolicies-model-name-slapolicy) | Response and resolution targets per priority |
| [`tickets`](#ticketmodel-collection-tickets-model-name-ticket) | Tickets: assignment, comments, status history, SLA clock, resolution, rating, AI suggestions |
| [`users`](#usermodel-collection-users-model-name-user) | Accounts: role, department, skills, active flag |
| [`vendors`](#vendormodel-collection-vendors-model-name-vendor) | Vendors that supply and repair assets |
| [`worklogs`](#worklogmodel-collection-worklogs-model-name-worklog) | Time a technician logged on a ticket |

## Relationships

| From | Field | To (model name) |
|---|---|---|
| ailog | `requestedBy` | user |
| ailog | `ticket` | ticket |
| asset | `vendor` | vendor |
| asset | `assignedTo` | user |
| asset | `department` | department |
| asset | `replaces` | asset |
| asset | `replacedBy` | asset |
| asset | `maintenance[].vendor` | vendor |
| asset | `lifecycleHistory[].by` | user |
| auditlog | `actor` | user |
| category | `department` | department |
| department | `manager` | user |
| knowledgearticle | `category` | category |
| knowledgearticle | `author` | user |
| knowledgearticle | `history[].by` | user |
| notification | `user` | user |
| ticket | `requester` | user |
| ticket | `requesterDepartment` | department |
| ticket | `department` | department |
| ticket | `category` | category |
| ticket | `relatedAsset` | asset |
| ticket | `assignedTo` | user |
| ticket | `assignedBy` | user |
| ticket | `approval.approvedBy` | user |
| ticket | `approval.rejectedBy` | user |
| ticket | `cancellation.cancelledBy` | user |
| ticket | `comments[].author` | user |
| ticket | `statusHistory[].by` | user |
| ticket | `sla.policy` | slapolicy |
| ticket | `resolution.resolvedBy` | user |
| ticket | `ai.aiLogId` | ailog |
| ticket | `ai.suggestedCategory` | category |
| user | `department` | department |
| worklog | `ticket` | ticket |
| worklog | `technician` | user |

## Collections

### AiLogModel (collection `ailogs`, model name `ailog`)

One row per AI call: result, latency, cache hit, a short input snippet.

Source: `backend/models/AiLogModel.js` · timestamps: createdAt, updatedAt

| Field | Type | Rules |
|---|---|---|
| `kind` | String | required; one of CLASSIFY_TICKET, KB_SUGGESTIONS, KB_RERANK |
| `status` | String | required; one of SUCCESS, FALLBACK, ERROR |
| `requestedBy` | ObjectId | required; ref `user` |
| `ticket` | ObjectId | ref `ticket` |
| `provider` | String | default "groq" |
| `model` | String |  |
| `latencyMs` | Number |  |
| `inputSnippet` | String | max length 200 |
| `inputHash` | String | max length 64 |
| `cached` | Boolean | default false |
| `output` | Mixed |  |
| `errorMessage` | String | max length 300 |

Indexes:
- `{ kind: 1, createdAt: -1 }`
- `{ kind: 1, inputHash: 1, status: 1, createdAt: -1 }`

### AssetModel (collection `assets`, model name `asset`)

Hardware and software assets, with their maintenance log and lifecycle history.

Source: `backend/models/AssetModel.js` · timestamps: createdAt, updatedAt

| Field | Type | Rules |
|---|---|---|
| `publicId` | String | unique |
| `name` | String | required |
| `type` | String | required; one of HARDWARE, SOFTWARE |
| `assetClass` | String | required |
| `serialNumber` | String |  |
| `licenseKey` | String |  |
| `vendor` | ObjectId | ref `vendor` |
| `purchaseDate` | Date |  |
| `purchaseCost` | Number |  |
| `warrantyExpiry` | Date |  |
| `warrantyNotified` | Boolean | default false |
| `status` | String | one of PROCURED, IN_STOCK, ASSIGNED, IN_REPAIR, REPLACED, RETIRED; default "PROCURED" |
| `assignedTo` | ObjectId | ref `user` |
| `department` | ObjectId | ref `department` |
| `location` | String |  |
| `replaces` | ObjectId | ref `asset` |
| `replacedBy` | ObjectId | ref `asset` |
| `maintenance` | Array of subdocuments |  |
| `maintenance[].date` | Date |  |
| `maintenance[].type` | String | required |
| `maintenance[].vendor` | ObjectId | ref `vendor` |
| `maintenance[].cost` | Number |  |
| `maintenance[].note` | String |  |
| `lifecycleHistory` | Array of subdocuments |  |
| `lifecycleHistory[].fromStatus` | String |  |
| `lifecycleHistory[].toStatus` | String | required |
| `lifecycleHistory[].by` | ObjectId | ref `user` |
| `lifecycleHistory[].note` | String |  |
| `lifecycleHistory[].at` | Date |  |
| `version` | Number | default 0 |
| `isDeleted` | Boolean | default false |

Indexes:
- `{ publicId: 1 }` unique
- `{ status: 1, department: 1 }`
- `{ assignedTo: 1 }`
- `{ warrantyExpiry: 1, warrantyNotified: 1 }`
- `{ name: 'text', assetClass: 'text', serialNumber: 'text' }`

### AuditLogModel (collection `auditlogs`, model name `auditlog`)

The audit log: who changed what, and when.

Source: `backend/models/AuditLogModel.js` · timestamps: createdAt only

| Field | Type | Rules |
|---|---|---|
| `actor` | ObjectId | ref `user` |
| `action` | String | required |
| `entityType` | String | required |
| `entityId` | ObjectId |  |
| `entityRef` | String |  |
| `before` | Mixed |  |
| `after` | Mixed |  |
| `ip` | String |  |

Indexes:
- `{ entityType: 1, entityRef: 1, createdAt: -1 }`
- `{ actor: 1, createdAt: -1 }`
- `{ createdAt: -1 }`

### CategoryModel (collection `categories`, model name `category`)

Ticket categories: handling team, default priority, approval, auto-assign, required skills.

Source: `backend/models/CategoryModel.js` · timestamps: createdAt, updatedAt

| Field | Type | Rules |
|---|---|---|
| `name` | String | required |
| `description` | String |  |
| `department` | ObjectId | required; ref `department` |
| `ticketType` | String | one of INCIDENT, SERVICE_REQUEST; default "INCIDENT" |
| `defaultPriority` | String | default "MEDIUM" |
| `requiresApproval` | Boolean | default false |
| `autoAssign` | Boolean | default false |
| `skills` | Array | default [] |
| `isActive` | Boolean | default true |

Indexes:
- only `_id`

### CounterModel (collection `counters`, model name `counter`)

The sequence counters behind the public IDs.

Source: `backend/models/CounterModel.js` · timestamps: none

| Field | Type | Rules |
|---|---|---|
| `seq` | Number | required; default 0 |

Indexes:
- only `_id`

### DepartmentModel (collection `departments`, model name `department`)

Business departments and IT teams.

Source: `backend/models/DepartmentModel.js` · timestamps: createdAt, updatedAt

| Field | Type | Rules |
|---|---|---|
| `name` | String | required; unique |
| `code` | String | required |
| `kind` | String | required; one of BUSINESS, IT_SUPPORT |
| `manager` | ObjectId | ref `user` |
| `isActive` | Boolean | default true |

Indexes:
- `{ name: 1 }` unique

### KnowledgeArticleModel (collection `knowledgearticles`, model name `knowledgearticle`)

Knowledge-base articles and their edit history.

Source: `backend/models/KnowledgeArticleModel.js` · timestamps: createdAt, updatedAt

| Field | Type | Rules |
|---|---|---|
| `publicId` | String | unique |
| `title` | String | required; max length 200 |
| `summary` | String | required; max length 500 |
| `content` | String | required; max length 50000 |
| `category` | ObjectId | required; ref `category` |
| `tags` | Array |  |
| `status` | String | one of DRAFT, PUBLISHED, ARCHIVED; default "DRAFT" |
| `author` | ObjectId | required; ref `user` |
| `reviewRequestedAt` | Date |  |
| `helpfulBy` | Array |  |
| `helpfulCount` | Number | default 0 |
| `viewCount` | Number | default 0 |
| `publishedAt` | Date |  |
| `archivedAt` | Date |  |
| `history` | Array of subdocuments |  |
| `history[].fromStatus` | String |  |
| `history[].toStatus` | String | required |
| `history[].by` | ObjectId | ref `user` |
| `history[].note` | String | max length 500 |
| `history[].at` | Date |  |
| `version` | Number | default 0 |
| `isDeleted` | Boolean | default false |

Indexes:
- `{ publicId: 1 }` unique
- `{ status: 1, category: 1 }`
- `{ author: 1 }`
- `{ status: 1, reviewRequestedAt: 1 }`
- `{ title: 'text', summary: 'text', content: 'text', tags: 'text' }`

### NotificationModel (collection `notifications`, model name `notification`)

In-app notifications, one per user and event.

Source: `backend/models/NotificationModel.js` · timestamps: createdAt, updatedAt

| Field | Type | Rules |
|---|---|---|
| `user` | ObjectId | required; ref `user` |
| `type` | String | required; one of TICKET_CREATED, TICKET_ASSIGNED, STATUS_CHANGED, COMMENT_ADDED, TICKET_REOPENED, TICKET_CLOSED, APPROVAL_REQUESTED, TICKET_APPROVED, TICKET_REJECTED, TICKET_ON_HOLD, RESOLUTION_PENDING, ASSET_ASSIGNED, DUPLICATE_LINKED, SLA_WARNING, SLA_BREACHED, ESCALATED, WARRANTY_EXPIRING, KB_REVIEW_REQUESTED, GENERAL |
| `message` | String | required |
| `link` | String |  |
| `isRead` | Boolean | default false |

Indexes:
- only `_id`

### OrgSettingsModel (collection `orgsettings`, model name `orgsettings`)

Organisation name and business hours.

Source: `backend/models/OrgSettingsModel.js` · timestamps: createdAt, updatedAt

| Field | Type | Rules |
|---|---|---|
| `orgName` | String | default "ServiceDesk Pro" |
| `businessHours.days` | Array | default [1,2,3,4,5] |
| `businessHours.start` | String | default "09:00" |
| `businessHours.end` | String | default "18:00" |
| `businessHours.timezone` | String | default "Asia/Kolkata" |

Indexes:
- only `_id`

### SLAPolicyModel (collection `slapolicies`, model name `slapolicy`)

Response and resolution targets per priority.

Source: `backend/models/SLAPolicyModel.js` · timestamps: createdAt, updatedAt

| Field | Type | Rules |
|---|---|---|
| `priority` | String | required; unique |
| `label` | String | required |
| `level` | Number | required |
| `color` | String | default "#6b7280" |
| `responseTimeHours` | Number | required |
| `resolutionTimeHours` | Number | required |
| `businessHoursOnly` | Boolean | default true |
| `isActive` | Boolean | default true |

Indexes:
- `{ priority: 1 }` unique

### TicketModel (collection `tickets`, model name `ticket`)

Tickets: assignment, comments, status history, SLA clock, resolution, rating, AI suggestions.

Source: `backend/models/TicketModel.js` · timestamps: createdAt, updatedAt

| Field | Type | Rules |
|---|---|---|
| `publicId` | String | unique |
| `title` | String | required |
| `description` | String | required |
| `type` | String | one of INCIDENT, SERVICE_REQUEST; default "INCIDENT" |
| `requester` | ObjectId | required; ref `user` |
| `requesterDepartment` | ObjectId | ref `department` |
| `department` | ObjectId | required; ref `department` |
| `category` | ObjectId | required; ref `category` |
| `priority` | String | default "MEDIUM" |
| `relatedAsset` | ObjectId | ref `asset` |
| `status` | String | one of PENDING_APPROVAL, OPEN, ASSIGNED, IN_PROGRESS, ON_HOLD, RESOLVED, CLOSED, REOPENED, REJECTED, CANCELLED; default "OPEN" |
| `assignedTo` | ObjectId | ref `user` |
| `assignedBy` | ObjectId | ref `user` |
| `assignedAt` | Date |  |
| `assignmentMethod` | String | one of MANUAL, CLAIM, AUTO |
| `approval.approvedBy` | ObjectId | ref `user` |
| `approval.approvedAt` | Date |  |
| `approval.rejectedBy` | ObjectId | ref `user` |
| `approval.rejectedAt` | Date |  |
| `approval.rejectionReason` | String |  |
| `cancellation.cancelledBy` | ObjectId | ref `user` |
| `cancellation.cancelledAt` | Date |  |
| `cancellation.reason` | String |  |
| `comments` | Array of subdocuments |  |
| `comments[].author` | ObjectId | required; ref `user` |
| `comments[].text` | String | required |
| `comments[].isInternal` | Boolean | default false |
| `comments[]._id` | ObjectId |  |
| `comments[].createdAt` | Date |  |
| `comments[].updatedAt` | Date |  |
| `statusHistory` | Array of subdocuments |  |
| `statusHistory[].from` | String |  |
| `statusHistory[].to` | String | required |
| `statusHistory[].by` | ObjectId | ref `user` |
| `statusHistory[].note` | String |  |
| `statusHistory[].at` | Date |  |
| `sla.policy` | ObjectId | ref `slapolicy` |
| `sla.startedAt` | Date |  |
| `sla.responseDueAt` | Date |  |
| `sla.resolutionDueAt` | Date |  |
| `sla.firstRespondedAt` | Date |  |
| `sla.responseBreached` | Boolean | default false |
| `sla.resolutionBreached` | Boolean | default false |
| `sla.warnAt` | Date |  |
| `sla.warningSent` | Boolean | default false |
| `sla.escalationLevel` | Number | default 0 |
| `sla.pastBreaches` | Number | default 0 |
| `sla.pausedAt` | Date |  |
| `sla.totalPausedMs` | Number | default 0 |
| `resolution.summary` | String |  |
| `resolution.resolvedBy` | ObjectId | ref `user` |
| `resolution.resolvedAt` | Date |  |
| `resolution.confirmedByRequester` | Boolean | default false |
| `resolution.confirmedAt` | Date |  |
| `closeReason` | String | one of CONFIRMED, DUPLICATE, AUTO_CLOSED |
| `closedAt` | Date |  |
| `csat.rating` | Number | min 1; max 5 |
| `csat.comment` | String | max length 500 |
| `csat.submittedAt` | Date |  |
| `ai.source` | String | one of ai, fallback |
| `ai.aiLogId` | ObjectId | ref `ailog` |
| `ai.suggestedCategory` | ObjectId | ref `category` |
| `ai.suggestedPriority` | String |  |
| `ai.probableIssue` | String | max length 300 |
| `ai.acceptedByUser` | Boolean |  |
| `ai.kbSuggestions.at` | Date |  |
| `ai.kbSuggestions.source` | String | one of ai |
| `ai.kbSuggestions.matchedBy` | String |  |
| `ai.kbSuggestions.items` | Array of subdocuments |  |
| `ai.kbSuggestions.items[].publicId` | String |  |
| `ai.kbSuggestions.items[].relevance` | Number | min 0; max 100 |
| `ai.kbSuggestions.items[].why` | String | max length 300 |
| `ai.kbSuggestions.items[].steps` | Array |  |
| `reopenCount` | Number | default 0 |
| `version` | Number | default 0 |
| `isDeleted` | Boolean | default false |

Indexes:
- `{ publicId: 1 }` unique
- `{ status: 1, department: 1, priority: 1 }`
- `{ assignedTo: 1, status: 1 }`
- `{ requester: 1 }`
- `{ status: 1, sla.resolutionDueAt: 1 }`
- `{ title: 'text', description: 'text' }`

### UserModel (collection `users`, model name `user`)

Accounts: role, department, skills, active flag.

Source: `backend/models/UserModel.js` · timestamps: createdAt, updatedAt

| Field | Type | Rules |
|---|---|---|
| `firstName` | String | required |
| `lastName` | String |  |
| `email` | String | required; unique |
| `password` | String | required |
| `role` | String | required; one of ADMIN, MANAGER, TECHNICIAN, EMPLOYEE, ASSET_MANAGER |
| `department` | ObjectId | ref `department` |
| `skills` | Array | default [] |
| `isActive` | Boolean | default true |
| `profileImageUrl` | String |  |
| `passwordChangedAt` | Date |  |

Indexes:
- `{ email: 1 }` unique

### VendorModel (collection `vendors`, model name `vendor`)

Vendors that supply and repair assets.

Source: `backend/models/VendorModel.js` · timestamps: createdAt, updatedAt

| Field | Type | Rules |
|---|---|---|
| `name` | String | required; unique |
| `contactPerson` | String |  |
| `email` | String |  |
| `phone` | String |  |
| `address` | String |  |
| `servicesProvided` | String |  |
| `isActive` | Boolean | default true |

Indexes:
- `{ name: 1 }` unique

### WorkLogModel (collection `worklogs`, model name `worklog`)

Time a technician logged on a ticket.

Source: `backend/models/WorkLogModel.js` · timestamps: createdAt only

| Field | Type | Rules |
|---|---|---|
| `ticket` | ObjectId | required; ref `ticket` |
| `technician` | ObjectId | required; ref `user` |
| `description` | String | required; max length 1000 |
| `minutesSpent` | Number | required; min 1; max 1440 |

Indexes:
- `{ ticket: 1, createdAt: -1 }`
