# ServiceDesk Pro — MVP

An IT helpdesk & asset-management app (MERN). This is the **Day-1 deployable MVP**:
auth, roles, categories/priorities lookup, and the core ticket lifecycle. See
`PLAN.md` for the full phased roadmap toward the complete spec.

## Stack
- Backend: Node/Express 5, Mongoose, JWT (HTTP-only cookie), bcryptjs, helmet, express-rate-limit
- Frontend: React 19, Vite, Tailwind v4, react-router v7, Zustand, axios, react-hot-toast

## Run locally
```bash
# backend
cd backend
cp .env.example .env   # fill in MONGO_URI and JWT_SECRET
npm install
npm run dev             # seeds demo data on first run

# frontend (new terminal)
cd frontend
npm install
npm run dev
```
Open http://localhost:5173. Demo logins (password `Passw0rd!`):
`admin@sdp.test`, `manager@sdp.test`, `tech@sdp.test`, `employee@sdp.test`, `assets@sdp.test`.

## What's included today
- Register/login/logout/check-auth/change-password, cookie JWT, RBAC (5 roles)
- Departments, Categories, SLA/priority master data (seeded + Admin CRUD)
- Ticket create → assign/claim → start → resolve → confirm/reopen → cancel, with
  optimistic-concurrency (`version`) and a basic 409 conflict flow
- Public + internal comments, visibility rules (internal notes hidden from employees)
- Role-scoped ticket lists (Employee sees own, Technician/Manager see their team, Admin sees all)
- Notifications on assignment/resolution/reopen (in-app, polled on demand)
- Admin dashboard with basic counts
- Deployment-ready: `.env.example` (both apps), `vercel.json` with `/api` rewrite,
  Vite dev proxy, `/health` endpoint for Render

## Not yet built (see PLAN.md)
Business-hours SLA engine + cron escalation, approval workflow, assets/vendors,
knowledge base, AI classification/suggestions, DSA structures (heap/trie/Jaccard),
dashboards beyond basic counts, CSV/PDF export, saved filters, watchers/linked tickets.

## Deploying
- Backend → Render: set env vars from `.env.example`, `NODE_ENV=production`.
- Frontend → Vercel: edit `vercel.json`'s destination to your Render URL, deploy.
- The `/api` rewrite makes the cookie first-party, so `sameSite: "lax"` works even
  in Chrome incognito / Safari (see PLAN.md's original notes on this).
