# Nuvo Labs · Cards

Work-card tracker for the team: pick a card, run the timer, submit it, get it checked.
Points and reliability are worked out from the cards, and the bonus tracker splits the bonus pool by points.

- `backend/`  Node API (deploys to Render). One dependency (`pg`). Postgres on Render, SQLite when running locally.
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

## Deploy

### 1. Put the project on GitHub
Create a new private repo and push this whole folder.

### 2. Backend on Render
1. Render dashboard -> **New** -> **Blueprint** -> choose the repo. It reads `render.yaml`.
2. It asks for two values:
   - `INITIAL_PASSWORD`: everyone starts with this. They change it after the first login.
   - `FRONTEND_ORIGIN`: your Vercel URL. If you do not have it yet, type `*`, then change it to the real URL later.
3. Deploy. Open `https://YOUR-SERVICE.onrender.com/api/health`. You should see `{"ok":true,...}`.
4. First start creates the four accounts: Ayqan Haider (admin), Saad, Yaseen, Ehtesham.

### 3. Frontend on Vercel
1. Edit `frontend/config.js` and set `window.NUVO_API_URL` to your Render URL (no trailing slash). Commit.
2. Vercel -> **Add New Project** -> same repo -> **Root Directory: `frontend`** -> Framework: **Other** -> Deploy.
3. Copy the Vercel URL. In Render -> your service -> Environment, set `FRONTEND_ORIGIN` to it, and save.

### 4. First login
Open the Vercel URL. Log in as `Ayqan Haider` with the `INITIAL_PASSWORD`. Click **Password** and change it. Tell the others to do the same.

## Things to know
- **Free tier.** A free Render web service sleeps when idle, so the first load after a quiet period can take about a minute. Free Render Postgres databases have had an expiry in the past, so check Render's current terms and use a paid database before you trust it with real pay records.
- **Months.** Cards belong to a month by their due date (and points by the check date), using `TEAM_TZ_OFFSET_MIN` (300 = Pakistan time).
- **Logins** use name and password, stored as salted scrypt hashes. Tokens last 7 days. Ten failed logins in 15 minutes locks that name and IP for a while.
- **Backups.** Export the database from Render regularly. The bonus tracker is a payment record.

## Run it on your computer
```
cd backend
INITIAL_PASSWORD=choose-something node server.js      # needs Node 22 or newer, uses SQLite in memory
# in another terminal, serve the frontend folder, e.g.:
cd frontend && python3 -m http.server 5173            # then open http://localhost:5173
npm test                                              # backend tests
```
The in-memory database resets every time the server restarts. To keep data locally, also set `SQLITE_PATH=./cards.sqlite`.
