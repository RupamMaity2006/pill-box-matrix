# Pillbox backend

A REST API + SQLite database for the Pillbox dashboard. Replaces the
frontend's in-memory JS arrays (`medicines`, `schedule`, `alerts`,
`history`, `caregivers`) with real, persistent, per-user data.

## 1. Run it

```bash
npm install
cp .env.example .env      # then edit JWT_SECRET to something random
npm start                 # -> http://localhost:4000
```

The first request creates `pillbox.sqlite` in this folder automatically —
no separate database server needed.

## 2. Try it with curl

```bash
# Create an account
curl -X POST http://localhost:4000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@example.com","password":"secret123"}'
# -> { "token": "...", "user": {...} }

# Use the token for everything else
TOKEN="paste-the-token-here"

curl -X POST http://localhost:4000/api/medicines \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Medicine A","dose":"1 Tablet","time":"08:00","compartment":1,"stock":10}'

curl http://localhost:4000/api/medicines -H "Authorization: Bearer $TOKEN"
```

## 3. API reference

All routes except `/api/auth/*` require `Authorization: Bearer <token>`.
Every response is scoped to the logged-in user — there's no way to see
someone else's medicines.

| Method | Path                  | Purpose                              |
|--------|-----------------------|---------------------------------------|
| POST   | /api/auth/signup      | Create account, returns token         |
| POST   | /api/auth/login       | Log in, returns token                 |
| GET    | /api/medicines        | List medicines                        |
| POST   | /api/medicines        | Add medicine (also adds to schedule)  |
| PUT    | /api/medicines/:id    | Rename / edit a medicine              |
| DELETE | /api/medicines/:id    | Remove a medicine + its schedule rows |
| GET    | /api/schedule?date=   | Today's (or a given date's) schedule  |
| POST   | /api/schedule         | Add a schedule item                   |
| PUT    | /api/schedule/:id     | Edit, or mark taken/missed            |
| DELETE | /api/schedule/:id     | Remove a schedule item                |
| GET    | /api/alerts           | List active alerts                    |
| POST   | /api/alerts           | Add a custom alert/reminder           |
| DELETE | /api/alerts/:id       | Dismiss one alert                     |
| DELETE | /api/alerts           | Dismiss all (mark all as read)        |
| GET    | /api/history?limit=   | Adherence history log                 |
| DELETE | /api/history/:id      | Remove a mis-logged entry             |
| GET    | /api/caregivers       | List caregivers                       |
| POST   | /api/caregivers       | Invite a caregiver                    |
| DELETE | /api/caregivers/:id   | Remove a caregiver (not the owner)    |

## 4. Wiring the frontend to this API

In `pillbox-dashboard.html`, the arrays at the top of the `<script>`
(`let medicines = [...]`, `let schedule = [...]`, etc.) are exactly what
you're replacing. The pattern for every entity is the same:

1. On page load, `fetch()` the list instead of hardcoding it, then render.
2. On add/edit/delete, `fetch()` the write, then re-fetch (or update the
   local array from the response) and re-render — same `renderAll()`
   calls you already have.

```js
const API = 'http://localhost:4000/api';
const token = localStorage.getItem('pillbox_token'); // saved at login
const authHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
};

// Load on startup
async function loadMedicines() {
  const res = await fetch(`${API}/medicines`, { headers: authHeaders });
  medicines = await res.json();
  renderAll();
}

// Replace the body of the medForm submit handler with:
async function saveMedicine(payload, editingId) {
  const url = editingId ? `${API}/medicines/${editingId}` : `${API}/medicines`;
  const method = editingId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: authHeaders, body: JSON.stringify(payload) });
  if (!res.ok) { showToast('Something went wrong.'); return; }
  await loadMedicines();       // refresh from the server
  await loadSchedule();        // adding a medicine also touches the schedule
}

// Delete
async function deleteMedicine(id) {
  await fetch(`${API}/medicines/${id}`, { method: 'DELETE', headers: authHeaders });
  await loadMedicines();
  await loadSchedule();
}
```

Do the same for `schedule`, `alerts`, `history`, and `caregivers` —
each gets a `loadX()` on startup and a `fetch()` call inside its
existing add/edit/delete handlers, replacing the direct array
mutation. Note about `localStorage`: that's fine in a real deployed
site, but if you paste the dashboard back into a Claude.ai artifact,
swap it for an in-memory variable — artifacts can't use browser storage.

You'll also need a simple login screen (email + password form) that
calls `/api/auth/login` or `/api/auth/signup` and stores the returned
token before the dashboard loads.

## 5. Deploying

- **Fastest path:** Railway, Render, or Fly.io — all support Node +
  a persistent disk for the SQLite file with a few clicks.
- **If you want to keep it serverless:** swap `better-sqlite3` for a
  hosted Postgres (e.g. Supabase or Neon) and use `pg` instead — the
  route files barely change since the SQL is already isolated in
  `db.js`.
- Set `JWT_SECRET` to a real random value in production, and restrict
  `cors()` to your actual frontend origin instead of allowing all.

## 6. Data model

```
users            medicines           schedule_items
├─ id            ├─ id               ├─ id
├─ name          ├─ user_id  ───┐    ├─ user_id
├─ email         ├─ name        │    ├─ medicine_id ──┐
└─ password_hash ├─ dose        │    ├─ med_name       │ (nullable —
                 ├─ time        │    ├─ dose            │  survives
                 ├─ compartment │    ├─ time             │  medicine
                 ├─ stock       │    ├─ instruction       │  deletion)
                 ├─ days_left   │    ├─ status            │
                 └─ status      │    └─ for_date          │
                                 └────────────────────────┘
alerts               history              caregivers
├─ id                ├─ id                ├─ id
├─ user_id           ├─ user_id           ├─ user_id
├─ type              ├─ medicine_name     ├─ name
├─ title             ├─ scheduled_at      ├─ relation
├─ description        ├─ taken_at          ├─ notify_via
└─ created_at         ├─ status            ├─ status
                       └─ log_date          └─ removable
```
