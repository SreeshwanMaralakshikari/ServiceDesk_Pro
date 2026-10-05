# ServiceDesk Pro: Backend

[README](../README.md) · **Backend** · [Frontend](../frontend/README.md) · [Routes](../docs/Route_Structure_Document.md) · [Database](../docs/Database_Schema_Document.md) · [Frontend ↔ API](../docs/Frontend_API_Integration_Guide.md) · [Demo script](../docs/Demo_Script.md)

The REST API behind ServiceDesk Pro. It handles sign-in, tickets and their SLA clocks, assets, the knowledge base, AI suggestions, dashboards and the audit log, and runs two background jobs. This file covers running, configuring, testing and deploying the backend. What the product does is in the [project README](../README.md).

| At a glance | |
|---|---|
| **Runtime** | Node.js 20.19 or newer, ES modules |
| **Framework** | Express 5, Mongoose 9 (MongoDB) |
| **Auth** | JWT in an HTTP-only cookie (bcryptjs, jsonwebtoken) |
| **Background jobs** | node-cron 3 |
| **Security** | helmet, CORS, express-rate-limit 7, a request-body sanitizer |
| **Tests** | `node:test`, supertest, mongodb-memory-server |
| **Local URL** | `http://localhost:5000` |
| **Live URL** | Through the frontend's `/api` rewrite, for example [`/api/health`](https://service-desk-pro-one.vercel.app/api/health) |

## Contents

- [Quick start](#quick-start)
- [npm scripts](#npm-scripts)
- [Environment variables](#environment-variables)
- [Folder structure](#folder-structure)
- [How a request is handled](#how-a-request-is-handled)
- [The API at a glance](#the-api-at-a-glance)
- [Conventions every route follows](#conventions-every-route-follows)
- [Background jobs and `/health`](#background-jobs-and-health)
- [Seed data and demo accounts](#seed-data-and-demo-accounts)
- [Tests](#tests)
- [Deployment (Render)](#deployment-render)
- [Troubleshooting](#troubleshooting)

## Quick start

You need Node.js 20.19+ and a MongoDB database: a local MongoDB Community server, or an Atlas connection string.

```bash
cd backend
cp .env.example .env     # then set MONGO_URI, JWT_SECRET and CLIENT_URL
npm install
npm run seed             # demo users, tickets, KB articles, assets and the rest
npm run dev              # http://localhost:5000, restarts when a file changes
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Check it is up: open `http://localhost:5000/health`. It should answer `"db": "up"`. Then start the [frontend](../frontend/README.md#quick-start) in a second terminal.

## npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the server with `node --watch`, so it restarts on every save |
| `npm start` | Starts the server once (what Render runs) |
| `npm run seed` | Adds the demo data. Safe to run again: it only adds what is missing |
| `npm run test:unit` | Unit tests. No database needed |
| `npm run test:integration` | Tests against a real MongoDB (see [Tests](#tests)) |
| `npm test` | Both test sets |
| `npm run docs` | Regenerates the three generated documents in [`../docs/`](../docs/) from the code |

One more script runs with `node` directly. It resets a password without logging in, and signs that account out everywhere:

```powershell
# PowerShell, from backend/
$env:RESET_EMAIL="admin@sdp.test"
$env:RESET_PASSWORD="a-new-password-12+"
node scripts/resetPassword.js
```

```bash
# bash, from backend/
RESET_EMAIL=admin@sdp.test RESET_PASSWORD='a-new-password-12+' node scripts/resetPassword.js
```

## Environment variables

Copy `.env.example` to `.env` and fill it in. **Never commit `.env`**: it is in `.gitignore`. The server stops at start-up if any of the three required variables is missing.

**Required**

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string. Include a database name (`.../servicedeskpro_dev`); without one, MongoDB uses `test` and the server logs a warning. Use a different database per environment. |
| `JWT_SECRET` | A long random secret that signs the auth cookie. |
| `CLIENT_URL` | The frontend's origin, with no trailing slash. Used by CORS. |

**Server and sessions**

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | | Set to `production` on Render. That makes the cookie `secure`, removes the localhost origins from CORS, and keeps demo accounts out of the seed. |
| `PORT` | `5000` | The port to listen on. |
| `JWT_EXPIRES_IN` | `1d` | How long a sign-in lasts (`30m`, `12h`, `7d`). The cookie lives exactly as long. |
| `TRUST_PROXY_HOPS` | `1` | How many proxies sit in front of Express, so rate limits see the real client address. `1` locally, `4` on the live setup (Vercel → Cloudflare → Render). |
| `LOG_CLIENT_IP` | `false` | `true` logs the client address on each login. Turn it on briefly to check `TRUST_PROXY_HOPS`. |
| `APP_VERSION` | | Shown by `/health`. On Render, `RENDER_GIT_COMMIT` is used first. |

**Seeding**

| Variable | Purpose |
|---|---|
| `SEED_ON_START` | `true` runs the seed when the server starts. Local only; ignored in production. |
| `SEED_DEMO_PASSWORD` | Shared password for the demo accounts, at least 8 characters (default `Passw0rd!`). Set it before seeding any database other people can reach. |
| `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_EMAIL` | A real admin that `npm run seed` creates when the password is set (12–72 characters). The email defaults to `admin@sdp.test`. Needed in production, optional locally. |

**AI and limits**

| Variable | Default | Purpose |
|---|---|---|
| `GROQ_API_KEY` | | Turns on the real AI. Without it, an offline fallback answers, so the AI buttons always work. |
| `AI_MODEL` | `openai/gpt-oss-20b` | The Groq model name. Change it here if Groq retires a model. `GROQ_MODEL` is an older alias. |
| `AI_RATE_LIMIT_MAX` | `20` | AI calls per user per minute. |
| `REGISTER_RATE_LIMIT_MAX` | `10` | Registrations per address per hour. |
| `LOGIN_EMAIL_LIMIT_MAX` | `20` | Failed logins per account per 15 minutes. This is on top of 10 failed logins per address. |
| `REPORT_ROW_CAP` | `5000` | The most rows a dashboard or CSV export reads. |

## Folder structure

```
backend/
├── server.js            opens the port, connects to MongoDB (with retries), starts the jobs
├── app.js               the Express app: middleware, /health, the 13 routers
├── APIs/                one router per area: TicketAPI.js, AdminAPI.js, AssetAPI.js, ...
├── models/              the 14 Mongoose models
├── middlewares/         verifyToken, rate limiters, body sanitizer, error handler
├── utils/               business rules: workflow tables, SLA maths, scoping, reports, seed data
│   └── dsa/             hand-written heap, smart queue, similarity and timeline merge
├── jobs/                SLA checker (every 5 minutes) and warranty checker (daily)
├── config/              environment loading (loadEnv.js) and the Groq client
├── scripts/             resetPassword.js, generateDocs.js
├── http/                REST Client request files, one per area (*-req.http)
├── test/                unit tests
│   └── integration/     tests against a real MongoDB
├── testkit/             helpers that start the test database and the app
├── .env.example         every variable, with comments
└── package.json
```

## How a request is handled

Every request passes through the same steps, in this order (see `app.js`):

1. **`helmet()`** sets the security headers.
2. **`cors()`** allows only `CLIENT_URL`, plus `localhost:5173` and `5174` outside production, with credentials.
3. **`express.json({ limit: '1mb' })`** parses the body. A larger body gets 413.
4. **`cookieParser()`** reads the `token` cookie.
5. **`sanitizeBody`** drops any body key that starts with `$` or contains a `.`, which blocks operator injection.
6. **The router** for the path. Inside it, `verifyToken(...roles)` checks the cookie, **reloads the user from the database** (role, department, active flag, password-change time), and refuses the wrong role with 403.
7. **No route matched:** 404 `{ message: 'Path … is invalid' }`.
8. **Anything thrown** goes to `errorHandler`, which turns bad JSON, unknown fields, validation errors, bad ids and duplicate keys into 4xx answers, and everything else into a generic 500.

## The API at a glance

Thirteen routers, 76 routes, plus `GET /health`. The [Route Structure Document](../docs/Route_Structure_Document.md) lists every route with its roles, paging, rate limit and source line, generated from the code.

| Prefix | File | Covers |
|---|---|---|
| `/auth` | `CommonAPI.js` | Register, log in and out, session check, change password |
| `/meta-api` | `MetaAPI.js` | Lookup lists for forms: departments, categories, priorities |
| `/ticket-api` | `TicketAPI.js` | Tickets: create, list, detail, status actions, comments, rating, timeline, suggestions |
| `/admin-api` | `AdminAPI.js` | Users, departments, categories, SLA policies, business hours, audit log, admin dashboard |
| `/notification-api` | `NotificationAPI.js` | In-app notifications |
| `/asset-api` | `AssetAPI.js` | Assets: list, detail, lifecycle actions, maintenance, replace, statistics |
| `/vendor-api` | `VendorAPI.js` | Vendors |
| `/kb-api` | `KnowledgeBaseAPI.js` | Knowledge-base articles and their review workflow |
| `/ai-api` | `AiAPI.js` | AI category and priority suggestion, knowledge-base suggestions |
| `/worklog-api` | `WorkLogAPI.js` | Time a technician logs on a ticket |
| `/tech-api` | `TechAPI.js` | Technician's queue and dashboard |
| `/manager-api` | `ManagerAPI.js` | Team dashboard |
| `/report-api` | `ReportAPI.js` | Ticket report and CSV exports |

The routes have no `/api` prefix. The browser calls `/api/...`, and the Vite proxy (locally) or the Vercel rewrite (live) strips `/api` before the request reaches Express.

## Conventions every route follows

How to **call** the API (base path, sign-in cookie, response and error shapes, paging, IDs, sending `version`) is in the Route Structure Document, under [How to call the API](../docs/Route_Structure_Document.md#how-to-call-the-api). The rules below are how the code keeps those promises.

- **One table per workflow.** `utils/ticketTransitions.js`, `assetTransitions.js` and `kbTransitions.js` say which role may do what from which status. A route checks the table, then writes once with `findOneAndUpdate({ _id, status, version })`. A stale `version` matches nothing and the route answers **409**, so two people can never overwrite each other. The tables are printed in the [Route Structure Document](../docs/Route_Structure_Document.md#actions-behind-the-action-routes).
- **Who sees what.** Query builders (`buildTicketQuery.js`, `buildKbQuery.js`) limit every list to what the caller may see. Technicians and managers see only their own team. A staff user with no department sees nothing rather than everything.
- **Nothing is hard-deleted.** Records are flagged (`isDeleted`) or deactivated (`isActive`); the [Database document](../docs/Database_Schema_Document.md) shows which collection uses which.
- **Audit and notifications never break a write.** They run after the main write. A failure there is logged, not returned to the user.
- **Private fields stay private.** Internal notes are removed from every ticket answer an employee receives, and secrets such as licence keys are never written to the audit log.

## Background jobs and `/health`

| Job | When | What it does |
|---|---|---|
| SLA checker (`jobs/slaChecker.js`) | Every 5 minutes | Sends the 75% warning, marks breaches, escalates to the team manager (and the admins for a resolution breach) |
| Warranty checker (`jobs/warrantyChecker.js`) | Daily at 09:00 server time, and once at every start | Notifies asset managers and admins once per asset whose warranty ends within 30 days |

Render's free tier sleeps, so a job can miss its slot. Each ticket is also checked against its SLA whenever it is opened, so a breach is never lost.

`GET /health` answers `{ message: 'ok', payload: { uptime, db, cron, version } }`. `db` is `"up"` once MongoDB is connected, each job in `cron` is `"running"`, and `version` is the deployed commit. The server starts listening **before** it connects to the database (up to 8 attempts, waiting 2 seconds longer before each retry), so `/health` answers during a slow start and says `db: "down"` until the connection is up.

## Seed data and demo accounts

`npm run seed` adds departments, users, categories, SLA policies, tickets, knowledge-base articles, vendors and assets. It only adds what is missing: it never changes a password or overwrites a value someone set, and only fills in a few demo fields that an older database lacks (a technician's skills, a category's auto-assign setting, a team's manager). It is safe to run again.

**Local demo accounts.** The password is `SEED_DEMO_PASSWORD` if you set one, otherwise `Passw0rd!`.

| Email | Role | Team |
|---|---|---|
| `admin@sdp.test` | Admin | |
| `manager@sdp.test` | Manager | Service Desk |
| `ian@sdp.test` | Manager | Infrastructure |
| `tech@sdp.test` | Technician | Service Desk |
| `employee@sdp.test` | Employee | Engineering |
| `assets@sdp.test` | Asset manager | |

More technicians (tara, ravi, noor, nia) and employees (hana, omar, fay) exist with the same password.

**In production** (`NODE_ENV=production`) the seed creates the reference data and one real admin from `SEED_ADMIN_PASSWORD`, and **no** demo accounts. Run it once, by hand, after the first deploy.

## Tests

```bash
npm run test:unit          # no database needed
npm run test:integration   # a real MongoDB through mongodb-memory-server
npm test                   # both
```

| Set | Where | What it covers |
|---|---|---|
| Unit (230 tests) | `test/*.test.js` | Rules and helpers: workflow tables, SLA maths, IDs, sessions, CSV, the DSA structures, the error handler. `ai.integration.test.js` and `kb.integration.test.js` here boot the real server with the database stubbed, so they need no MongoDB either |
| Integration (140 tests) | `test/integration/*.test.js` | Whole routes through supertest: lifecycles, concurrency (409), visibility, admin rules, reports, seeding |

- The integration tests download a MongoDB 7.0.14 binary on their first run. To use a server you already have, set `TEST_MONGO_URI`; each test process then gets its own throwaway database there.
- `TEST_REPLSET=1` starts a one-node replica set instead, so transactions are tested the way Atlas runs them.
- On FerretDB or other MongoDB-compatible servers, the race tests can fail because those servers do not make `$inc` atomic. Run them on real MongoDB.

**Project-wide checks.** From the project root, `node qa/run-all.mjs` runs these tests plus static checks across both apps. The [project README](../README.md#tests-and-checks) explains it.

**Manual checks.** Open `http/*.http` in VS Code with the REST Client extension. Run the login request first; the cookie is reused by the rest. Each file also has the expected error cases.

## Deployment (Render)

| Setting | Value |
|---|---|
| Service type | Web service |
| Root directory | `backend` |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/health` (recommended: it also reports the database) |
| Environment | Every variable above that applies, with `NODE_ENV=production` and `TRUST_PROXY_HOPS=4` |

In MongoDB Atlas, allow Render's outbound addresses under Network Access (or `0.0.0.0/0`).

**Every time you ship a change,** follow the check in the [project README](../README.md#deployment): push both apps together, then confirm `/api/health`.

**First deploy only:** run `npm run seed` once with `NODE_ENV=production` and `SEED_ADMIN_PASSWORD` set.

## Troubleshooting

| What you see | Likely cause and fix |
|---|---|
| `Missing required env var: …` and the server exits | `.env` is missing or incomplete. Copy `.env.example` and fill in the three required variables. |
| `err in db connect` repeated, then "giving up" | Wrong `MONGO_URI`, your address is not allowed in Atlas Network Access, or the network blocks outbound port 27017. Some home and college networks do; a phone hotspot or a local MongoDB works around it. |
| `querySrv ECONNREFUSED` | Your DNS cannot resolve `mongodb+srv://` records. Use the non-SRV `mongodb://host1,host2,host3/...` string from Atlas. |
| `bad auth` right after changing the database password | URL-encode special characters in the new password. It can also fail briefly right after you edit `MONGO_URI` on Render; wait a minute and check again. |
| `MONGO_URI has no database name` warning | Add `/servicedeskpro_dev` (or another name) after the host list. |
| A CORS error in the browser, locally | `CLIENT_URL` does not exactly match the frontend's origin. No trailing slash. |
| Everyone gets "Too many login attempts" together | `TRUST_PROXY_HOPS` is wrong, so every request looks like it comes from the proxy. Turn on `LOG_CLIENT_IP`, log in, and check the logged address is yours. |
| Knowledge-base search returns an error | The database does not support `$text` (FerretDB, for example). MongoDB and Atlas do. |
| `SLA checker disabled: node-cron is not installed` | Run `npm install` in `backend/`. Tickets are still checked when they are opened. |
