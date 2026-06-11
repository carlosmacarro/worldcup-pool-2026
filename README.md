# World Cup 2026 Friends Pool — Netlify App

This is a free-friendly mobile web app for your World Cup betting pool.

It reads every friend's Excel file from a Google Drive folder, fetches World Cup 2026 results from football-data.org, calculates points, and shows a phone-friendly leaderboard.


## New in this version: simplified participant navigation

The homepage now shows a group-stage leaderboard and a Participants tab only. Group-stage bets are identified as match numbers `1` to `72` and/or Excel round labels `J1`, `J2`, `J3`.

Tap a participant from the homepage to open their bets page. On that participant page there are two buttons:

- `Group stage` — one participant's group-stage bets.
- `Knockout phase` — one participant's knockout-phase bets.

API endpoint:

- `/.netlify/functions/participant?participant=PARTICIPANT_KEY&phase=group`
- `/.netlify/functions/participant?participant=PARTICIPANT_KEY&phase=knockout`

No Supabase schema change is required for this version. Replace the changed files in GitHub and delete the old `public/knockouts.html` and `public/knockouts.js` files if they exist.

---

## What is included

- `public/` — mobile website
- `public/admin.html` — manual sync page
- `public/participant.html` — participant detail page with Group stage / Knockout phase buttons
- `netlify/functions/leaderboard.mjs` — public leaderboard API, group-stage by default
- `netlify/functions/participant.mjs` — public participant bets API
- `netlify/functions/sync.mjs` — scheduled sync every 5 minutes
- `netlify/functions/sync-now.mjs` — manual sync endpoint
- `supabase_schema.sql` — database tables
- Excel parser for your workbook structure:
  - sheet: `WORLDCUP`
  - match number: column `AH`
  - home team: column `AA`
  - predicted home goals: column `AC`
  - predicted away goals: column `AD`
  - away team: column `AF`
  - participant name: `Home!C10`

## Scoring rules

- 3 points: exact score
- 2 points: correct winner/draw and correct goal difference, but not exact score
- 1 point: correct winner/draw only
- 0 points: otherwise

By default, only `FINISHED` matches are scored. If you want provisional live points while a match is in play, set `COUNT_LIVE_MATCHES=true`, but only do that if football-data.org is returning current in-play scores for your token.

---

## 1. Create the Supabase database

1. Create a free Supabase project.
2. Open **SQL Editor**.
3. Paste and run the contents of `supabase_schema.sql`.
4. Go to **Project Settings → API** and copy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

Do not put the service-role key in frontend JavaScript. This project uses it only inside Netlify Functions.

---

## 2. Prepare Google Drive access

You need a Google service account so the server can read the Drive folder.

1. Create a Google Cloud project.
2. Enable **Google Drive API**.
3. Create a **Service Account**.
4. Create a JSON key for the service account.
5. Copy these values into Netlify environment variables:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`
6. Share your Google Drive folder with the service account email, exactly like sharing a folder with a normal person.
7. Copy the folder ID from the Drive URL:

```text
https://drive.google.com/drive/folders/THIS_IS_THE_FOLDER_ID
```

Use that value for `GOOGLE_DRIVE_FOLDER_ID`.

Important: `GOOGLE_PRIVATE_KEY` must keep the newline characters. In Netlify you can paste it with real line breaks, or use `\n` between lines.

---

## 3. Get a football-data.org token

Create a free account at football-data.org and copy your API token.

Use these environment variables:

```text
FOOTBALL_DATA_TOKEN=your-token
FOOTBALL_COMPETITION_CODE=WC
FOOTBALL_SEASON=2026
```

The app calls:

```text
https://api.football-data.org/v4/competitions/WC/matches?season=2026
```

---

## 4. Deploy to Netlify

Recommended path:

1. Create a GitHub repository.
2. Upload all files from this folder to the repository.
3. In Netlify: **Add new site → Import an existing project**.
4. Select the repository.
5. Netlify should detect:
   - publish directory: `public`
   - functions directory: `netlify/functions`
6. Add the environment variables below in **Site configuration → Environment variables**.
7. Deploy.

Environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
GOOGLE_DRIVE_FOLDER_ID
FOOTBALL_DATA_TOKEN
FOOTBALL_COMPETITION_CODE=WC
FOOTBALL_SEASON=2026
ADMIN_SECRET
COUNT_LIVE_MATCHES=false
```

Choose a long random value for `ADMIN_SECRET`.

Alternative with Netlify CLI:

```bash
npm install
npx netlify init
npx netlify env:set SUPABASE_URL "https://..."
npx netlify env:set SUPABASE_SERVICE_ROLE_KEY "..."
npx netlify env:set GOOGLE_SERVICE_ACCOUNT_EMAIL "..."
npx netlify env:set GOOGLE_PRIVATE_KEY "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
npx netlify env:set GOOGLE_DRIVE_FOLDER_ID "..."
npx netlify env:set FOOTBALL_DATA_TOKEN "..."
npx netlify env:set ADMIN_SECRET "..."
npx netlify deploy --prod
```

---

## 5. Run the first sync

After deploying, open:

```text
https://YOUR-SITE.netlify.app/admin.html
```

Paste your `ADMIN_SECRET` and press **Run sync**.

Then open:

```text
https://YOUR-SITE.netlify.app/
```

Share that homepage link with your friends.

---

## 6. How updates work

- `sync.mjs` runs every 5 minutes using Netlify Scheduled Functions.
- It reads all Excel files from Drive.
- It fetches the World Cup matches from football-data.org.
- It stores everything in Supabase.
- The phone website refreshes the leaderboard every 30 seconds.

To change the scheduled sync frequency, edit this line in `netlify/functions/sync.mjs`:

```js
schedule: '*/5 * * * *'
```

Examples:

```js
schedule: '*/1 * * * *'  // every minute
schedule: '*/15 * * * *' // every 15 minutes
schedule: '@hourly'      // hourly
```

---

## Important note about match numbers

The Excel file uses official match numbers in column `AH`. football-data.org does not expose FIFA match numbers directly, so this app maps API matches to Excel match numbers by chronological order.

That should normally work if the Excel template follows the official schedule. If you notice one match being scored against the wrong prediction, add an environment variable called `MATCH_API_ID_OVERRIDES`.

Example:

```json
{"1":"123456","2":"123457"}
```

That means Excel match `1` should use football-data.org match ID `123456`, and Excel match `2` should use API match ID `123457`.

You can see football-data.org match IDs in the Supabase `matches` table after a sync.

---

## Troubleshooting

### The site says there are no participants

Run `/admin.html` once and check the sync output.

### Google Drive files are not found

Check that:

- the folder ID is correct
- the folder was shared with the service account email
- the files are `.xlsx` or `.xls`
- the service account has at least Viewer access

### Scores are not loading

Check that:

- `FOOTBALL_DATA_TOKEN` is correct
- `FOOTBALL_COMPETITION_CODE=WC`
- `FOOTBALL_SEASON=2026`
- your football-data.org plan has access to World Cup data

### Predictions are wrong or missing

The parser expects the same Excel layout as your uploaded file. If a friend changes the structure of the workbook, ask them to use the original template again.

## Admin sync timeout fix

The admin page now starts the manual sync as a Netlify Background Function and polls the latest sync log from Supabase.
This avoids browser JSON errors caused by Netlify returning an HTML timeout page when many Excel files are downloaded from Drive.

New/updated files for this change:

```text
public/admin.html
netlify/functions/sync-start.mjs
netlify/functions/sync-status.mjs
netlify/functions/sync-background.mjs
package.json
```

After deploying these files, open `/admin.html`, paste `ADMIN_SECRET`, and click **Run sync**. The page will show the latest sync status from the `sync_logs` table.

---

## Fix: Excel match numbers vs API match order

This version maps group-stage results from football-data.org to the Excel template by normalized home/away team names instead of simple chronological order. This prevents rows such as Australia–Turkey, Germany–Curaçao, and Netherlands–Japan from being shifted when the API order does not match the Excel match numbers.

After deploying this fix, run a manual sync from `/admin.html` so the `matches` table is rewritten with the corrected match mapping.


## 2026-06-11 API defensive mapping hotfix

If the admin sync fails with `Cannot read properties of undefined (reading 'homeTeam')`, update `netlify/functions/_lib/footballData.mjs` from this package and redeploy. The importer now filters unexpected/empty API rows and reads team IDs/names defensively before mapping API results to Excel fixtures.
