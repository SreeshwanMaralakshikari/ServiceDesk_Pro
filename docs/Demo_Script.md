# ServiceDesk Pro: demo script

[README](../README.md) · [Backend](../backend/README.md) · [Frontend](../frontend/README.md) · [Routes](Route_Structure_Document.md) · [Database](Database_Schema_Document.md) · [Frontend ↔ API](Frontend_API_Integration_Guide.md) · **Demo script**

A 15-minute walkthrough of all five roles on the live site, in an order where each step sets up the next. Each step lists **what to click**, **what to point out**, and a **fallback** if something looks different.

Live app: https://service-desk-pro-one.vercel.app

## Before the demo (10 minutes ahead)

1. **Wake the backend.** Open https://service-desk-pro-one.vercel.app/api/health and wait for `"db":"up"` with both cron jobs `"running"`. The free tier sleeps, and the first request can take up to a minute. While it wakes, the app shows a "Waking the server up…" banner.
2. **Have the live passwords ready.** They are not in this repository and not on the login page.
3. **Open one private window per role**, or use one window and log out between steps: Admin `admin@sdp.test`, Manager `manager@sdp.test` (Mia, Service Desk), Technician `tech@sdp.test` (Theo, Service Desk), Employee `employee@sdp.test` (Eli, Engineering), Asset manager `assets@sdp.test` (Amy).
4. **Check Theo's skills.** In Admin › Users, Theo's skills should be `hardware, laptop, printer`. If they are empty, add them, so auto-assign and "Suggested technician" can pick him for hardware.
5. **Set dashboards to "Last 90 days".** The demo tickets were seeded weeks ago. Old demo tickets show red SLA badges. That is expected: their deadlines really have passed.

## 1. Admin: start a live SLA clock (1 min)

- Log in as **Admin**. Go to **My Tickets › + New ticket**.
- Title `VPN drops every few minutes`, category **Software**, priority **Test (fast demo)**, then **Submit ticket**.
- **Point out:** the new ID (`TKT-2026-…`, the next number with no gaps) and "Assigned to: … (auto-assigned)". The Test priority answers in about 1 minute and resolves in about 3, in real time instead of business hours. We come back to it at the end.
- *Fallback:* if no "Test (fast demo)" option is shown, you are not logged in as Admin. The server accepts that priority only from an admin.

## 2. Employee: raise tickets with AI help (2 min)

- Log in as **Employee** (Eli). **+ New ticket**, then type title `Laptop screen flickers` and description `My Dell laptop screen flickers and goes black when I move the lid.`
- Click **✨ Suggest category & priority**. **Point out:** it fills in **Hardware** and a priority.
  - With a Groq key it says "AI suggestion" and adds a one-line probable issue.
  - Without one it says "Best-effort suggestion (AI unavailable right now)". The offline fallback matches the text against category names and their skill tags (here `laptop`, a Hardware tag) and picks the priority from urgent words. When nothing matches, it says so and leaves the choice to you. It never guesses at random.
- **Submit ticket.** **Point out:** it is auto-assigned to the least-loaded Service Desk technician with matching skills.
- Create a second ticket in **New Hardware Request** (`Need a second monitor`). **Point out:** status **PENDING_APPROVAL**, and no SLA clock runs until a manager approves.
- **Point out:** Eli sees only his own tickets. The nav has no Admin, Approvals, Assets or Reports links.

## 3. Manager: approve, assign, prioritise (2 min)

- Log in as **Manager** (Mia). Open **Approvals**, open the monitor request and click **Approve**. Eli gets a notification.
- Open Eli's laptop ticket. A **Suggested:** line names the best technician, picked by a min-heap (lowest open load, then matching skills), with a **Use suggestion** link. The technician list holds only Service Desk technicians, with their open-ticket counts. Pick **Theo** and click **Reassign**.
- **Point out** the timeline line "reassigned to Theo Tech". Then use **Change priority…**, pick another level and click **Apply**. The SLA due dates are recalculated from the same start time.
- Open **Dashboard** (Last 90 days). **Point out** SLA compliance, live breached/at-risk/unassigned counts, created vs resolved, CSAT and technician workload. **Reports:** filter by priority, then **Download CSV** (the download is recorded in the audit log).

## 4. Technician: work the ticket (3 min)

- Log in as **Technician** (Theo). Open **My Queue**. **Point out:** it is ordered by SLA urgency (breached, at risk, on track), then by due date. That is a priority queue built on a heap.
- Open the laptop ticket and click **Start work**. In **Work log**, enter `Reseated display cable` and `25` minutes, then **Add**.
- Tick **Internal note (hidden from requester)**, type `Cable was loose, ordered a spare.` and click **Post comment**.
- **Point out:** **Suggested knowledge base articles** (text search, re-ranked by the AI when a key is set). The **Similar tickets** panel (Jaccard similarity over the team's recent tickets, 20% or more) appears only when there is a close match. A brand-new ticket may have none. If so, show it on an older ticket such as "Laptop will not power on after update".
- Type a resolution summary, `Display cable reseated and tested with the user.`, and click **Resolve**.
- **Knowledge Base › + New article:** write a short "Laptop screen flicker" article and save it. On the article page that opens, click **Request review**. The managers are notified.

## 5. Employee: confirm and rate (1 min)

- Back as **Employee**. The bell shows unread notifications (approved, resolved). Click the resolved one.
- **Point out:** the **Resolution** box shows Theo's summary. The internal note is **not** shown: the server never sends internal notes to employees.
- Click **Confirm & close**, then pick **5 stars**, add an optional comment and click **Submit rating**.
- *Optional:* **Reopen** needs a reason and works for 7 days after closing.

## 6. Manager: publish the article (30 s)

- As **Manager**, go to **Knowledge Base › Pending review**, open Theo's draft and click **Publish**. Employees now see it. Before, they could not.

## 7. Asset manager: asset lifecycle (2 min)

- Log in as **Asset manager** (Amy). It lands on **Asset Stats** (totals, warranty ending soon or expired, purchase and maintenance value, charts by status, class and vendor, **Download CSV**).
- **Assets › + New asset:** `Dell Latitude 7450`, type Hardware, class Laptop, vendor **None** or Dell, warranty date about 20 days from today, then save. **Point out** the `AST-2026-…` ID.
- On the asset page, click **Activate (put in stock)**, then **Assign** to Eli. Eli's **My Assets** page now lists it.
- Click **Edit details**, set Location to `Floor 3, desk 12` and save. **Point out:** status and assignee are not in this form; they change only through the lifecycle actions, so the history stays complete.
- **Point out:** the lifecycle history at the bottom, the **Show warranty expiring** filter on the asset list, and **Vendors**.
- *Optional:* **Send for repair**, then **Reinstate to owner**. Or **Replace** with another in-stock unit, which updates both assets in one transaction.

## 8. Admin: SLA breach, configuration, audit (3 min)

- Back as **Admin**, open the **Test** ticket from step 1 (3+ minutes have passed). **Point out:** the SLA badge is now breached, and the bell has the "Resolution SLA breached" and "escalated" notifications (they go to the team's managers and every admin). A cron job checks every 5 minutes, and opening the ticket checks it immediately.
- Still on the Test ticket, under **Related asset**, type the laptop's `AST-2026-…` ID and click **Link**. **Point out:** an employee can only pick their own assets here; staff can link any asset, and each link is audited.
- **Admin** pages:
  - **Users:** role and department must match. A technician cannot be put in a business department.
  - **Categories:** handling team, approval, auto-assign, required skills.
  - **SLA policies:** response and resolution hours per priority.
  - **Business hours.**
  - **Audit log:** filter by entity, e.g. ticket assignments and asset links, KB publish, report exports.
- **Point out:** deactivating a user or a team with open tickets is refused with an explanation, so no ticket is stranded.

## 9. Security in 30 seconds

- As **Employee**, type `/admin` in the address bar: it shows **403 — Not authorized**. The backend checks the role on every request too, not just the page.
- Log out. `/tickets` now redirects to the login page. Refreshing any deep link while logged in keeps the session (cookie auth through the `/api` rewrite).
- *Optional, to show concurrency:* open the same assigned ticket as Mia in two tabs, reassign it in one, then reassign it in the other. The second tab shows "This ticket changed. Reloading…" and reloads, instead of overwriting. The API answered 409 because its `version` was stale.

## If something goes wrong

| What you see | What to do |
|---|---|
| Spinner or "Waking the server up…" for a long time | The backend is cold. Wait up to a minute, then refresh. |
| A new ticket is auto-assigned to Ravi, not Theo | Normal: auto-assign picks the least-loaded skilled technician. Reassign as Mia (step 3), which also shows the suggestion feature. |
| The AI says "Best-effort suggestion" and picks no category | The Groq key is not set or the call failed, and no category name or skill tag appears in the text. Pick **Hardware** yourself. The fallback refuses to guess. |
| A dashboard looks thin | Switch to "Last 90 days". The seeded tickets are older than 30 days. |
| Old demo tickets are red | Their SLA deadlines really have passed since seeding. Use the step 1 Test ticket to show a live clock. |
| "This ticket changed. Reloading…" | Another window changed the ticket first, and the page reloads it. That is the optimistic-concurrency check working. Repeat the action. |

## Talking points (if asked)

- **Architecture:** React + Vite on Vercel, Express 5 + Mongoose 9 on Render, MongoDB Atlas. The browser calls `/api` on the Vercel domain, and Vercel forwards to Render, so the auth cookie is first-party.
- **Correctness:** every status change is one atomic `findOneAndUpdate` guarded by status and `version`, driven by one transition table per workflow (tickets, assets, KB).
- **DSA:** min-heap auto-assign and suggested technician, a heap-based smart queue, Jaccard similar tickets, and a k-way merge for the timeline. All are hand-written, in `backend/utils/dsa/`.
- **SLA:** business-hours maths in India time, a pause on hold, a warning at 75%, then breach and escalation. A cron job and a lazy check mean nothing is missed while the server sleeps.
- **Testing:** 230 unit tests, 140 integration tests on a real MongoDB (mongodb-memory-server), and a QA suite that cross-checks every frontend API call against the backend routes.
