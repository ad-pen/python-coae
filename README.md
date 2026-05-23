# COAE Python Practice

Mobile-first study site for the HTB **AI Red Teamer** path (COAE). Lessons scraped from the HTB Academy API, hand-written Python exercises that run in the browser via Pyodide. Static site — hostable on GitHub Pages, fully offline after first visit (service worker).

## Layout

```
scraper/scrape.py          HTB → JSON dumper
docs/                      static site root (this is what gets hosted)
├── index.html
├── css/styles.css
├── js/
│   ├── app.js              router + views
│   ├── progress.js         localStorage progress
│   ├── pyodide-cell.js     lazy Pyodide + runnable code cells
│   └── practice.js         topic loader
├── sw.js                   offline service worker
└── data/
    ├── path.json           manifest (12 COAE modules)
    ├── modules/<slug>.json one per module (chapters → sections → content + questions)
    └── practice/<slug>.json hand-written exercises (basics, numpy, pandas, sklearn, pytorch, attacks)
```

## Run locally

```bash
cd docs
python3 -m http.server 8765
# open http://127.0.0.1:8765/ on your phone (same LAN, use your laptop's IP)
```

First Pyodide run downloads ~10MB; cached for offline thereafter.

## Updating course content

Scraper expects two HTB cookies (Application → Cookies → academy.hackthebox.com):

```bash
export HTB_SESSION='<htb_academy_session>'
export HTB_XSRF='<XSRF-TOKEN>'
python3 scraper/scrape.py            # all 12 COAE modules; skips locked ones (403)
python3 scraper/scrape.py --module 318 --module 322   # re-fetch specific modules once unlocked
```

Cookies expire roughly every 3 days; re-grab from the browser dev tools.

## Locked modules

Five COAE modules need cubes spent on HTB to unlock content:

- `AI Evasion - Foundations` (318)
- `AI Evasion - First-Order Attacks` (319)
- `AI Evasion - Sparsity Attacks` (320)
- `AI Privacy` (335)
- `AI Defense` (322)

They appear in the site as locked cards; re-run the scraper after unlocking on HTB.

## Deploy

Push to a GitHub repo and enable Pages → branch `main`, folder `/docs`.
