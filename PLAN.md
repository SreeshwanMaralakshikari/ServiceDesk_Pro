# ServiceDesk Pro — My Build Plan (solo dev)

Reference docs: `ServiceDeskPro_Handoff_Plan.md` (full spec, authoritative on
scope/features) and the MERN Toolkit (authoritative on code style — auth
transport, response envelope, folder layout, bug checklist). This plan adapts
both into a realistic solo-developer sequence, starting from today's MVP.

## Where things stand after Day 1
Delivered: backend (auth, RBAC, Department/Category/SLAPolicy/Ticket/Notification
models, ticket lifecycle with optimistic concurrency, comments with internal-note
visibility rules, admin CRUD + dashboard, seed script) and a working frontend
(login/register, ticket list/create/detail with role-aware actions, admin stats).
Deployable to Render + Vercel as-is. Full detail in `README.md`.

## Guiding rules (kept from the handoff plan)
- Toolkit wins on *style*: ES modules, cookie JWT, `{ message, payload }`
  envelope, `{versionKey:false, timestamps:true, strict:"throw"}` on every
  model, soft delete only, destructure `req.body` (never `new Model(req.body)`),
  `try/catch` + `next(err)`, `.select("-password")` everywhere.
- The handoff plan wins on *scope*: role list, ticket lifecycle states, SLA
  design, AI features — I'm not re-deciding those, just re-sequencing the work
  to fit a one-person schedule.
- Section 6b (permission matrix) and Section 5 (data models) in the handoff
  plan are the tie-breaker whenever anything else looks ambiguous.

## Remaining phases

**Phase 2 — Approvals & full transition matrix**
Add `PENDING_APPROVAL` state, `requiresApproval` categories, Manager
approve/reject routes and inbox. Expand `ticketTransitions.js` from today's
7-action subset to the full Section 6b table (linked tickets, watchers stay
in Phase 6 as stretch). *Done when:* a Service Request created in an
approval-required category sits in `PENDING_APPROVAL` until a team Manager
approves it, and the SLA clock only starts then.

**Phase 3 — Real SLA engine**
`utils/businessHours.js` (IST business hours, +05:30 fixed offset per the
handoff plan's timezone note), `utils/evaluateSla.js`, `jobs/slaChecker.js`
(node-cron, 5 min) + lazy check on fetch, ON_HOLD pause/resume, warning/breach/
escalation notifications, SLA badge in the UI. *Done when:* a test policy with
`businessHoursOnly:false` visibly moves a ticket from on-track → at-risk →
breached, and re-running the checker never double-notifies.

**Phase 4 — Assets & Vendors**
`AssetModel`, `VendorModel`, `utils/assetTransitions.js` (procurement →
assignment → repair → replace → retire), warranty-expiring report, "My Assets"
page, link `relatedAsset` on tickets.

**Phase 5 — Knowledge Base**
`KnowledgeArticle` model, CRUD, publish/archive workflow, `$text` search,
seed 10–15 realistic articles.

**Phase 6 — AI features**
`config/groq.js` (or gemini), `POST /ai-api/classify-ticket` (category/priority/
probable-issue suggestion on the create-ticket form), `GET /ai-api/kb-suggestions/:ticketId`
(technician-facing). Graceful no-key fallback, input caps, `AiLog`. Draft-KB-
from-ticket and AI reply draft as time allows.

**Phase 7 — Dashboards, search, exports**
Manager SLA/workload/CSAT dashboards (aggregation pipelines), saved filters,
CSV export via `utils/toCsv.js` (escaped, CSV-injection-safe) reusing the same
`buildTicketQuery.js` as the list route so exports can't leak data.

**Phase 8 — DSA components (for the viva)**
Hand-rolled min-heap for auto-assignment, priority queue for the technician's
"smart queue", trie for KB/tag autocomplete, Jaccard similarity for
duplicate-ticket hints — each in `utils/`, unit-tested, complexity documented
in the README. These are isolated enough to slot in without disturbing the
rest of the app, so they're scheduled after the features that need them exist
(assignment, KB) rather than up front.

**Phase 9 — Hardening & seed richness**
Go through the toolkit's bug checklist and the handoff plan's four
error-check rounds (Sections 17–20) as a personal QA pass; expand seed data
to ~60 tickets across every status/priority/department, ~40 assets, 15 KB
articles, some breached/reopened/duplicate tickets for a realistic demo.

**Phase 10 — Documentation & submission**
README rewrite from the toolkit's Documentation Starter Template (architecture
diagram, ER diagram, route table, demo credentials, known limitations), 5–7
minute demo script per the handoff plan's Section 13 walkthrough.

## What I'm deliberately deferring past the deadline
Password reset via email, holiday calendar in business hours, PDF export,
Socket.IO real-time notifications, bulk actions, major-incident mode — all
marked `[E-Stretch]` in the handoff plan. I'll pick these up only if every
phase above is done with time to spare.

## Notes to self
- Register each new router in `server.js` *and* add its `.http` file before
  calling a phase "done" — this is toolkit Bug #1/#28/#29 territory.
- Every list/export/dashboard route must go through the same
  `buildTicketQuery.js` scope-then-filter helper — never write a second,
  slightly different scoping rule for a new route.
- Re-read Section 6b before touching `ticketTransitions.js` again; it's the
  authoritative source, not the ASCII diagram in Section 6.
