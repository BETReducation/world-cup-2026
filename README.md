# World Cup 2026 · Prediction League

A private prediction league for the 2026 FIFA World Cup group stage.

## Setup

```bash
npm install
node server.js
```

Then open **http://localhost:3000** in your browser.

## How it works

| Page | Purpose |
|------|---------|
| **Home** | Overview and links |
| **My Predictions** | Register with a name + 4-digit PIN, enter scores for all 72 group-stage matches. Group tables update live as you type. |
| **Results & Tables** | Actual results as they come in. Shows every player's prediction next to each result with points earned. Running leaderboard at the top. |
| **Knockout Stage** | Placeholder — will be activated after the group stage. |

## Points system

- **3 pts** — correct result (win / draw / loss)
- **+2 bonus pts** — exact scoreline
- **0 pts** — wrong result

## Prediction locking

Predictions for each round lock the moment the first match of that round kicks off:

| Round | Lock time (approximate) |
|-------|------------------------|
| Round 1 | 11 Jun 2026, 19:00 UTC |
| Round 2 | 18 Jun 2026, 19:00 UTC |
| Round 3 | 25 Jun 2026, 19:00 UTC |

Update the `lockDates` in `data/fixtures.json` once exact kick-off times are confirmed.

## Admin (entering actual results)

On the Results page, click **Admin Mode** and enter the password (default: `admin2026`).

To change the password:

```bash
ADMIN_PASSWORD=yourpassword node server.js
```

## Entry fee

£10 in Zcash (ZEC) or a privacy coin of your choice. Winner takes all. Coordinate payment details separately with participants.

## Updating teams

The teams in `data/fixtures.json` are approximate — verify against the official FIFA draw and edit the `"name"` and `"flag"` fields as needed.
