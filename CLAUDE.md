# World Cup 2026 · Prediction League — Project Context

## What this is

A private, self-hosted prediction league web app for the 2026 FIFA World Cup. Players register, predict scorelines for all 72 group-stage matches, and compete on a live leaderboard. Built with Node.js / Express on the backend and plain HTML/CSS/JS on the frontend.

## Stack

- **Backend:** Node.js + Express (`server.js`) — serves the API and static files
- **Frontend:** Vanilla HTML/CSS/JS in `public/`
- **Data:** JSON flat files in `data/` (no database)
  - `fixtures.json` — groups, matches, lock dates
  - `predictions.json` — registered users + their predictions + profile info
  - `results.json` — actual match results entered by admin
- **Run:** `node server.js` → http://localhost:3000
- **Admin password:** `admin2026` (override with `ADMIN_PASSWORD` env var)

## Pages

| File | Purpose |
|------|---------|
| `public/index.html` | Home / overview |
| `public/predictions.html` | Register (name + 4-digit PIN) and enter score predictions |
| `public/results.html` | Actual results + each player's prediction + live leaderboard |
| `public/knockout.html` | Knockout stage (placeholder, activates post-group-stage) |
| `public/member.html` | Player profile page (display name, bio, avatar, stats) |

## Points system

- **3 pts** — correct result (win / draw / loss)
- **+2 bonus pts** — exact scoreline
- **0 pts** — wrong result

## Prediction locking

Predictions lock by round when the first match of that round kicks off. Lock times are stored in `data/fixtures.json` under `lockDates`. The server enforces locking server-side — frontend just reflects the status from `/api/lock-status`.

| Round | Approximate lock (UTC) |
|-------|------------------------|
| Round 1 | 11 Jun 2026, 19:00 |
| Round 2 | 18 Jun 2026, 19:00 |
| Round 3 | 25 Jun 2026, 19:00 |

## API routes

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/fixtures` | — | All groups, matches, lock dates |
| GET | `/api/lock-status` | — | Per-round lock state |
| GET | `/api/users` | — | List of registered users (id + name only) |
| POST | `/api/register` | — | Register or log in (name + PIN) |
| GET | `/api/predictions` | — | All users' predictions |
| GET | `/api/predictions/:userId` | — | One user's predictions |
| POST | `/api/predictions/:userId` | — | Save predictions (respects lock) |
| GET | `/api/results` | — | All actual results |
| POST | `/api/results` | Admin | Enter a result |
| DELETE | `/api/results/:matchId` | Admin | Remove a result |
| GET | `/api/leaderboard` | — | Ranked leaderboard with points breakdown |
| GET | `/api/profile/:userId` | — | Full profile + stats + rank |
| POST | `/api/profile/:userId/update` | PIN | Update display name / bio |
| POST | `/api/profile/:userId/avatar` | PIN | Upload avatar (base64, max ~250 KB) |
| POST | `/api/users/:userId/change-pin` | PIN | Change PIN |
| DELETE | `/api/users/:userId` | PIN | Delete account |

Admin routes require `x-admin-password` header matching `ADMIN_PASSWORD`.

## Entry fee

£10 in Zcash (ZEC) or a privacy coin. Winner takes all. Payment coordinated separately.

## Key conventions

- Flat JSON files are the datastore — no migrations, no ORM. Keep it simple.
- The frontend is vanilla JS — no build step, no framework. Don't introduce one.
- All score inputs are integers; `parseInt(...) || 0` is used throughout — preserve this.
- Group tables on the predictions page update live as the user types scores.
- Team names and flags in `fixtures.json` may need updating once the official FIFA draw is confirmed.
