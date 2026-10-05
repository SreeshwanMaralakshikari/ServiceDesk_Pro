// regenerates the three generated documents in docs/ from the code: routes come from the
// mounted express routers, guards from the verifyToken(...) calls in each router file,
// frontend usage from the API paths written in frontend/src, fields and indexes from the
// mongoose schemas.
//   node scripts/generateDocs.js        writes all three
//   node scripts/generateDocs.js --check exits 1 if any of them is out of date
// needs no database and no .env
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { TRANSITIONS, REQUESTER_ONLY_ACTIONS, REOPEN_WINDOW_DAYS } from '../utils/ticketTransitions.js'
import { ASSET_TRANSITIONS } from '../utils/assetTransitions.js'
import { KB_TRANSITIONS } from '../utils/kbTransitions.js'

const backendDir = fileURLToPath(new URL('..', import.meta.url))
const docsDir = path.join(backendDir, '..', 'docs')
const ALL_ROLES = ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER']
const METHOD_RE = /^(\w+)\.(get|post|put|patch|delete)\(\s*'([^']+)'(.*)$/

// the line under every document title: one link per project document, the current one in bold.
// README.md files carry the same line, written by hand
const DOC_LINKS = [
  ['README', '../README.md'],
  ['Backend', '../backend/README.md'],
  ['Frontend', '../frontend/README.md'],
  ['Routes', 'Route_Structure_Document.md'],
  ['Database', 'Database_Schema_Document.md'],
  ['Frontend ↔ API', 'Frontend_API_Integration_Guide.md'],
  ['Demo script', 'Demo_Script.md'],
]
const navLine = (current) => DOC_LINKS.map(([label, href]) => (href === current ? `**${label}**` : `[${label}](${href})`)).join(' · ')

// the anchor GitHub gives a heading: lower case, punctuation dropped, spaces to hyphens
const anchor = (headingText) => headingText.toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/ /g, '-')

// one line per router and per collection for the contents tables. A new router or model
// without a line here stops the script, so the contents never go out of date
const ROUTER_PURPOSE = {
  '/auth': 'Register, log in and out, session check, change password',
  '/meta-api': 'Lookup lists for forms: departments, categories, priorities',
  '/ticket-api': 'Tickets: create, list, detail, status actions, comments, rating, timeline, suggestions',
  '/admin-api': 'Users, departments, categories, SLA policies, business hours, audit log, admin dashboard',
  '/notification-api': 'In-app notifications',
  '/asset-api': 'Assets: list, detail, lifecycle actions, maintenance, replace, statistics',
  '/vendor-api': 'Vendors',
  '/kb-api': 'Knowledge-base articles and their review workflow',
  '/ai-api': 'AI category and priority suggestion, knowledge-base suggestions',
  '/worklog-api': 'Time a technician logs on a ticket',
  '/tech-api': "Technician's queue and dashboard",
  '/manager-api': 'Team dashboard',
  '/report-api': 'Ticket report and CSV exports',
}
const MODEL_PURPOSE = {
  AiLogModel: 'One row per AI call: result, latency, cache hit, a short input snippet',
  AssetModel: 'Hardware and software assets, with their maintenance log and lifecycle history',
  AuditLogModel: 'The audit log: who changed what, and when',
  CategoryModel: 'Ticket categories: handling team, default priority, approval, auto-assign, required skills',
  CounterModel: 'The sequence counters behind the public IDs',
  DepartmentModel: 'Business departments and IT teams',
  KnowledgeArticleModel: 'Knowledge-base articles and their edit history',
  NotificationModel: 'In-app notifications, one per user and event',
  OrgSettingsModel: 'Organisation name and business hours',
  SLAPolicyModel: 'Response and resolution targets per priority',
  TicketModel: 'Tickets: assignment, comments, status history, SLA clock, resolution, rating, AI suggestions',
  UserModel: 'Accounts: role, department, skills, active flag',
  VendorModel: 'Vendors that supply and repair assets',
  WorkLogModel: 'Time a technician logged on a ticket',
}
const purposeOf = (map, key, what) => {
  if (!map[key]) throw new Error(`add a one-line description of ${what} ${key} to generateDocs.js`)
  return map[key]
}

// an index as people write it in code: { kind: 1, createdAt: -1 }
const formatIndex = (fields) => `{ ${Object.entries(fields).map(([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : v}`).join(', ')} }`

// which router variable is mounted where, read from app.js itself
const readMounts = () => {
  const appSrc = readFileSync(path.join(backendDir, 'app.js'), 'utf8')
  const files = {}
  for (const m of appSrc.matchAll(/import \{ (\w+App) \} from '\.\/APIs\/(\w+\.js)'/g)) files[m[1]] = m[2]
  const mounts = []
  for (const m of appSrc.matchAll(/app\.use\('([^']+)', (\w+App)\)/g)) mounts.push({ prefix: m[1], name: m[2], file: files[m[2]] })
  return mounts
}

// role lists inside verifyToken(...), with ...CONSTANT spread resolved from the same file
const parseRoles = (argText, constants) => {
  const roles = []
  for (const part of argText.split(',').map((p) => p.trim()).filter(Boolean)) {
    const spread = part.match(/^\.\.\.(\w+)$/)
    if (spread) {
      if (!constants[spread[1]]) throw new Error(`unknown role constant ${spread[1]}`)
      roles.push(...constants[spread[1]])
    } else {
      roles.push(part.replace(/['"]/g, ''))
    }
  }
  return roles
}

const describeGuard = (roles) => {
  if (roles === null) return 'public'
  if (roles.length === 0 || ALL_ROLES.every((r) => roles.includes(r))) return 'any signed-in user'
  return roles.join(', ')
}

// static read of one router file: method, path, guard, limiters and line number
const parseRouterFile = (file) => {
  const src = readFileSync(path.join(backendDir, 'APIs', file), 'utf8')
  const lines = src.split('\n')
  const constants = {}
  for (const m of src.matchAll(/const (\w+_ROLES) = \[([^\]]*)\]/g)) {
    constants[m[1]] = m[2].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
  }
  let routerGuard = null
  const routes = []
  lines.forEach((line, i) => {
    const use = line.match(/^\w+\.use\(verifyToken\(([^)]*)\)\)/)
    if (use) routerGuard = parseRoles(use[1], constants)
    const m = line.match(METHOD_RE)
    if (!m) return
    const rest = m[4]
    const guard = rest.match(/verifyToken\(([^)]*)\)/)
    const roles = guard ? parseRoles(guard[1], constants) : routerGuard
    const limiters = [...rest.matchAll(/(\w+Limiter)\b/g)].map((x) => x[1])
    routes.push({ method: m[2].toUpperCase(), path: m[3], roles, limiters, line: i + 1 })
  })
  // a route's handler runs until the next route; it is paged when it answers through toPage()
  routes.forEach((r, i) => {
    const body = lines.slice(r.line - 1, routes[i + 1] ? routes[i + 1].line - 1 : lines.length).join('\n')
    r.paged = /toPage\(/.test(body)
  })
  return routes
}

// the routes express really has, so a regex miss cannot hide a route
const runtimeRoutes = async (file, name) => {
  const mod = await import(pathToFileURL(path.join(backendDir, 'APIs', file)))
  const router = mod[name]
  return router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((method) => ({ method: method.toUpperCase(), path: l.route.path })))
}

const transitionTable = (table, { showFlags }) => {
  const rows = ['| Action | From | To | Roles |' + (showFlags ? ' Notes |' : ''), '|---|---|---|---|' + (showFlags ? '---|' : '')]
  for (const [action, rule] of Object.entries(table)) {
    const notes = []
    if (rule.requiresNote) notes.push('note required')
    if (rule.assigneeOnly) notes.push('assigned technician only')
    if (REQUESTER_ONLY_ACTIONS.includes(action)) notes.push('requester only')
    rows.push(`| \`${action}\` | ${rule.from.join(', ')} | ${rule.to ?? '(no change)'} | ${rule.roles.join(', ')} |` + (showFlags ? ` ${notes.join('; ')} |` : ''))
  }
  return rows.join('\n')
}

// every route once: express decides what exists, the file read adds guard, paging and line
const collectRoutes = async () => {
  const mounts = readMounts()
  const routers = []
  for (const { prefix, name, file } of mounts) {
    const parsed = parseRouterFile(file)
    const live = await runtimeRoutes(file, name)
    const key = (r) => `${r.method} ${r.path}`
    const parsedKeys = new Set(parsed.map(key))
    const liveKeys = new Set(live.map(key))
    const missing = [...liveKeys].filter((k) => !parsedKeys.has(k))
    const extra = [...parsedKeys].filter((k) => !liveKeys.has(k))
    if (missing.length || extra.length) throw new Error(`${file}: routes differ between express and the file read (missing ${missing.join(', ') || '-'}; extra ${extra.join(', ') || '-'})`)
    routers.push({ prefix, file, routes: parsed.map((r) => ({ ...r, file, full: prefix + (r.path === '/' ? '' : r.path) })) })
  }
  return routers
}

const routerHeading = (file, count) => `(${file}, ${count} ${count === 1 ? 'route' : 'routes'})`

const buildRouteDoc = (routers) => {
  const sections = []
  let total = 1
  for (const { prefix, file, routes: parsed } of routers) {
    total += parsed.length
    const rows = parsed.map((r) => `| ${r.method} | \`${r.full}\` | ${describeGuard(r.roles)} | ${r.paged ? 'yes' : ''} | ${r.limiters.join(', ') || ''} | \`${file}:${r.line}\` |`)
    sections.push(`### \`${prefix}\` ${routerHeading(file, parsed.length)}\n\n${purposeOf(ROUTER_PURPOSE, prefix, 'router')}.\n\n| Method | Path | Who may call it | Paged | Rate limit | Source |\n|---|---|---|---|---|---|\n${rows.join('\n')}`)
  }
  const mounts = routers
  const contents = routers.map(({ prefix, file, routes: parsed }) => `| [\`${prefix}\`](#${anchor(`${prefix} ${routerHeading(file, parsed.length)}`)}) | ${parsed.length} | ${purposeOf(ROUTER_PURPOSE, prefix, 'router')} |`)
  return `# Route Structure Document

${navLine('Route_Structure_Document.md')}

> Generated from the code by \`backend/scripts/generateDocs.js\` (run \`npm run docs\` in \`backend/\`). Do not edit by hand: change the code and regenerate.

**${total} routes** = \`GET /health\` + ${total - 1} in ${mounts.length} routers.

| Router | Routes | What it covers |
|---|---|---|
${contents.join('\n')}

The [action tables](#actions-behind-the-action-routes) at the end list every status change for tickets, assets and articles.

## How to call the API

- **Base path.** The browser calls everything under \`/api\` on the frontend's own domain. Vercel (\`frontend/vercel.json\`) and the Vite dev proxy (\`frontend/vite.config.js\`) strip \`/api\` and forward to Express, so \`/api/ticket-api/tickets\` reaches the route \`/ticket-api/tickets\` below. The cookie is therefore first-party.
- **Auth.** \`POST /auth/login\` sets an HTTP-only \`token\` cookie (JWT). Every guarded route re-reads the user from the database, so a role, department or active-flag change, or a password change, takes effect on the next request.
- **Success shape.** \`{ message, payload }\`. Routes marked **Paged** return \`payload: { items, total, page, totalPages }\` and accept \`?page=\` (from 1) and \`?limit=\` (default 20, max 50). Other routes that return several records (lookup lists, histories, the timeline, top-5 lists) return a plain array.
- **Error shape.** A route's own refusal is \`{ message }\` with 400, 401, 403, 404 or 409. Errors caught by the global handler (\`middlewares/errorHandler.js\`) are \`{ message: 'error occurred', error: '<reason>' }\`.
- **IDs.** \`:ticketId\`, \`:assetId\` and \`:articleId\` accept the public ID (\`TKT-2026-00012\`, \`AST-…\`, \`KB-…\`) or the Mongo \`_id\`.
- **Concurrency.** Every status change (the \`:action\` routes) must send the \`version\` the client last read. A stale \`version\` gets **409** and the client reloads.
- **Examples.** \`backend/http/\` has one REST Client file per area (auth, tickets, admin, assets, vendors, KB, AI, work logs, technician, reports) with working requests and the negative cases.

"Who may call it" is the role check in \`verifyToken(...)\`. Most routes then narrow further inside the handler: by department (team-scoped staff), by ownership (an employee's own tickets), or by the action tables below.

## Routes

${sections.join('\n\n')}

## Actions behind the \`:action\` routes

### Tickets: \`PATCH /ticket-api/tickets/:ticketId/:action\` (\`utils/ticketTransitions.js\`)

${transitionTable(TRANSITIONS, { showFlags: true })}

Team-scoped actions also require the caller to belong to the ticket's department (Admin is exempt). \`resolve\` needs a \`resolutionSummary\`. A CLOSED ticket can be reopened only within ${REOPEN_WINDOW_DAYS} days of closing.

### Assets: \`PATCH /asset-api/assets/:assetId/:action\` (\`utils/assetTransitions.js\`)

${transitionTable(ASSET_TRANSITIONS, { showFlags: false })}

\`PATCH /asset-api/assets/:assetId/replace\` is separate: it marks an ASSIGNED (or IN_REPAIR) unit REPLACED and assigns an IN_STOCK unit to the same person, both writes in one transaction.

### Knowledge base: \`PATCH /kb-api/articles/:articleId/:action\` (\`utils/kbTransitions.js\`)

${transitionTable(KB_TRANSITIONS, { showFlags: false })}

A technician may use \`request-review\` only on their own draft. Employees only ever see PUBLISHED articles.
`
}

// one row per schema path; document arrays are expanded as field[].child
const fieldRows = (schema, prefix = '') => {
  const rows = []
  schema.eachPath((p, t) => {
    if (p === '__v') return
    const o = t.options
    const name = prefix + p
    const notes = []
    if (o.required) notes.push('required')
    if (o.unique) notes.push('unique')
    const enumValues = t.enumValues?.length ? t.enumValues : t.caster?.enumValues
    if (enumValues?.length) notes.push(`one of ${enumValues.join(', ')}`)
    if (o.ref) notes.push(`ref \`${o.ref}\``)
    if (t.caster?.options?.ref) notes.push(`ref \`${t.caster.options.ref}\``)
    if (o.min !== undefined) notes.push(`min ${Array.isArray(o.min) ? o.min[0] : o.min}`)
    if (o.max !== undefined) notes.push(`max ${Array.isArray(o.max) ? o.max[0] : o.max}`)
    if (o.maxlength !== undefined) notes.push(`max length ${Array.isArray(o.maxlength) ? o.maxlength[0] : o.maxlength}`)
    if (o.default !== undefined && typeof o.default !== 'function') notes.push(`default ${JSON.stringify(o.default)}`)
    let type = t.instance
    if (t.schema) type = 'Array of subdocuments'
    else if (type === 'Array' && t.caster) type = `Array of ${t.caster.instance}`
    rows.push(`| \`${name}\` | ${type} | ${notes.join('; ')} |`)
    if (t.schema) rows.push(...fieldRows(t.schema, `${name}[].`))
  })
  return rows
}

const buildSchemaDoc = async () => {
  const modelsDir = path.join(backendDir, 'models')
  const models = []
  for (const file of readdirSync(modelsDir).sort()) {
    const mod = await import(pathToFileURL(path.join(modelsDir, file)))
    for (const [exportName, Model] of Object.entries(mod)) {
      if (Model?.schema && Model.modelName) models.push({ file, exportName, Model })
    }
  }
  const relations = []
  const sections = models.map(({ file, exportName, Model }) => {
    const schema = Model.schema
    schema.eachPath((p, t) => {
      const ref = t.options.ref || t.caster?.options?.ref
      if (ref) relations.push(`| ${Model.modelName} | \`${p}\` | ${ref} |`)
      if (t.schema) t.schema.eachPath((cp, ct) => { if (ct.options.ref) relations.push(`| ${Model.modelName} | \`${p}[].${cp}\` | ${ct.options.ref} |`) })
    })
    const ts = schema.options.timestamps
    const tsText = ts === true ? 'createdAt, updatedAt' : ts?.createdAt && !ts.updatedAt ? 'createdAt only' : 'none'
    const indexes = schema.indexes().map(([fields, opts]) => `- \`${formatIndex(fields)}\`${opts.unique ? ' unique' : ''}`)
    return `### ${exportName} (collection \`${Model.collection.collectionName}\`, model name \`${Model.modelName}\`)

${purposeOf(MODEL_PURPOSE, exportName, 'model')}.

Source: \`backend/models/${file}\` · timestamps: ${tsText}

| Field | Type | Rules |
|---|---|---|
${fieldRows(schema).filter((row) => !/^\| `(_id|createdAt|updatedAt)` \|/.test(row)).join('\n')}

Indexes:
${indexes.length ? indexes.join('\n') : '- only `_id`'}`
  })
  const contents = models.map(({ exportName, Model }) => `| [\`${Model.collection.collectionName}\`](#${anchor(`${exportName} collection ${Model.collection.collectionName} model name ${Model.modelName}`)}) | ${purposeOf(MODEL_PURPOSE, exportName, 'model')} |`)
  return `# Database Schema Document

${navLine('Database_Schema_Document.md')}

> Generated from the Mongoose schemas by \`backend/scripts/generateDocs.js\` (run \`npm run docs\` in \`backend/\`). Do not edit by hand: change the model and regenerate.

**${models.length} collections.** Rules that hold for all of them:

- **Strict schemas.** Every schema uses \`strict: 'throw'\` (an unknown field is an error, not silently dropped) and \`versionKey: false\`.
- **Nothing is hard-deleted.** Tickets, assets and articles have \`isDeleted\`; users, departments, categories, vendors and SLA policies have \`isActive\`.
- **Public IDs** (\`TKT-2026-00012\`, \`AST-…\`, \`KB-…\`) come from the \`counters\` collection: one atomic \`$inc\` per ID, keyed by prefix and year (India time), so two requests never get the same number.
- **\`version\`** on tickets, assets and articles is the optimistic-concurrency counter: every status change is a single \`findOneAndUpdate\` that matches the expected status and \`version\` and increments it.
- **Implicit fields.** Every collection has an \`_id\`, and \`createdAt\`/\`updatedAt\` where its "timestamps" line says so; the field tables below leave them out.

| Collection | What it stores |
|---|---|
${contents.join('\n')}

## Relationships

| From | Field | To (model name) |
|---|---|---|
${relations.join('\n')}

## Collections

${sections.join('\n\n')}
`
}

// every string or template literal in frontend/src that names an API path, with the
// method of the axios call around it (useFetch and the CSV download are GETs)
const collectFrontendCalls = (prefixes) => {
  const srcDir = path.join(backendDir, '..', 'frontend', 'src')
  const files = []
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name)
      if (f.isDirectory()) walk(p)
      else if (/\.jsx?$/.test(f.name)) files.push(p)
    }
  }
  walk(srcDir)
  const calls = []
  const literal = /([`'"])(\/(?:[\w.-]+|\$\{[^}]*\})(?:\/(?:[\w.:-]+|\$\{[^}]*\}))*)(?:\?[^`'"]*)?\1/g
  for (const file of files.sort()) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(literal)) {
      const raw = m[2]
      if (!prefixes.some((p) => raw === p || raw.startsWith(p + '/'))) continue
      const before = src.slice(Math.max(0, m.index - 60), m.index)
      const method = before.match(/axiosInstance\s*\.\s*(get|post|put|patch|delete)\(\s*$/)?.[1]?.toUpperCase() ?? 'GET'
      calls.push({ file: path.relative(srcDir, file).split(path.sep).join('/'), method, url: raw.replace(/\$\{[^}]*\}/g, ':param') })
    }
  }
  return calls
}

const literalCount = (p) => p.split('/').filter((x) => x && !x.startsWith(':')).length
const toRegex = (p) => new RegExp('^' + p.replace(/\./g, '\\.').replace(/:[^/]+/g, '[^/]+') + '$')

const buildFrontendDoc = (routers) => {
  const routes = routers.flatMap((r) => r.routes)
  const calls = collectFrontendCalls(routers.map((r) => r.prefix))
  const usedBy = new Map(routes.map((r) => [r, new Set()]))
  const byFile = new Map()
  const unmatched = []
  for (const c of calls) {
    // the most specific route wins, the same way express picks /priority before /:action
    const route = routes.filter((r) => r.method === c.method && toRegex(r.full).test(c.url)).sort((a, b) => literalCount(b.full) - literalCount(a.full))[0]
    if (!route) { unmatched.push(c); continue }
    usedBy.get(route).add(c.file)
    if (!byFile.has(c.file)) byFile.set(c.file, new Set())
    byFile.get(c.file).add(`${route.method} ${route.full}`)
  }
  if (unmatched.length) throw new Error(`frontend calls with no backend route: ${unmatched.map((c) => `${c.method} ${c.url} (${c.file})`).join(', ')}`)
  const notCalled = routes.filter((r) => usedBy.get(r).size === 0)
  const routeRows = routes.map((r) => `| ${r.method} | \`${r.full}\` | ${[...usedBy.get(r)].map((f) => `\`${f}\``).join(', ') || '(not called by the frontend)'} |`)
  const fileRows = [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([f, set]) => `| \`${f}\` | ${[...set].map((x) => `\`${x}\``).join('<br>')} |`)
  return `# Frontend API Integration Guide

${navLine('Frontend_API_Integration_Guide.md')}

> The two tables are generated from the code by \`backend/scripts/generateDocs.js\` (run \`npm run docs\` in \`backend/\`): every API path written in \`frontend/src\` is matched to the Express route that serves it. The script fails if the frontend names a path the backend does not have.

## How the frontend talks to the backend

- **One axios instance** (\`src/axiosInstance.js\`): \`baseURL: '/api'\`, \`withCredentials: true\` (sends the auth cookie), 20-second timeout. A GET that times out, cannot connect, or gets 502/503/504 is retried once after 1.5 s; POST/PATCH/PUT/DELETE are never retried, so nothing is done twice.
- **Waking banner.** Any request pending for more than 4 s shows "Waking the server up…" (\`WakingBanner.jsx\` + \`store/networkStore.js\`), because Render's free tier sleeps.
- **Reads** go through \`useFetch(url, params)\` (\`src/hooks/useFetch.js\`): it returns \`{ data, loading, error, reload }\`, sets \`data\` to the response's \`payload\`, and aborts the request when the page unmounts or the parameters change, so a slow old answer never overwrites a new one. Passing \`null\` as the URL skips the call (used for admin-only extras).
- **Lists** render with \`DataTable\` and ask for \`{ page, limit: 15 }\` (the audit log uses 20). The backend answers \`{ items, total, page, totalPages }\`.
- **Writes** call \`axiosInstance.post/patch/put/delete\` directly in the page and show a toast.
- **Errors** are shown with \`getErrorMessage(err, fallback)\` (\`src/utils/errors.js\`), which prefers the global handler's \`error\` field over its generic \`message\`, and explains timeouts and lost connections in plain words.
- **Status changes** send the \`version\` the page last loaded. On **409** (someone else changed the record first) the ticket, asset and article pages reload the record and say so.
- **Sign-in.** \`RootLayout\` checks the session once on load (\`GET /auth/check-auth\`), and \`ProtectedRoutes\` guards each page; the [frontend README](../frontend/README.md#sign-in-and-role-checks) explains both. The page-level role lists only decide what the app shows; the backend checks every request again.
- **CSV downloads** (\`components/reports/downloadCsv.js\`) fetch the file as a blob with the same cookie and save it in the browser.

## Route → where the frontend calls it

${routes.length} routes, ${routes.length - notCalled.length} called by the frontend. The ${notCalled.length} marked "not called" are API-only today: they answer (see the requests in \`backend/http/\`), but no page uses them yet.

| Method | Route | Called from (\`frontend/src/\`) |
|---|---|---|
${routeRows.join('\n')}

## Page → routes it calls

| File (\`frontend/src/\`) | Calls |
|---|---|
${fileRows.join('\n')}
`
}

const routers = await collectRoutes()
const outputs = {
  'Route_Structure_Document.md': buildRouteDoc(routers),
  'Frontend_API_Integration_Guide.md': buildFrontendDoc(routers),
  'Database_Schema_Document.md': await buildSchemaDoc(),
}

if (process.argv.includes('--check')) {
  const stale = Object.entries(outputs).filter(([name, text]) => {
    try { return readFileSync(path.join(docsDir, name), 'utf8') !== text } catch { return true }
  })
  if (stale.length) {
    console.log(`out of date: ${stale.map(([n]) => n).join(', ')} (run npm run docs)`)
    process.exit(1)
  }
  console.log('docs are up to date')
} else {
  mkdirSync(docsDir, { recursive: true })
  for (const [name, text] of Object.entries(outputs)) {
    writeFileSync(path.join(docsDir, name), text)
    console.log(`wrote docs/${name}`)
  }
}
process.exit(0)
