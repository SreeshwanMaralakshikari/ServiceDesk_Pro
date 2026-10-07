# ServiceDesk Pro: Frontend

[README](../README.md) · [Backend](../backend/README.md) · **Frontend** · [Routes](../docs/Route_Structure_Document.md) · [Database](../docs/Database_Schema_Document.md) · [Frontend ↔ API](../docs/Frontend_API_Integration_Guide.md) · [Demo script](../docs/Demo_Script.md)

The single-page React app that employees, technicians, managers, asset managers and admins use. This file covers running, building and deploying the frontend, and how its code is organised. What the product does is in the [project README](../README.md).

| At a glance | |
|---|---|
| **UI** | React 19, React Router 7 (`react-router-dom`), React Hook Form, react-hot-toast |
| **State** | Zustand 5 |
| **Styling** | Tailwind CSS 4 (through the `@tailwindcss/vite` plugin) |
| **Build** | Vite 6 |
| **API client** | axios, one shared instance |
| **Local URL** | `http://localhost:5173` |
| **Live URL** | https://service-desk-pro-one.vercel.app |
| **Environment variables** | None |

## Contents

- [Quick start](#quick-start)
- [npm scripts](#npm-scripts)
- [Folder structure](#folder-structure)
- [Pages and who can open them](#pages-and-who-can-open-them)
- [Talking to the backend](#talking-to-the-backend)
- [Sign-in and role checks](#sign-in-and-role-checks)
- [Styling](#styling)
- [Adding a page](#adding-a-page)
- [Checks before you push](#checks-before-you-push)
- [Deployment (Vercel)](#deployment-vercel)
- [Troubleshooting](#troubleshooting)

## Quick start

Start the [backend](../backend/README.md#quick-start) first, on port 5000. Then, in a second terminal:

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173
```

Log in with a demo account from the backend's seed, for example `employee@sdp.test` / `Passw0rd!`. The full list is in the [backend README](../backend/README.md#seed-data-and-demo-accounts).

**No `.env` is needed.** The app calls `/api/...` on its own address. In development, Vite's proxy (`vite.config.js`) strips `/api` and forwards the request to `http://localhost:5000`. `.env.example` exists only to say so.

## npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the Vite dev server with hot reload and the `/api` proxy |
| `npm run build` | Builds the production files into `dist/` |
| `npm run preview` | Serves the built `dist/` locally, to check a production build |

## Folder structure

```
frontend/
├── index.html               the page shell and the inline app icon
├── vite.config.js           React and Tailwind plugins, and the /api proxy for development
├── vercel.json              the /api rewrite to Render, then the single-page-app fallback
└── src/
    ├── main.jsx             mounts the router and the toast container
    ├── App.jsx              every route, grouped by the roles allowed to open it
    ├── axiosInstance.js     the one API client: cookie, timeout, one retry, waking banner
    ├── index.css            Tailwind import and the chart colours
    ├── components/
    │   ├── *.jsx            root layout, public header, route guard, home, login, register, 403, 404
    │   ├── layout/          signed-in frame: sidebar, top bar, user menu, mobile drawer, navConfig.js
    │   ├── home/            the public landing page and the signed-in start page
    │   ├── auth/            the split-screen layout shared by login and register
    │   ├── tickets/         list, create, detail, and the panels shown on a ticket
    │   ├── tech/            the technician's queue and dashboard
    │   ├── reports/         team dashboard, ticket report, CSV download
    │   ├── assets/          asset list, detail, create, statistics, "My Assets"
    │   ├── vendors/         vendor list
    │   ├── kb/              knowledge base: list, article, editor
    │   ├── notifications/   the bell and the notifications page
    │   ├── admin/           users, departments, categories, SLA, settings, audit log
    │   ├── account/         change password
    │   └── common/          DataTable, Modal, ConfirmModal, Field, TagInput, Badges, PasswordInput,
    │                        Spinner, Skeleton, EmptyState, ErrorState, NotFoundState,
    │                        WakingBanner, and charts/
    ├── hooks/useFetch.js    reads data and cancels stale requests
    ├── store/               authStore.js (who is signed in), networkStore.js (slow requests)
    ├── styles/common.js     every reusable Tailwind class string
    └── utils/               errors.js, actions.js, sla.js, labels.js (readable names for API codes)
```

## Pages and who can open them

The routes live in `src/App.jsx`. A page's role list matches the roles the backend allows for the calls it makes.

| Path | Page | Who |
|---|---|---|
| `/` | Signed out: the product landing page. Signed in: a start page with what needs attention and shortcuts for the role | Everyone |
| `/login`, `/register` | Sign in, create an employee account | Everyone |
| `/tickets`, `/tickets/:ticketId` | Ticket list (`?status=RESOLVED` opens it filtered) and ticket detail | Every signed-in role |
| `/notifications` | All notifications | Every signed-in role |
| `/account/password` | Change password | Every signed-in role |
| `/my-assets` | Assets assigned to me | Every signed-in role |
| `/kb`, `/kb/:articleId` | Knowledge base and article | Every signed-in role |
| `/tickets/new` | Raise a ticket | Employee, Admin |
| `/kb/new`, `/kb/:articleId/edit` | Write or edit an article | Technician, Manager, Admin |
| `/my-queue`, `/tech/dashboard` | Technician's queue and dashboard | Technician |
| `/approvals`, `/manager/dashboard`, `/reports` | Approvals, team dashboard, ticket report | Manager, Admin |
| `/assets`, `/assets/:assetId` | Asset list and asset detail | Asset manager, Admin, Technician |
| `/assets/new`, `/vendors`, `/asset-stats` | New asset, vendors, asset statistics | Asset manager, Admin |
| `/admin`, `/admin/*` | Admin dashboard; users, departments, categories, SLA, settings, audit log | Admin |
| `/unauthorized`, anything else | 403 page, 404 page | Everyone |

After login, asset managers land on **Asset Stats** and everyone else on **My Tickets**.

## Talking to the backend

Every request goes through **`src/axiosInstance.js`**: it calls `/api` with the sign-in cookie, gives up after 20 seconds, retries a GET once after a timeout, a network error or a 502/503/504 (never a write), and shows the "Waking the server up…" banner when a request takes more than 4 seconds. The [Frontend ↔ API guide](../docs/Frontend_API_Integration_Guide.md#how-the-frontend-talks-to-the-backend) explains each of these, and lists which page calls which route.

Where to find the helpers:

| To… | Use | In |
|---|---|---|
| Load data for a page | `useFetch(url, params)` | `hooks/useFetch.js` |
| Show an error message | `getErrorMessage(err, fallback)` | `utils/errors.js` |
| Run a write and show a toast | `runAction(request, successMessage)` | `utils/actions.js` |
| Show a paged list (with loading, empty and error states) | `DataTable` | `components/common/DataTable.jsx` |
| Show a status, priority or role | `StatusBadge`, `PriorityBadge`, `RoleBadge` … | `components/common/Badges.jsx` |
| Turn an API code into text (`IN_PROGRESS` → "In progress") | `statusLabel`, `roleLabel`, `humanize` … | `utils/labels.js` |
| Download a CSV | `downloadCsv(url, params, fallbackName)` | `components/reports/downloadCsv.js` |
| Show an SLA badge | `getSlaStatus(ticket)` | `utils/sla.js` |

## Sign-in and role checks

- **`store/authStore.js`** holds `user`, `isAuthenticated` and `isChecking`, and the `checkAuth`, `login` and `logout` actions. A counter makes sure a slow `checkAuth` answer can never undo a login or logout that happened after it started.
- **`RootLayout.jsx`** calls `checkAuth()` (`GET /auth/check-auth`) once when the app loads, and shows a loading screen until it answers. Signed-in users then get the sidebar layout (`layout/AppShell.jsx`); signed-out visitors get the simple top bar (`Header.jsx`).
- **`layout/navConfig.js`** is the one list of menu links and the roles that see each one. The sidebar and the home page both read it, and its roles must match the `ProtectedRoutes` blocks in `App.jsx`.
- **`ProtectedRoutes.jsx`** sends a visitor to `/login`, and a signed-in user with the wrong role to `/unauthorized`.
- These checks only decide what the app shows. **The backend checks the role again on every request**, so hiding a page is never the only protection.

## Styling

- **Tailwind CSS 4**, loaded by `@import "tailwindcss"` in `src/index.css`. There is no `tailwind.config.js`.
- **`src/styles/common.js`** holds every reusable class string (`styles.card`, `styles.btnPrimary`, `styles.input`, `styles.table` ...). Use these instead of repeating long class lists, so the look stays consistent.
- **Palette:** indigo for actions and links, slate for text and surfaces, red for danger. The chart colours are CSS variables in `index.css`.
- **Icons:** [lucide-react](https://lucide.dev/icons/). Import each icon by name (`import { Ticket } from 'lucide-react'`) and mark decorative ones `aria-hidden="true"`.
- **States:** lists use `DataTable`, which shows a skeleton while loading, `ErrorState` (with a retry button when you pass `onRetry`) and `EmptyState` (pass `emptyIcon` and `emptyAction`). Detail pages use `PageSkeleton` and `NotFoundState`.
- **Phones:** wide tables scroll inside their card; give less important columns `className: 'hidden md:table-cell'` in the `DataTable` columns.
- The app is light-themed only.

## Adding a page

1. Create the component under `src/components/<area>/`.
2. Add its route to `src/App.jsx`, inside the `ProtectedRoutes` block whose roles **match the backend's roles** for the routes the page calls.
3. Add a link in `components/layout/navConfig.js` for the same roles, if the page belongs in the menu.
4. Read with `useFetch`, write with `axiosInstance` (or `runAction`), show errors with `getErrorMessage`.
5. From `backend/`, run `npm run docs` to update the [Frontend ↔ API guide](../docs/Frontend_API_Integration_Guide.md), then run the checks below.

## Checks before you push

```bash
npm run build                # from frontend/: must finish without errors
node qa/run-all.mjs          # from the project root: checks both apps together
```

The QA suite checks that every import resolves, that every API path the frontend uses exists in the backend, and that every in-app link points at a real route. It is described in the [project README](../README.md#tests-and-checks).

The frontend has **no unit tests**, on purpose. It is covered by the QA suite, the production build and manual runs through the [demo script](../docs/Demo_Script.md).

The build prints a warning that one chunk is larger than 500 kB. It is only a warning: the app loads as one bundle, and splitting it has not been needed yet.

## Deployment (Vercel)

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Framework preset | Vite |
| Build command | `npm run build` (the preset's default) |
| Output directory | `dist` (the preset's default) |
| Environment variables | None |

`vercel.json` has two rewrites, and **their order matters**:

1. `/api/:path*` → the Render backend, without the `/api` prefix.
2. Everything else → `/index.html`, so a refresh on a deep link such as `/tickets/TKT-2026-00012` still loads the app.

Why this setup keeps the sign-in cookie working is in the [project README](../README.md#how-the-pieces-fit-together). If the backend moves to a new Render URL, change the `destination` of the first rewrite.

## Troubleshooting

| What you see | Likely cause and fix |
|---|---|
| Every `/api/...` call returns 404 on the live site | The first rewrite in `vercel.json` points at the wrong Render URL. |
| A refreshed deep link shows Vercel's 404 page | The single-page-app fallback rewrite is missing from `vercel.json`. |
| API calls get the app's HTML back instead of JSON | The fallback rewrite comes before the `/api` rewrite. Put the `/api` rewrite first. |
| Login succeeds, then the app sends you back to the login page | The cookie is not coming back. The app must call `/api` on its own address, not the Render URL directly. |
| Every call fails locally, and the Vite terminal shows `http proxy error` | The backend is not running on port 5000. Start it first. |
| "Waking the server up…" stays for a long time | The backend is starting after a sleep. Wait up to a minute, then refresh. |
| A page shows "error occurred" instead of a reason | The page shows `message` instead of using `getErrorMessage`. |
