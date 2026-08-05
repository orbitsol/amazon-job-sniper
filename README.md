# Amazon Job Sniper

Watches Amazon's warehouse hiring board around a ZIP code and pings you on Discord
the moment a new shift opens, with a direct apply link.

Configured out of the box for **ZIP 75126 (Forney, TX), 50 mile radius**.

## How it works

Amazon's hiring site is behind AWS WAF, so plain HTTP requests get a `403
WAFForbiddenException`. The bot handles that in two stages:

1. **`src/session.js`** launches headless Chromium once, loads the real hiring
   site, waits until the page's own GraphQL call succeeds (proof the WAF
   challenge is solved), and harvests the resulting cookies.
2. **`src/amazon.js`** then replays cheap `fetch()` calls against
   `https://hiring.amazon.com/graphql` using those cookies. If a 403 comes back,
   it re-harvests automatically and retries.

Polling happens at the **schedule** level, not the job level. A job card can sit
on the board for weeks while individual shifts open and close — the shift
(`scheduleId`) is what you actually apply to, so that's the real "a position
opened" signal. Each new shift gets its own Discord ping and its own apply link.

## Setup

```bash
cd ~/amazon-job-sniper
npm install                  # already done
npx playwright install chromium   # already done

cp .env.example .env
```

Edit `.env` and fill in two values:

| Variable | Where to get it |
|---|---|
| `DISCORD_WEBHOOK_URL` | Discord → Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL |
| `DISCORD_USER_ID` | Discord → Settings → Advanced → enable Developer Mode, then right-click your name → Copy User ID |

Then confirm the ping works (sends one clearly-fake listing):

```bash
npm run test:discord
```

## Run it

```bash
npm start
```

First run records everything currently open as a **baseline without pinging you**,
then pings only on genuinely new shifts after that. Set `"alertOnFirstRun": true`
in `config.json` if you'd rather be told about what's already up.

State lives in `data/seen.json` so restarting doesn't re-ping old listings.
Entries expire after 14 days, so a shift that closes and truly reopens later
still counts as new.

## Check what's live right now

```bash
npm test                       # your configured ZIP
npm test -- --zip 60085 --radius 60   # somewhere busier, to sanity-check
```

## Configuration (`config.json`)

| Key | Default | Meaning |
|---|---|---|
| `zip` | `"75126"` | ZIP to centre the search on (geocoded at startup) |
| `radiusMiles` | `50` | Search radius |
| `pollSeconds` | `20` | Seconds between checks (`jitterSeconds` randomises it) |
| `titleIncludes` | `[]` | Only alert if the title contains one of these, e.g. `["Fulfillment", "Sortation"]`. Empty = everything |
| `minPay` | `null` | Skip shifts paying under this hourly rate |
| `maxDistanceMiles` | `null` | Tighter distance cap than the search radius |
| `heartbeatMinutes` | `0` | Post a periodic "still alive" message. `0` disables |
| `alertOnFirstRun` | `false` | Ping about listings already open at startup |

Anything in `.env` (`ZIP`, `RADIUS_MILES`, `POLL_SECONDS`) overrides `config.json`.

## Running it off your Mac

See **[DEPLOY.md](DEPLOY.md)** — so it keeps sniping while your laptop is closed.

- **Free forever:** Oracle Cloud Always Free or GCP e2-micro — run
  `sudo bash deploy/setup-vps.sh` on a fresh Ubuntu box
- **Free, no card:** GitHub Actions (`.github/workflows/snipe.yml`), at the cost
  of 5–25 minute delays
- **Paid, simplest:** Fly.io ~$3/mo (`fly deploy`)

## Keeping it running locally

`./run.sh` restarts the bot automatically if it ever crashes:

```bash
./run.sh
```

To have macOS start it at login and keep it alive in the background:

```bash
cp com.niv.amazonjobsniper.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.niv.amazonjobsniper.plist

# logs
tail -f ~/amazon-job-sniper/data/sniper.log

# stop
launchctl unload ~/Library/LaunchAgents/com.niv.amazonjobsniper.plist
```

## Notes

- **75126 is usually empty.** Amazon opens Dallas-area capacity in bursts; that's
  the whole reason to run a sniper. `npm test` returning zero jobs is expected,
  not a bug — verify the pipeline with a busy ZIP instead.
- **Don't poll too hard.** 20s is already aggressive. Dropping to a few seconds
  risks the WAF blocking you, which makes you slower, not faster.
- The bot only *finds and notifies*. It does not auto-submit applications — you
  click the link and apply yourself.
