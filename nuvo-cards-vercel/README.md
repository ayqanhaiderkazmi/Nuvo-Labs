# Nuvo Labs · Cards

Work-card tracker for the team: pick a card, run the timer, submit it, get it checked.
Points and reliability are worked out from the cards, and the bonus tracker splits the bonus pool by points.

- `backend/`  Node API (deploys to Vercel as a serverless function). One dependency (`pg`). Postgres on Render, SQLite when running locally.
- `frontend/` Plain HTML, CSS and JavaScript (deploys to Vercel). No build step.

## What it does

| Area | What it does |
|---|---|
| Board | Cards in five columns: To pick, Picked, In progress, Waiting for check, Done. Filter by person, role, client or internal. Flags: Late, Unpicked 48h+, Timer running. |
| Card | Title, goal, role, client or internal, owner, due date, planned hours, points. Start/stop timer, submit, check, full history. |
| Rules | Only admins create cards. Anyone can pick an unowned card. Only the owner logs time. You cannot check your own work. Ayqan (admin) checks everyone. Cards Ayqan owns are checked by another team member. |
| Reliability | Cards submitted on time ÷ cards due in the month. Submit time counts, not check time. |
| Points | Count only after the check passes, in the month the check passed. |
| Dashboard | Per person: cards due, on time, reliability, planned vs logged hours, cards done, points. Hours by role. |
| Bonus tracker | Bonus pool ÷ total points = money per point. Sourcing cuts and a Paid box per person. Cents add up exactly to the pool. |
| Team | Admins add people, reset passwords, deactivate. |

The split of the 70% shares pool is not built in yet, because the method is still being decided.

## Deploy (everything on Vercel)

You make **two Vercel projects** from the same GitHub repo.

### 1. Backend project
1. Vercel -> **Add New Project** -> pick the repo -> **Root Directory: `backend`** -> Framework: **Other** -> Deploy (it may fail the first time, that is fine, no database yet).
2. Project -> **Storage** -> **Create Database** -> **Neon (Postgres)** -> connect it to the project. This adds `DATABASE_URL` for you.
3. Project -> **Settings -> Environment Variables**, add:
   - `JWT_SECRET`: any long random text
   - `INITIAL_PASSWORD`: everyone starts with this, then changes it
   - `NODE_ENV`: `production`
   - `TEAM_TZ_OFFSET_MIN`: `300`
   - `FRONTEND_ORIGIN`: `*` for now (set to the frontend URL later)
4. **Deployments -> Redeploy**. Open `https://YOUR-BACKEND.vercel.app/api/health`. You should see `{"ok":true,...}`.

### 2. Frontend project
1. Edit `frontend/config.js`: set `window.NUVO_API_URL` to the backend URL (no trailing slash). Commit.
2. Vercel -> **Add New Project** -> same repo -> **Root Directory: `frontend`** -> Framework: **Other** -> Deploy.
3. Copy the frontend URL. In the backend project set `FRONTEND_ORIGIN` to it, then redeploy the backend.

### 3. First login
Log in as `Ayqan Haider` with `INITIAL_PASSWORD`. Click **Password** and change it.

## Things to know
- **Free tier.** Vercel Hobby and Neon free both sleep when idle, so the first load can take a couple of seconds. Check their current limits and terms.
- **Login lockout** is remembered per server instance, so it is weaker on Vercel. Fine for a 4-person team.
- **Months.** Cards belong to a month by their due date (and points by the check date), using `TEAM_TZ_OFFSET_MIN` (300 = Pakistan time).
- **Logins** use name and password, stored as salted scrypt hashes. Tokens last 7 days. Ten failed logins in 15 minutes locks that name and IP for a while.
- **Backups.** Export the database from Neon regularly. The bonus tracker is a payment record.

## Run it on your computer
```
cd backend
INITIAL_PASSWORD=choose-something node server.js      # needs Node 22 or newer, uses SQLite in memory
# in another terminal, serve the frontend folder, e.g.:
cd frontend && python3 -m http.server 5173            # then open http://localhost:5173
npm test                                              # backend tests
```
The in-memory database resets every time the server restarts. To keep data locally, also set `SQLITE_PATH=./cards.sqlite`.
