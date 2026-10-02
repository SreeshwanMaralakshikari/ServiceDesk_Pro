// ADMIN-COMPLETION on a real database: users, departments, categories, SLA
// policies, org settings, the /meta-api lockdown and the audit trail.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { bootApp, loginAs } from '../../testkit/boot.js'
import { createTicket, act } from '../../testkit/helpers.js'

const PW = 'Sup3r-long-password'

describe('admin management (real database)', () => {
  let ctx, admin, mgr, emp, anon, d, c, u
  const J = (v) => JSON.stringify(v)
  const id = (doc) => String(doc._id)
  let counter = 0
  const email = (tag) => `${tag}.${++counter}@t.test`

  // an account made through the admin API, so its password is known
  const makeUser = async (body) => {
    const r = await admin.post('/admin-api/users').send({ firstName: 'Tmp', email: email('tmp'), password: PW, ...body })
    assert.equal(r.status, 201, J(r.body))
    return r.body.payload
  }
  const loginWith = async (who) => {
    const agent = request.agent(ctx.app)
    const r = await agent.post('/auth/login').send({ email: who.email, password: PW })
    assert.equal(r.status, 200, J(r.body))
    return agent
  }
  const audit = async (query) => (await admin.get(`/admin-api/audit-logs?${query}`)).body.payload.items

  before(async () => {
    ctx = await bootApp()
    ;[admin, mgr, emp] = await Promise.all(['admin@t.test', 'mgr.svc@t.test', 'emp@t.test'].map((e) => loginAs(ctx.app, e)))
    anon = request(ctx.app)
    d = ctx.fx.departments; c = ctx.fx.categories; u = ctx.fx.users
  })
  after(() => ctx.stop())

  test('only admins reach /admin-api', async () => {
    assert.equal((await mgr.get('/admin-api/users')).status, 403)
    assert.equal((await emp.get('/admin-api/departments')).status, 403)
    assert.equal((await anon.get('/admin-api/categories')).status, 401)
    assert.equal((await mgr.patch(`/admin-api/users/${id(u.emp)}`).send({ firstName: 'x' })).status, 403)
  })

  test('user list: paginated, filtered, typed; technicians carry their load', async () => {
    const all = (await admin.get('/admin-api/users')).body.payload
    assert.ok(all.total >= 10); assert.equal(all.page, 1); assert.ok(all.items.every((x) => !('password' in x)))
    assert.ok(all.items.length <= 20)
    const techs = (await admin.get('/admin-api/users?role=TECHNICIAN&limit=50')).body.payload.items
    assert.ok(techs.length >= 4 && techs.every((x) => x.role === 'TECHNICIAN' && x.openTickets === 0))
    const byDept = (await admin.get(`/admin-api/users?department=${id(d.infra)}`)).body.payload.items
    assert.deepEqual(byDept.map((x) => x.email), ['tech.infra@t.test'])
    assert.equal((await admin.get('/admin-api/users?q=MIA')).body.payload.items[0].email, 'mgr.svc@t.test')
    assert.equal((await admin.get('/admin-api/users?q=.*')).body.payload.total, 0, 'regex characters are not a pattern')
    assert.equal((await admin.get('/admin-api/users?isActive=false')).body.payload.total, 0)
    // operator-shaped values are ignored, never forwarded to MongoDB
    assert.equal((await admin.get('/admin-api/users?role[$ne]=ADMIN')).body.payload.total, all.total)
    assert.equal((await admin.get('/admin-api/users?role=BOSS')).status, 400)
    assert.equal((await admin.get('/admin-api/users?department=nope')).status, 400)
    assert.equal((await admin.get('/admin-api/users?limit=0')).status, 200)
  })

  test('create user: password rule, duplicates, skills only for technicians, audited', async () => {
    const base = { firstName: 'Cora', role: 'TECHNICIAN', department: id(d.svc) }
    const post = (body) => admin.post('/admin-api/users').send({ email: email('cora'), password: PW, ...base, ...body })
    assert.equal((await post({ password: 'short' })).status, 400)
    assert.equal((await post({ password: 'a'.repeat(73) })).status, 400)
    assert.equal((await post({ password: 123456789012 })).status, 400)
    assert.equal((await post({ role: 'BOSS' })).status, 400)
    assert.equal((await post({ role: 'EMPLOYEE', department: id(d.hr), skills: ['vpn'] })).status, 400, 'skills on an employee')
    assert.equal((await post({ skills: 'vpn' })).status, 400)
    assert.equal((await post({ skills: ['<b>'] })).status, 400)
    assert.equal((await post({ role: 'ASSET_MANAGER', department: id(d.svc) })).status, 400, 'asset managers have no department')
    const ok = await post({ email: 'cora@t.test', skills: [' VPN ', 'Wi  Fi', 'vpn'] })
    assert.equal(ok.status, 201, J(ok.body))
    assert.deepEqual(ok.body.payload.skills, ['vpn', 'wi fi'])
    assert.ok(!('password' in ok.body.payload))
    assert.equal((await post({ email: 'CORA@t.test' })).status, 409, 'same email in another case')
    const entries = await audit('action=USER_CREATED&entityRef=cora@t.test')
    assert.equal(entries.length, 1); assert.ok(!J(entries).includes(PW))
    const login = await request(ctx.app).post('/auth/login').send({ email: 'cora@t.test', password: PW })
    assert.equal(login.status, 200)
  })

  test('edit user: validation, role/department pair, self-protection, manager cleanup, audit', async () => {
    const patch = (who, body) => admin.patch(`/admin-api/users/${id(who)}`).send(body)
    assert.equal((await admin.patch('/admin-api/users/nope').send({ firstName: 'x' })).status, 400)
    assert.equal((await admin.patch('/admin-api/users/64b000000000000000000000').send({ firstName: 'x' })).status, 404)
    const worker = await makeUser({ firstName: 'Wes', role: 'TECHNICIAN', department: id(d.svc), skills: ['vpn'] })
    assert.equal((await patch(worker, {})).status, 400, 'nothing to update')
    assert.equal((await patch(worker, { firstName: '' })).status, 400)
    assert.equal((await patch(worker, { firstName: 5 })).status, 400)
    assert.equal((await patch(worker, { role: 'BOSS' })).status, 400)
    assert.equal((await patch(worker, { department: 5 })).status, 400)
    assert.equal((await patch(worker, { department: id(d.hr) })).status, 400, 'technician into a business department')
    assert.equal((await patch(worker, { department: null })).status, 400, 'technician without a department')
    assert.equal((await patch(worker, { skills: ['ok', 7] })).status, 400)

    const renamed = await patch(worker, { firstName: 'Wesley', lastName: 'West', skills: ['Network', 'wifi'] })
    assert.equal(renamed.status, 200, J(renamed.body))
    assert.equal(renamed.body.payload.firstName, 'Wesley'); assert.deepEqual(renamed.body.payload.skills, ['network', 'wifi'])
    const moved = await patch(worker, { department: id(d.infra) })
    assert.equal(moved.status, 200); assert.equal(moved.body.payload.department._id, id(d.infra))

    // role change: technician -> manager keeps an IT team, drops the skills
    const promoted = await patch(worker, { role: 'MANAGER' })
    assert.equal(promoted.status, 200, J(promoted.body)); assert.deepEqual(promoted.body.payload.skills, [])
    assert.equal((await patch(worker, { skills: ['x'] })).status, 400, 'a manager has no skills')
    // manager of a team who becomes an asset manager: department is dropped and the team loses its manager
    await admin.patch(`/admin-api/departments/${id(d.infra)}`).send({ manager: id(worker) })
    const demoted = await patch(worker, { role: 'ASSET_MANAGER' })
    assert.equal(demoted.status, 200, J(demoted.body)); assert.equal(demoted.body.payload.department ?? null, null)
    const infra = (await admin.get('/admin-api/departments?kind=IT_SUPPORT&limit=50')).body.payload.items.find((x) => x._id === id(d.infra))
    assert.equal(infra.manager ?? null, null, 'the team lost its manager')

    // an employee cannot become a technician without an IT team
    const person = await makeUser({ firstName: 'Pat', role: 'EMPLOYEE', department: id(d.hr) })
    assert.equal((await patch(person, { role: 'TECHNICIAN' })).status, 400)
    assert.equal((await patch(person, { role: 'TECHNICIAN', department: id(d.svc) })).status, 200)

    // you cannot change your own role
    assert.equal((await patch(u.admin, { role: 'MANAGER', department: id(d.svc) })).status, 400)
    assert.equal((await patch(u.admin, { firstName: 'Ava' })).status, 200, 'but you may rename yourself')

    const entries = await audit(`entityRef=${encodeURIComponent(worker.email)}`)
    const kinds = entries.map((e) => e.action)
    assert.ok(kinds.includes('USER_UPDATED') && kinds.includes('USER_ROLE_CHANGED') && kinds.includes('USER_CREATED'), J(kinds))
    const roleChange = entries.find((e) => e.action === 'USER_ROLE_CHANGED' && e.after.role === 'MANAGER')
    assert.equal(roleChange.before.role, 'TECHNICIAN')
  })

  test('a technician with open tickets cannot be moved, demoted or deactivated; an employee with open tickets cannot change role', async () => {
    const tech = await makeUser({ firstName: 'Busy', role: 'TECHNICIAN', department: id(d.svc) })
    const requester = await makeUser({ firstName: 'Req', role: 'EMPLOYEE', department: id(d.hr) })
    const reqAgent = await loginWith(requester)
    const t = await createTicket(reqAgent, id(c.hardware))
    const assigned = await act(mgr, t, 'assign', { technicianId: tech._id })
    assert.equal(assigned.status, 200, J(assigned.body))

    const patch = (who, body) => admin.patch(`/admin-api/users/${who._id}`).send(body)
    for (const body of [{ department: id(d.infra) }, { role: 'MANAGER' }]) {
      const r = await patch(tech, body)
      assert.equal(r.status, 409, J(body)); assert.match(r.body.message, /1 open ticket/)
    }
    assert.equal((await patch(tech, { skills: ['vpn'] })).status, 200, 'skills and names are still editable')
    const off = await admin.patch(`/admin-api/users/${tech._id}/status`).send({ isActive: false })
    assert.equal(off.status, 409); assert.match(off.body.message, /reassign/)
    const loads = (await admin.get('/admin-api/users?role=TECHNICIAN&limit=50')).body.payload.items
    assert.equal(loads.find((x) => x._id === tech._id).openTickets, 1)

    assert.equal((await patch(requester, { role: 'ASSET_MANAGER' })).status, 409, 'employee with an open ticket')

    // once the ticket is reassigned the technician can be moved
    const current = (await mgr.get(`/ticket-api/tickets/${t.publicId}`)).body.payload
    assert.equal((await act(mgr, current, 'reassign', { technicianId: id(u.techSvc) })).status, 200)
    assert.equal((await patch(tech, { department: id(d.infra) })).status, 200)
    assert.equal((await admin.patch(`/admin-api/users/${tech._id}/status`).send({ isActive: false })).status, 200)
  })

  test('status: validation, self, reactivation into an inactive department, effect on the next request', async () => {
    const status = (userId, body) => admin.patch(`/admin-api/users/${userId}/status`).send(body)
    assert.equal((await status('nope', { isActive: false })).status, 400)
    assert.equal((await status('64b000000000000000000000', { isActive: false })).status, 404)
    assert.equal((await status(id(u.admin), { isActive: false })).status, 400, 'self')
    const victim = await makeUser({ firstName: 'Vic', role: 'EMPLOYEE', department: id(d.hr) })
    assert.equal((await status(victim._id, { isActive: 'false' })).status, 400)
    const agent = await loginWith(victim)
    assert.equal((await agent.get('/ticket-api/tickets')).status, 200)
    assert.equal((await status(victim._id, { isActive: false })).status, 200)
    assert.equal((await agent.get('/ticket-api/tickets')).status, 401, 'deactivated users are rejected on their next request')
    assert.equal((await status(victim._id, { isActive: true })).status, 200)

    // reactivating into an inactive department is refused
    const lonely = await admin.post('/admin-api/departments').send({ name: 'Legal', code: 'LEG', kind: 'BUSINESS' })
    const member = await makeUser({ firstName: 'Lee', role: 'EMPLOYEE', department: lonely.body.payload._id })
    assert.equal((await status(member._id, { isActive: false })).status, 200)
    assert.equal((await admin.patch(`/admin-api/departments/${lonely.body.payload._id}`).send({ isActive: false })).status, 200)
    const back = await status(member._id, { isActive: true })
    assert.equal(back.status, 409); assert.match(back.body.message, /department is inactive/)
  })

  test('departments: list with counts, create validation, duplicates, immutable kind, manager rules, deactivation rules', async () => {
    const list = (await admin.get('/admin-api/departments?limit=50')).body.payload
    const svc = list.items.find((x) => x._id === id(d.svc))
    assert.ok(svc.activeUsers >= 3 && svc.activeCategories >= 2, J(svc))
    assert.equal((await admin.get('/admin-api/departments?kind=NOPE')).status, 400)
    assert.ok((await admin.get('/admin-api/departments?kind=BUSINESS')).body.payload.items.every((x) => x.kind === 'BUSINESS'))

    const post = (body) => admin.post('/admin-api/departments').send(body)
    assert.equal((await post({ name: 'X', code: 'FIN', kind: 'BUSINESS' })).status, 400, 'name too short')
    assert.equal((await post({ name: 'Finance', code: 'F', kind: 'BUSINESS' })).status, 400, 'code too short')
    assert.equal((await post({ name: 'Finance', code: 'FIN', kind: 'OTHER' })).status, 400)
    assert.equal((await post({ name: 'Finance', code: 'FIN' })).status, 400)
    assert.equal((await post({ name: { $ne: 1 }, code: 'FIN', kind: 'BUSINESS' })).status, 400)
    assert.equal((await post({ name: 'Finance', code: 'FIN', kind: 'BUSINESS', manager: id(u.mgrSvc) })).status, 400)
    const fin = await post({ name: 'Finance', code: 'fin', kind: 'BUSINESS' })
    assert.equal(fin.status, 201, J(fin.body)); assert.equal(fin.body.payload.code, 'FIN')
    assert.equal((await post({ name: 'FINANCE', code: 'FN2', kind: 'BUSINESS' })).status, 409, 'name, any case')
    assert.equal((await post({ name: 'Finance 2', code: 'FIN', kind: 'BUSINESS' })).status, 409, 'code')

    const patch = (dept, body) => admin.patch(`/admin-api/departments/${dept}`).send(body)
    assert.equal((await patch('nope', { name: 'Zed' })).status, 400)
    assert.equal((await patch('64b000000000000000000000', { name: 'Zed' })).status, 404)
    assert.equal((await patch(fin.body.payload._id, {})).status, 400)
    assert.equal((await patch(fin.body.payload._id, { kind: 'IT_SUPPORT' })).status, 400, 'kind is fixed')
    assert.equal((await patch(fin.body.payload._id, { kind: 'BUSINESS', name: 'Finance Dept' })).status, 200, 'same kind is fine')
    assert.equal((await patch(fin.body.payload._id, { name: 'Human Resources' })).status, 409)
    assert.equal((await patch(fin.body.payload._id, { code: 'HR' })).status, 409)
    assert.equal((await patch(fin.body.payload._id, { manager: id(u.mgrSvc) })).status, 400, 'business teams have no manager')

    assert.equal((await patch(id(d.svc), { manager: id(u.techSvc) })).status, 400, 'a technician cannot manage')
    assert.equal((await patch(id(d.svc), { manager: 'nope' })).status, 400)
    assert.equal((await patch(id(d.infra), { manager: id(u.mgrSvc) })).status, 400, 'the manager must belong to this team')
    const set = await patch(id(d.svc), { manager: id(u.mgrSvc) })
    assert.equal(set.status, 200, J(set.body)); assert.equal(set.body.payload.manager._id, id(u.mgrSvc))
    assert.equal((await patch(id(d.svc), { manager: null })).status, 200)
    assert.equal((await patch(id(d.svc), { manager: id(u.mgrSvc) })).status, 200)

    // deactivation: refused while people, categories or open tickets use it
    const blocked = await patch(id(d.svc), { isActive: false })
    assert.equal(blocked.status, 409); assert.match(blocked.body.message, /active user/)
    assert.equal((await patch(id(d.svc), { isActive: 'no' })).status, 400)
    assert.equal((await patch(fin.body.payload._id, { isActive: false })).status, 200, 'empty department')
    assert.equal((await post({ name: 'Finance Dept', code: 'FND', kind: 'BUSINESS' })).status, 409, 'inactive departments still reserve the name')
    assert.equal((await anon.get('/meta-api/departments')).body.payload.some((x) => x._id === fin.body.payload._id), false)
    assert.equal((await patch(fin.body.payload._id, { isActive: true })).status, 200)

    const kinds = (await audit('entityType=DEPARTMENT&limit=50')).map((e) => e.action)
    assert.ok(kinds.includes('DEPARTMENT_CREATED') && kinds.includes('DEPARTMENT_UPDATED'))
  })

  test('categories: create validation, duplicates, flags, skills, 404, team change and deactivation need no open tickets', async () => {
    const post = (body) => admin.post('/admin-api/categories').send(body)
    const good = { name: 'VPN Access', department: id(d.infra), defaultPriority: 'high', skills: ['VPN'], autoAssign: true }
    assert.equal((await post({ ...good, name: 'x' })).status, 400)
    assert.equal((await post({ ...good, name: undefined })).status, 400)
    assert.equal((await post({ ...good, department: id(d.hr) })).status, 400, 'a business department cannot handle tickets')
    assert.equal((await post({ ...good, department: 'nope' })).status, 400)
    assert.equal((await post({ ...good, department: undefined })).status, 400)
    assert.equal((await post({ ...good, defaultPriority: 'TEST' })).status, 400, 'staff-only priority')
    assert.equal((await post({ ...good, defaultPriority: 'RETIRED' })).status, 400, 'inactive priority')
    assert.equal((await post({ ...good, defaultPriority: 'NOPE' })).status, 400)
    assert.equal((await post({ ...good, ticketType: 'QUESTION' })).status, 400)
    assert.equal((await post({ ...good, autoAssign: 'yes' })).status, 400)
    assert.equal((await post({ ...good, requiresApproval: 1 })).status, 400)
    assert.equal((await post({ ...good, skills: 'vpn' })).status, 400)
    assert.equal((await post({ ...good, description: 5 })).status, 400)
    const vpn = await post(good)
    assert.equal(vpn.status, 201, J(vpn.body))
    assert.equal(vpn.body.payload.defaultPriority, 'HIGH'); assert.deepEqual(vpn.body.payload.skills, ['vpn']); assert.equal(vpn.body.payload.autoAssign, true)
    assert.equal((await post({ ...good, name: 'vpn access' })).status, 409)

    const defaults = await post({ name: 'Printers', department: id(d.svc) })
    assert.equal(defaults.body.payload.autoAssign, false); assert.equal(defaults.body.payload.defaultPriority, 'MEDIUM')

    const list = (await admin.get('/admin-api/categories?limit=50')).body.payload
    assert.ok(list.items.length >= 5 && list.items[0].department.name)
    assert.equal((await admin.get(`/admin-api/categories?department=${id(d.infra)}&isActive=true&q=vpn`)).body.payload.total, 1)
    assert.equal((await admin.get('/admin-api/categories?department=nope')).status, 400)

    const patch = (cat, body) => admin.patch(`/admin-api/categories/${cat}`).send(body)
    assert.equal((await patch('nope', { name: 'Zed' })).status, 400)
    assert.equal((await patch('64b000000000000000000000', { name: 'Zed' })).status, 404, 'F-050: used to answer 200 with null')
    assert.equal((await patch(vpn.body.payload._id, {})).status, 400)
    assert.equal((await patch(vpn.body.payload._id, { name: 'Hardware' })).status, 409)
    assert.equal((await patch(vpn.body.payload._id, { defaultPriority: 'TEST' })).status, 400)
    assert.equal((await patch(vpn.body.payload._id, { autoAssign: null })).status, 400)
    const edited = await patch(vpn.body.payload._id, { name: 'VPN & Remote Access', autoAssign: false, skills: ['vpn', 'remote'], description: 'Remote access issues' })
    assert.equal(edited.status, 200, J(edited.body)); assert.equal(edited.body.payload.autoAssign, false)

    // an open ticket pins the category's team and keeps it active
    const t = await createTicket(emp, id(vpn.body.payload))
    assert.ok(t.publicId)
    const move = await patch(vpn.body.payload._id, { department: id(d.svc) })
    assert.equal(move.status, 409); assert.match(move.body.message, /open ticket/)
    assert.equal((await patch(vpn.body.payload._id, { isActive: false })).status, 409)
    assert.equal((await patch(vpn.body.payload._id, { department: id(d.infra), description: 'Remote access' })).status, 200, 'same team is not a change')
    // an unused category can move and be switched off
    assert.equal((await patch(defaults.body.payload._id, { department: id(d.infra) })).status, 200)
    assert.equal((await patch(defaults.body.payload._id, { isActive: false })).status, 200)
    assert.equal((await patch(defaults.body.payload._id, { isActive: true })).status, 200)

    const kinds = (await audit('entityType=CATEGORY&limit=50')).map((e) => e.action)
    assert.ok(kinds.includes('CATEGORY_CREATED') && kinds.includes('CATEGORY_UPDATED'))
  })

  test('SLA policies: list with inactive, create validation, immutable code/level, deactivation guards, 404', async () => {
    const list = (await admin.get('/admin-api/sla-policies')).body.payload
    assert.ok(list.items.some((p) => p.priority === 'RETIRED' && p.isActive === false))
    assert.deepEqual(list.items.map((p) => p.level), [...list.items.map((p) => p.level)].sort((a, b) => a - b))

    const post = (body) => admin.post('/admin-api/sla-policies').send(body)
    const good = { priority: 'urgent', label: 'Urgent', level: 4, color: '#ff0000', responseTimeHours: 1, resolutionTimeHours: 2 }
    for (const bad of [
      { priority: '1x' }, { priority: 5 }, { label: '' }, { level: 1.5 }, { level: -1 }, { level: 11 }, { level: '4' },
      { responseTimeHours: 0 }, { resolutionTimeHours: 0.5 }, { responseTimeHours: '1' }, { color: 'red' }, { businessHoursOnly: 'yes' },
    ]) assert.equal((await post({ ...good, ...bad })).status, 400, J(bad))
    assert.equal((await post({ ...good, priority: 'HIGH' })).status, 409, 'duplicate code')
    assert.equal((await post({ ...good, level: 3 })).status, 409, 'duplicate level')
    const urgent = await post(good)
    assert.equal(urgent.status, 201, J(urgent.body)); assert.equal(urgent.body.payload.priority, 'URGENT')

    const patch = (pol, body) => admin.patch(`/admin-api/sla-policies/${pol}`).send(body)
    assert.equal((await patch('nope', { label: 'x' })).status, 400)
    assert.equal((await patch('64b000000000000000000000', { label: 'x' })).status, 404, 'F-050')
    assert.equal((await patch('64b000000000000000000000', { isActive: false })).status, 404, 'F-050: no false 409')
    assert.equal((await patch(urgent.body.payload._id, {})).status, 400)
    assert.equal((await patch(urgent.body.payload._id, { responseTimeHours: 5 })).status, 400, 'response above resolution')
    assert.equal((await patch(urgent.body.payload._id, { resolutionTimeHours: 0 })).status, 400)
    assert.equal((await patch(urgent.body.payload._id, { color: 'blue' })).status, 400)
    const edited = await patch(urgent.body.payload._id, { label: 'Very urgent', responseTimeHours: 0.5, resolutionTimeHours: 3, priority: 'NEW', level: 9 })
    assert.equal(edited.status, 200, J(edited.body))
    assert.equal(edited.body.payload.priority, 'URGENT', 'code is immutable'); assert.equal(edited.body.payload.level, 4, 'level is immutable')
    assert.equal(edited.body.payload.responseTimeHours, 0.5)

    // guards: a category default, then an open ticket
    const spare = await post({ priority: 'SPARE', label: 'Spare', level: 6, responseTimeHours: 1, resolutionTimeHours: 2 })
    await admin.patch(`/admin-api/categories/${id(c.hardware)}`).send({ defaultPriority: 'SPARE' })
    const byCategory = await patch(spare.body.payload._id, { isActive: false })
    assert.equal(byCategory.status, 409); assert.match(byCategory.body.message, /default of/)
    const medium = (await admin.get('/admin-api/sla-policies')).body.payload.items.find((p) => p.priority === 'MEDIUM')
    await admin.patch(`/admin-api/categories/${id(c.hardware)}`).send({ defaultPriority: 'LOW' })
    const t = await createTicket(emp, id(c.hardware), { priority: 'medium' })
    assert.equal(t.priority, 'MEDIUM')
    const byTicket = await patch(medium._id, { isActive: false })
    assert.equal(byTicket.status, 409); assert.match(byTicket.body.message, /open ticket/)
    // unused policies switch off and on again
    assert.equal((await patch(urgent.body.payload._id, { isActive: false })).status, 200)
    assert.ok(!(await anon.get('/meta-api/priorities')).body.payload)
    assert.equal((await patch(urgent.body.payload._id, { isActive: true })).status, 200)
    const retired = list.items.find((p) => p.priority === 'RETIRED')
    assert.equal((await patch(retired._id, { isActive: true })).status, 200)

    const kinds = (await audit('entityType=SLA_POLICY&limit=50')).map((e) => e.action)
    assert.ok(kinds.includes('SLA_POLICY_CREATED') && kinds.includes('SLA_POLICY_UPDATED'))
  })

  test('org settings: every invalid shape is refused, a valid change is stored and audited', async () => {
    const put = (body) => admin.put('/admin-api/org-settings').send(body)
    const before = (await admin.get('/admin-api/org-settings')).body.payload
    for (const bad of [
      { businessHours: { days: [] } }, { businessHours: { days: [7] } }, { businessHours: { days: 'mon' } },
      { businessHours: { start: '9am' } }, { businessHours: { end: '24:00' } }, { businessHours: { start: '18:00' } },
      { businessHours: { start: '10:00', end: '09:00' } }, { businessHours: 'always' }, { businessHours: [1] },
      { orgName: '' }, { orgName: 5 }, { orgName: 'x'.repeat(81) },
    ]) assert.equal((await put(bad)).status, 400, J(bad))
    const stillSame = (await admin.get('/admin-api/org-settings')).body.payload
    assert.deepEqual(stillSame.businessHours, before.businessHours, 'nothing was half applied')

    const ok = await put({ orgName: '  Acme IT  ', businessHours: { days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '20:00' } })
    assert.equal(ok.status, 200, J(ok.body))
    assert.equal(ok.body.payload.orgName, 'Acme IT'); assert.deepEqual(ok.body.payload.businessHours.days, [1, 2, 3, 4, 5, 6])
    assert.equal((await put({})).status, 200, 'an empty body changes nothing')
    const e = (await audit('entityType=ORG_SETTINGS')).find((x) => x.after.orgName === 'Acme IT')
    assert.equal(e.before.businessHours.start, '09:00'); assert.equal(e.after.businessHours.end, '20:00')
    await put({ orgName: 'ServiceDesk Pro', businessHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' } })
  })

  test('/meta-api: only business departments are public; categories and priorities need a login and hide admin-only fields', async () => {
    const depts = (await anon.get('/meta-api/departments?kind=IT_SUPPORT')).body.payload
    assert.ok(depts.length >= 1 && depts.every((x) => x.kind === 'BUSINESS'), 'the kind parameter cannot expose IT teams')
    assert.equal((await anon.get('/meta-api/categories')).status, 401)
    assert.equal((await anon.get('/meta-api/priorities')).status, 401)
    const cats = (await emp.get('/meta-api/categories')).body.payload
    assert.ok(cats.length >= 3)
    assert.ok(cats.every((x) => !('autoAssign' in x) && !('skills' in x)), 'routing internals stay private')
    assert.ok((await emp.get('/meta-api/priorities')).body.payload.length >= 3)
  })

  test('dashboard: rejected tickets are not "open" (F-031)', async () => {
    const before = (await admin.get('/admin-api/dashboard')).body.payload
    const t = await createTicket(emp, id(c.newHardware))
    const rejected = await act(mgr, t, 'reject', { note: 'no budget' })
    assert.equal(rejected.status, 200, J(rejected.body))
    const after = (await admin.get('/admin-api/dashboard')).body.payload
    assert.equal(after.totalTickets, before.totalTickets + 1)
    assert.equal(after.openTickets, before.openTickets, 'a rejected ticket is finished')
  })
})
