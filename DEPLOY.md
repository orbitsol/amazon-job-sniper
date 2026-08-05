# ⚠️ Read this first — tested, not theorised

Amazon blocks cloud datacenter IPs **at CloudFront, before the WAF challenge is
even served**. Measured 2026-08-05 from a GitHub Actions runner
(`4.154.236.230`, Azure):

```
page title : ERROR: The request could not be satisfied
403 ERROR — Request blocked.
waf calls  : NONE      cookies: 0      token: NO
```

The same script from a home broadband IP gets a token in **3.9 seconds** and a
working API session.

This is not a tuning problem. There is no timeout or user-agent that fixes it —
the connection is refused before any of the bot's logic runs. Treat every
datacenter host (Actions, Fly, Oracle, GCP, AWS, Azure) as blocked until proven
otherwise from that specific IP. Run `node scripts/diagnose-waf.js` on any host
before trusting it.

**Therefore, in order of preference:**

1. **Run it at home** — a laptop or Raspberry Pi on residential internet. Free,
   and the only configuration verified to work end to end.
2. **Any cloud host + a residential proxy** — set `PROXY_URL`. The proxy carries
   both the Chromium session and the API calls.
3. **Cloud host alone** — verified broken. Don't.

---

# Running it off your Mac

The bot needs headless Chromium to get past AWS WAF, so it needs a host with
**~1GB RAM and always-on processes**. That rules out Cloudflare Workers, Vercel,
and most "free serverless" tiers — they can't run a browser.

## Recommended: Fly.io (~$3/month)

Deploys straight from this folder, no GitHub repo needed.

**1. Install the CLI and sign in**

```bash
brew install flyctl
fly auth signup      # or: fly auth login
```

**2. Create the app**

```bash
cd ~/amazon-job-sniper
fly launch --no-deploy --copy-config --name amazon-job-sniper-niv
```

Use a unique name — `amazon-job-sniper` itself is likely taken. If it complains,
pick another and update the `app =` line in `fly.toml`.

**3. Create the disk that holds the seen-store**

```bash
fly volumes create sniper_data --size 1 --region dfw
```

**4. Push your secrets** (these never go in the image)

```bash
fly secrets set \
  DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." \
  DISCORD_USER_ID="284719302847193028"
```

**5. Deploy**

```bash
fly deploy
```

**6. Watch it**

```bash
fly logs
```

You should see `session: token acquired` then `baseline recorded`. You'll also
get the ✅ online message in Discord.

Useful afterwards:

```bash
fly status              # is it alive
fly logs                # live output
fly apps restart amazon-job-sniper-niv
fly scale count 0       # pause without deleting
fly scale count 1       # resume
```

## Alternative: any VPS (Hetzner ~$4/mo, DigitalOcean ~$6/mo)

On a fresh Ubuntu box:

```bash
# install docker
curl -fsSL https://get.docker.com | sh

# copy this folder up (run from your Mac)
scp -r ~/amazon-job-sniper root@YOUR_SERVER_IP:/root/

# on the server
cd /root/amazon-job-sniper
cp .env.example .env && nano .env     # paste webhook + user id
docker compose up -d
docker compose logs -f
```

It restarts automatically on crash and on server reboot.

---

# Free options

Measured footprint, which decides what's viable:

| | Memory |
|---|---|
| Steady state (Node only) | **~50 MB** |
| During token harvest (~5s, every 20 min) | **~590 MB spike** |

Chromium is launched, used, and fully closed each harvest — it does not sit
resident. So a **1GB free VM is genuinely enough**, provided there's swap to
absorb the spike. `deploy/setup-vps.sh` adds 2GB of swap for exactly this reason.

## Best free option: Oracle Cloud Always Free

Free *forever*, not a 12-month trial. The Ampere ARM shape gives you far more
than this bot needs.

1. Sign up at `cloud.oracle.com` → **Always Free** eligible
2. Create instance → shape **VM.Standard.A1.Flex** (ARM), 1 OCPU / 6GB — or
   **VM.Standard.E2.1.Micro** (AMD, 1GB) if ARM capacity is unavailable
3. Image: **Ubuntu 22.04**. Save the SSH key it gives you.
4. From your Mac:

```bash
scp -r ~/amazon-job-sniper ubuntu@YOUR_SERVER_IP:~/
ssh ubuntu@YOUR_SERVER_IP

cd ~/amazon-job-sniper
cp .env.example .env && nano .env      # paste webhook + user id
sudo bash deploy/setup-vps.sh
```

The script installs Node, Chromium's system libraries, swap, and a systemd
service that starts on boot and restarts on crash. Then:

```bash
tail -f ~/amazon-job-sniper/data/sniper.log
```

Honest caveats: signup requires a card for identity verification (it isn't
charged on Always Free), ARM capacity in popular regions is frequently
"out of capacity" — retry or pick another region — and Oracle reclaims instances
that sit genuinely idle. This bot polls constantly, so it won't read as idle.

## Also free forever: Google Cloud e2-micro

GCP's always-free tier includes one `e2-micro` (1GB) in `us-west1`,
`us-central1`, or `us-east1`. Tighter than Oracle but works fine with the swap
the setup script adds. Same steps: create an Ubuntu 22.04 e2-micro, then `scp`
the folder up and run `deploy/setup-vps.sh`. Also needs a card on file.

## Free with no card at all: GitHub Actions — BLOCKED without a proxy

Already wired up in `.github/workflows/snipe.yml`, and the repo is live at
`github.com/orbitsol/amazon-job-sniper`. **But GitHub's runner IPs are blocked by
Amazon** (see the top of this file). The workflow will run, fail the check, and
go red until you add a proxy:

```bash
gh secret set PROXY_URL --repo orbitsol/amazon-job-sniper
```

Verify any host with:

```bash
gh workflow run "Snipe Amazon jobs" -f diagnose=true
```

Everything below applies once the IP problem is solved.

```bash
cd ~/amazon-job-sniper
git init && git add -A && git commit -m "Amazon job sniper"
gh repo create amazon-job-sniper --private --source=. --push
```

Then add your secrets:

```bash
gh secret set DISCORD_WEBHOOK_URL   # paste when prompted
gh secret set DISCORD_USER_ID
```

Enable Actions on the repo and it starts running. `.gitignore` already excludes
`.env`, so your webhook never lands in the repo.

**The catch, stated plainly:** GitHub's minimum cron is 5 minutes, and scheduled
runs are routinely delayed a further 10–20 minutes when the platform is busy. So
worst case you hear about an opening ~25 minutes late. It will still catch
openings that stay up a while; it will lose every race against someone polling
continuously. It's the right choice only if you want zero cost and zero signup
friction.

Free-tier minutes are capped (2,000/month on a free account for private repos).
At 5-minute intervals with ~1.5 min per run you would blow through that — so
either **make the repo public** (unlimited minutes) or raise the cron interval to
`*/20`. I'd make it public; there are no secrets in the code.

## Free if you have hardware

An old laptop or a Raspberry Pi 4 on your home wifi is arguably the *best* free
option, because it runs on a **residential IP** — which is exactly what AWS WAF
is happiest with. Follow the Ubuntu steps above, or just run `npm start` and
leave it plugged in with `caffeinate -i` on a Mac.

## Not actually free, despite appearances

- **Render / Railway / Heroku** — free web tiers sleep after inactivity, and
  background workers are paid. A sleeping sniper is a useless sniper.
- **Vercel / Netlify / Cloudflare Workers** — no persistent processes and no
  ability to run Chromium at all.
- **AWS / Azure free tiers** — 12 months only, then billed.
- **Fly.io** — no longer has a genuinely free allowance.

---

# The one thing that might bite you

Cloud servers run on **datacenter IP ranges**, which AWS WAF treats more
suspiciously than home broadband. Your Mac's residential IP sails through; a Fly
or DigitalOcean IP might start getting challenged or blocked.

I couldn't test this from here — my only vantage point is your home connection —
so treat it as a real possibility, not a certainty. **Deploy, then watch
`fly logs` for the first hour.** Healthy output looks like periodic
`no openings (N job(s) in range)` lines.

If instead you see `waf: blocked` on repeat, or `poll failed` looping, the IP is
the problem. The fix is already built in — route through a residential proxy:

```bash
fly secrets set PROXY_URL="http://user:pass@residential-proxy-host:port"
```

Locally, the same thing goes in `.env` as `PROXY_URL=...`. It applies to both the
Chromium session and the API calls. Any residential provider works
(IPRoyal, Webshare, Smartproxy — roughly $2–7/GB, and this bot uses very little
bandwidth since it's small JSON responses, not page loads).

An occasional single `waf: blocked` line is **normal** — the token expires and
the bot re-harvests on its own. Only sustained failures mean trouble.

# Region choice

`fly.toml` sets `primary_region = "dfw"` (Dallas), which is closest to 75126.
That shaves latency and means your requests come from the same metro as the jobs
you're watching, which looks more natural. If you switch ZIP to somewhere else,
consider matching the region.
