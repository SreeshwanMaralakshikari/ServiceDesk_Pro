# ServiceDesk Pro

**Project** · [Backend](backend/README.md) · [Frontend](frontend/README.md) · [Routes](docs/Route_Structure_Document.md) · [Database](docs/Database_Schema_Document.md) · [Frontend ↔ API](docs/Frontend_API_Integration_Guide.md) · [Demo script](docs/Demo_Script.md)

IT helpdesk and asset management for one organisation, built with the MERN stack. Employees raise tickets. Technicians work them against SLA deadlines that run on business hours. Managers approve requests, assign work and watch team dashboards. An asset manager tracks hardware and licences. A knowledge base and AI triage help tickets get solved faster.

Individual capstone, AU 2028 MERN + DSA Level 2, project #5.

- **Live app:** https://service-desk-pro-one.vercel.app
- **API health:** https://service-desk-pro-one.vercel.app/api/health. The backend sleeps on Render's free tier, so the first request after a quiet spell can take up to a minute. The app shows a "Waking the server up…" banner meanwhile.

## Where to start

| You want to… | Read |
|---|---|
| See what the app does | [Roles](#roles) and [Features](#features), below |
| Run it on your computer | [Quick start](#quick-start), below, then the two app READMEs |
| Work on the API, the database or the background jobs | [Backend README](backend/README.md) |
| Work on the pages | [Frontend README](frontend/README.md) |
| Look up a route, a collection or which page calls what | The [generated documents](#documentation) in `docs/` |
| Show it to someone | The [demo script](docs/Demo_Script.md) |

## Contents

- [Roles](#roles)
- [Features](#features)
- [Tech stack](#tech-stack)
- [How the pieces fit together](#how-the-pieces-fit-together)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Tests and checks](#tests-and-checks)
- [Deployment](#deployment)
- [Data structures and algorithms](#data-structures-and-algorithms)
- [Design decisions](#design-decisions)
- [Known limitations](#known-limitations)
- [Documentation](#documentation)

## Roles

| Role | What they do |
|---|---|
| **Employee** | Raises tickets (with an AI category and priority suggestion), comments, confirms or reopens a resolved ticket, rates the support (CSAT), browses the knowledge base, sees their own assets. |
| **Technician** | Works the tickets of their IT team: claim, start, hold, resume and resolve. Writes internal notes and work logs. Has a smart queue ordered by SLA urgency and a personal dashboard. Writes knowledge-base drafts. Sends assets for repair. |
| **Manager** | Runs one IT team: approves or rejects requests, assigns and reassigns with a suggested technician, changes priority, publishes KB articles. Has a team dashboard and ticket reports with CSV export. |
| **Asset manager** | Owns assets and vendors: create, activate, assign, return, repair, replace, retire. Sees asset statistics and the warranty-expiry list, and exports assets to CSV. |
| **Admin** | Everything above across all teams, plus users, departments, categories, SLA policies, business hours and the audit log. |

Employees belong to a business department (HR, Engineering, Finance). Technicians and managers belong to an IT team (Service Desk, Infrastructure) and only ever see their own team's tickets. Admins and asset managers have no department.

## Features

### Tickets

- Public IDs like `TKT-2026-00061`, from an atomic counter, so the numbers never repeat or skip.
- Twelve actions move a ticket through ten statuses: approve, reject, cancel, assign, claim, reassign, start, hold, resume, resolve, confirm and reopen. Every change is one atomic database write guarded by the ticket's `version`. If two people act at once, one succeeds. The other gets a 409, and their page says the ticket changed and reloads it, instead of overwriting.
- Categories can require approval. A "New Hardware Request" waits in PENDING_APPROVAL, with no SLA clock running, until a manager approves it.
- Auto-assignment for categories that allow it: the least-loaded technician with matching skills gets the ticket, or the least-loaded technician on the team when nobody's skills match.
- Public comments and internal notes. Internal notes are never sent to employees, not even in the API response.
- A ticket can be linked to the asset it is about. The requester picks one of their own assets; the assigned technician, the team's manager or an admin can link any asset by its ID. Links are audited.
- The technician must write a resolution summary, and the requester sees it before confirming. A closed ticket can be reopened within 7 days.
- One timeline that merges status changes, comments and work logs. A "similar tickets" panel helps staff spot repeats.
- In-app notifications for assignment, approval, rejection, resolution, reopening, SLA warnings, breaches and escalations, and warranty expiry.

### SLA engine

- One policy per priority: Low, Medium, High and Critical, plus a **Test** priority that breaches within minutes, for demos. Only an admin can raise a ticket with it.
- Due dates are counted in business hours (default Mon–Fri 09:00–18:00 India time; an admin can change this). ON_HOLD pauses the clock.
- A warning at 75% of the window. A breach escalates to the team manager, and a resolution breach also reaches the admins. A cron job checks every 5 minutes, and each ticket is also checked when it is opened, so a sleeping server never misses a breach.

### Assets and vendors

- Lifecycle: procured → in stock → assigned → in repair → reinstated or restocked → retired. A `replace` action swaps a broken unit for a new one in a single transaction.
- Asset managers and admins can edit an asset's details (name, class, serial or licence key, vendor, purchase date and cost, warranty, location). Status and assignee change only through the lifecycle actions.
- Maintenance log, lifecycle history, warranty-expiry list, and a daily warranty check that notifies asset managers and admins once per asset when it is within 30 days of expiry.
- Asset statistics page and CSV export. "My Assets" for everyone.

### Knowledge base

- Technicians write drafts and request a review. Only managers and admins publish, archive and restore. Employees only ever see published articles.
- Full-text search, category filter, tags, view counts and a "helpful" vote.

### AI (Groq, with an offline fallback)

- *Suggest category and priority* on the create-ticket form. With no `GROQ_API_KEY`, or when the model answers badly, an offline heuristic answers instead, so the button always works. It matches the text against category names and their skill tags (a name counts double), so "my laptop screen flickers" finds Hardware through its `laptop` tag. When nothing matches, it leaves the choice to the user rather than guess. The priority comes from urgent words. Identical questions within 24 hours reuse the earlier answer.
- *Suggested knowledge-base articles* on a ticket, for staff. Text search picks candidates from published articles, then the AI re-ranks them with a relevance score, a reason and steps. It can only choose from the articles it was shown. The answer is saved on the ticket.
- Every AI call is logged (result, latency, a short input snippet, never the full ticket), and AI routes are rate-limited per user.

### Dashboards and reports

- Technician and team dashboards over the last 7, 30 or 90 days, or all time: SLA compliance, response and resolution times, live breached/at-risk/unassigned counts, created vs resolved, backlog by priority, CSAT, top categories and technician workload. Admins can switch between teams.
- Ticket report with filters (status, priority, team, dates) and CSV export, written to the audit log.

### Administration

- Users (role and department must match; technicians carry skill tags), departments, categories (handling team, default priority, approval, auto-assign, required skills), SLA policies and business hours.
- A change that would strand open tickets is refused. Every admin write is recorded in the audit log.

### Security

- JWT in an HTTP-only cookie. Every request re-reads the user's role, department and active flag from the database. Changing or resetting a password signs out every older session.
- New passwords must be 12–72 characters (bcrypt); existing accounts keep theirs until they change it. Rate limits on failed logins (per address and per account), registration and AI.
- helmet, CORS restricted to the frontend, a 1 MB body limit, and a sanitizer that drops `$`-prefixed and dotted keys from request bodies.
- Self-registration always creates an Employee. Staff accounts are made by an admin.

## Tech stack

| Layer | Choice | Details |
|---|---|---|
| Frontend | React 19, Vite 6, Tailwind CSS 4, React Router 7, Zustand 5, axios, React Hook Form, react-hot-toast | [Frontend README](frontend/README.md) |
| Backend | Node.js (ES modules), Express 5, Mongoose 9, node-cron 3, bcryptjs, jsonwebtoken, helmet, express-rate-limit | [Backend README](backend/README.md) |
| Database | MongoDB Atlas (a replica set, so transactions work) | [Database document](docs/Database_Schema_Document.md) |
| AI | Groq's OpenAI-compatible chat endpoint through `fetch` (no SDK), model from `AI_MODEL` | [Backend README](backend/README.md#environment-variables) |
| Tests | `node:test`, supertest, mongodb-memory-server, and a project QA suite in `qa/` | [Tests and checks](#tests-and-checks) |
| Hosting | Vercel (frontend), Render (backend), MongoDB Atlas | [Deployment](#deployment) |

The backend needs Node.js 20.19 or newer (Mongoose 9 requires it); use the same version for the frontend.

## How the pieces fit together

```
  Browser
     │   every request goes to one address: service-desk-pro-one.vercel.app
     ▼
  Vercel ───────── serves the React app                       (frontend/)
     │   /api/* is forwarded to Render, without the /api prefix
     ▼
  Render ───────── runs the Express API and the cron jobs     (backend/)
     │
     ▼
  MongoDB Atlas ── stores everything
```

- The browser only ever talks to the Vercel address. Pages come from Vercel, and every `/api/...` call is forwarded to Render with the `/api` prefix removed.
- Because of that, the sign-in cookie is first-party (`sameSite: "lax"`, `secure`), and it works in every browser, including private windows.
- On your computer the same thing happens through Vite's proxy: the app on port 5173 forwards `/api/...` to the backend on port 5000.

## Repository layout

| Folder | What is in it |
|---|---|
| [`backend/`](backend/README.md) | The Express API, the Mongoose models, the background jobs, the tests and the `.http` request files |
| [`frontend/`](frontend/README.md) | The React app and its Vercel configuration |
| [`docs/`](#documentation) | Route, database and frontend-integration documents (generated from the code) and the demo script |
| `qa/` | Project-wide static checks, run by `qa/run-all.mjs` |
| `Day_Wise_Progress_*.md`, `PLAN.md` | The build log and the original plan, kept as history |

Each app's README has its own detailed folder tree.

## Quick start

You need Node.js 20.19+ and a MongoDB database (a local MongoDB Community server, or an Atlas connection string).

```bash
# terminal 1: the backend
cd backend
cp .env.example .env     # then set MONGO_URI, JWT_SECRET and CLIENT_URL
npm install
npm run seed             # demo data and demo accounts
npm run dev              # http://localhost:5000

# terminal 2: the frontend
cd frontend
npm install
npm run dev              # http://localhost:5173
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Open http://localhost:5173 and log in as `admin@sdp.test` with the password `Passw0rd!`. Every demo account, and how to change their password, is in the [backend README](backend/README.md#seed-data-and-demo-accounts). The frontend needs no `.env`.

Something not working? Each app README ends with a troubleshooting table: [backend](backend/README.md#troubleshooting), [frontend](frontend/README.md#troubleshooting).

## Tests and checks

| Check | Where to run it | Command |
|---|---|---|
| Backend unit tests (230) | `backend/` | `npm run test:unit` |
| Backend integration tests (140, real MongoDB) | `backend/` | `npm run test:integration` |
| Frontend production build | `frontend/` | `npm run build` |
| **Both backend test sets, plus static checks across both apps** | project root | `node qa/run-all.mjs` |
| The same, without the real-database tests | project root | `SKIP_INTEGRATION=1 node qa/run-all.mjs` (PowerShell: `$env:SKIP_INTEGRATION="1"; node qa/run-all.mjs`) |
| Generated documents are up to date | `backend/` | `node scripts/generateDocs.js --check` (also part of `run-all`) |

`qa/run-all.mjs` does not run the frontend build, so run `npm run build` in `frontend/` as well. It exits non-zero on any failure. Besides the tests, it:

- checks backend syntax and scans for undefined identifiers;
- checks frontend imports and exports;
- matches every frontend API call to a backend route, and catches route shadowing;
- checks frontend links against the router;
- checks that every Mongoose `ref` names a real model, and the populate paths in the knowledge-base API;
- checks that every dependency is declared, locked and installed;
- runs the seed scenarios;
- checks that the three READMEs exist and every relative link and anchor in them and in `docs/` resolves;
- confirms the generated documents in `docs/` match the code.

Details of each test set are in the app READMEs: [backend tests](backend/README.md#tests), [frontend checks](frontend/README.md#checks-before-you-push).

## Deployment

| Piece | Where | How |
|---|---|---|
| Backend | Render web service, root `backend` | [Backend README › Deployment](backend/README.md#deployment-render) |
| Frontend | Vercel, root `frontend` | [Frontend README › Deployment](frontend/README.md#deployment-vercel) |
| Database | MongoDB Atlas | [Backend README › Deployment](backend/README.md#deployment-render) (Network Access) |

Every time you ship a change:

1. Push the backend and frontend changes together, so the live frontend never calls a route that no longer exists.
2. When both deploys finish, open [`/api/health`](https://service-desk-pro-one.vercel.app/api/health). It should answer `db: "up"`, both cron jobs `"running"`, and the new commit as `version`.

## Data structures and algorithms

All hand-written in `backend/utils/dsa/`, with no library. Unit tests are in `backend/test/dsa.unit.test.js` and integration tests in `backend/test/integration/dsa.test.js`.

| Feature | Structure / algorithm | Cost | Where |
|---|---|---|---|
| `MinHeap` | Array-backed binary heap, bottom-up heapify, `push`/`pop`/`drain(k)` | Build O(n), push/pop O(log n), peek O(1) | `MinHeap.js` |
| Top-k | Size-k heap that replaces the current worst | O(n log k) | `topK` in `MinHeap.js` |
| Auto-assign and suggested technician | Heap ordered by open load, then matched skills, then least recently assigned. Skilled technicians first, everyone when nobody matches | O(t) build + O(k log t) | `techHeap.js`, `utils/autoAssign.js` |
| Technician queue | Heap ordered by SLA urgency (breached, at risk, on track, no clock, on hold), then soonest due date, higher priority, older ticket | O(n) build + O(k log n), n ≤ 300 | `smartQueue.js`, `APIs/TechAPI.js` |
| Similar tickets | Stop-word-filtered, lightly stemmed word sets compared by Jaccard similarity; best 5 via `topK` | O(n·w) over ≤ 300 recent team tickets | `similarity.js` |
| Ticket timeline | k-way merge (heap of list heads) of status history, comments and work logs | O(n log k), k = 3 | `timeline.js` |

Auto-assign uses the same atomic `OPEN → ASSIGNED` write as a manual assign. A person who grabs the ticket first simply wins, and nothing is overwritten.

## Design decisions

The choices that shape the code, and why. How each one is built is in the backend README's [conventions](backend/README.md#conventions-every-route-follows).

- **One address for the browser.** Chosen over calling Render directly so the sign-in cookie stays first-party and needs no third-party-cookie workarounds ([how it works](#how-the-pieces-fit-together)).
- **The database decides who you are.** Every request reloads the user's role, department and active flag, so an admin's change applies on the very next request.
- **One table per workflow, one atomic write per change.** Tickets, assets and articles each have a table of who may do what from which status, and every change is a single guarded write, so two people acting at once can never overwrite each other.
- **Scoping in one place.** One query builder per list decides what the caller may see, so a forgotten check cannot show another team's tickets.
- **Never hard-delete.** Records are deactivated or flagged, so history, reports and the audit log stay complete.
- **Side effects never block the main write.** Audit entries and notifications run after the write, so a failure there cannot lose a ticket.
- **AI is optional.** Every AI feature has a deterministic fallback, so the app works with no key and no cost, and the AI can only choose from data the server sent it.

## Known limitations

- **Not built:** file attachments on tickets, and the optional extras (AI reply drafts, KB draft from a ticket, canned responses, watchers, linked or duplicate tickets).
- **API only, no page:** `GET /asset-api/assets/:assetId/history` (the asset page already shows the history from the asset itself) and `GET /asset-api/assets/:assetId/tickets`. Both are marked in the [Frontend ↔ API guide](docs/Frontend_API_Integration_Guide.md).
- The replacement-asset picker shows at most 50 in-stock assets.
- The daily warranty check runs at 09:00 server time, which is UTC on Render (14:30 in India). It also runs once on every start.
- Render's free tier sleeps. A breach that falls due while it sleeps is caught when the ticket is next opened or when the 5-minute job next runs.
- The frontend has no unit tests. It is covered by the QA suite's static checks, the production build and manual runs ([details](frontend/README.md#checks-before-you-push)).

## Documentation

| Document | What it holds |
|---|---|
| [`backend/README.md`](backend/README.md) | Running, configuring, testing and deploying the API: scripts, environment variables, request flow, conventions, jobs, seed data, troubleshooting. |
| [`frontend/README.md`](frontend/README.md) | Running, building and deploying the app: folder layout, pages and roles, the API client, sign-in, styling, adding a page, troubleshooting. |
| [`docs/Route_Structure_Document.md`](docs/Route_Structure_Document.md) | Every route with method, roles, paging, rate limit and source line, plus the ticket, asset and KB action tables. *Generated from the code.* |
| [`docs/Database_Schema_Document.md`](docs/Database_Schema_Document.md) | All 14 collections: fields, rules, indexes and relationships. *Generated from the models.* |
| [`docs/Frontend_API_Integration_Guide.md`](docs/Frontend_API_Integration_Guide.md) | How the frontend calls the API, and which page calls which route. *Generated from the code.* |
| [`docs/Demo_Script.md`](docs/Demo_Script.md) | A step-by-step walkthrough of all five roles for a live demo. |
| `backend/http/*.http` | Ready-to-run API requests, including the error cases. |
| `Day_Wise_Progress_*.md` | The build log, one file per phase, with decisions, findings and verification. |
| `PLAN.md` | The original build plan (historical). |

The three generated documents are rebuilt with `npm run docs` in `backend/`. Do not edit them by hand.
