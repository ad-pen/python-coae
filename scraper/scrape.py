#!/usr/bin/env python3
"""
Scrape the HTB Academy COAE path into local JSON for offline use.

Cookies are read from env vars HTB_SESSION and HTB_XSRF.

Output layout:
    docs/data/
        path.json              # { id, name, modules: [{id, name, slug}] }
        modules/<slug>.json    # full module dump (chapters, sections, content, questions, exercises)
"""

import os
import re
import sys
import json
import time
import argparse
from pathlib import Path
from urllib.parse import unquote

import requests

BASE = "https://academy.hackthebox.com"
API  = f"{BASE}/api"
OUT  = Path(__file__).resolve().parent.parent / "docs" / "data"


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text[:80]


def build_session() -> requests.Session:
    session_val = os.getenv("HTB_SESSION")
    xsrf_val    = os.getenv("HTB_XSRF")
    if not session_val or not xsrf_val:
        print("ERROR: set HTB_SESSION and HTB_XSRF env vars.", file=sys.stderr)
        sys.exit(1)
    s = requests.Session()
    s.headers.update({
        "User-Agent":       "Mozilla/5.0 (X11; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0",
        "Accept":           "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-XSRF-TOKEN":     unquote(xsrf_val),
        "Referer":          f"{BASE}/app/dashboard",
    })
    s.cookies.set("htb_academy_session", session_val, domain="academy.hackthebox.com")
    s.cookies.set("XSRF-TOKEN",          xsrf_val,    domain="academy.hackthebox.com")
    return s


def try_endpoints(session: requests.Session, candidates: list[str]) -> tuple[str, dict] | None:
    """Probe several candidate URLs and return the first that returns valid JSON 200."""
    for url in candidates:
        try:
            r = session.get(url, timeout=30)
        except Exception as e:
            print(f"  {url} -> exception: {e}", file=sys.stderr)
            continue
        if r.status_code == 200:
            try:
                return url, r.json()
            except Exception:
                pass
        print(f"  {url} -> {r.status_code}", file=sys.stderr)
    return None


def find_coae_path(session: requests.Session) -> dict:
    """Locate the COAE certification path. Tries common path-list endpoints."""
    candidates = [
        f"{API}/v1/paths",
        f"{API}/v2/paths",
        f"{API}/v1/job-roles",
        f"{API}/v1/certifications",
        f"{API}/v1/certifications/paths",
        f"{API}/v2/certifications",
        f"{API}/v1/paths/list",
    ]
    print("Probing for path-list endpoint...")
    hit = try_endpoints(session, candidates)
    if not hit:
        print("ERROR: no path-list endpoint responded 200.", file=sys.stderr)
        sys.exit(2)
    url, data = hit
    print(f"  matched: {url}")
    Path(OUT / "_debug_paths.json").parent.mkdir(parents=True, exist_ok=True)
    (OUT / "_debug_paths.json").write_text(json.dumps(data, indent=2))

    # Search for "COAE" in the response
    def walk(node, parents=()):
        if isinstance(node, dict):
            for k, v in node.items():
                yield from walk(v, parents + (k,))
            yield parents, node
        elif isinstance(node, list):
            for item in node:
                yield from walk(item, parents)

    matches = []
    for parents, node in walk(data):
        if isinstance(node, dict):
            blob = json.dumps(node, default=str).lower()
            if "coae" in blob or "certified ai" in blob:
                matches.append(node)

    if not matches:
        print("WARNING: did not find a 'COAE' entry in response. Inspect _debug_paths.json manually.", file=sys.stderr)
    else:
        print(f"  found {len(matches)} potential COAE-related entries (saved to _debug_paths.json)")
    return data


def fetch_module(session: requests.Session, module_id: int) -> dict:
    """Fetch one module's full structure: info + chapters + sections + content."""
    r = session.get(f"{API}/v2/modules/{module_id}", timeout=30)
    r.raise_for_status()
    info = r.json()["data"]
    title = info.get("name") or f"module_{module_id}"

    r2 = session.get(f"{API}/v3/modules/{module_id}/sections", timeout=30)
    r2.raise_for_status()
    chapters_raw = r2.json().get("data", [])

    chapters = []
    for ch in chapters_raw:
        sections = []
        for sec in ch.get("sections", []):
            sec_id = sec["id"]
            sec_title = sec["title"]
            sec_resp = session.get(f"{API}/v2/modules/{module_id}/sections/{sec_id}", timeout=30)
            sec_resp.raise_for_status()
            sec_data = sec_resp.json()["data"]
            sections.append({
                "id": sec_id,
                "title": sec_title,
                "content": sec_data.get("content", ""),
                "questions": sec_data.get("questions", []),
                "exercises": sec_data.get("exercises", []),
            })
            time.sleep(0.5)
        chapters.append({"group": ch.get("group"), "sections": sections})

    return {
        "id": module_id,
        "title": title,
        "slug": slugify(title),
        "url": f"{BASE}/app/module/{module_id}",
        "info": info,
        "chapters": chapters,
    }


COAE_PATH_ID = 418
COAE_MODULE_IDS = [290, 292, 294, 297, 307, 302, 315, 318, 319, 320, 335, 322]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--module", action="append", type=int,
                   help="Scrape a specific module id (repeatable). Defaults to all 12 COAE modules.")
    p.add_argument("--probe", action="store_true", help="Just probe path list and exit.")
    p.add_argument("--skip-existing", action="store_true", help="Don't refetch modules already on disk.")
    args = p.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "modules").mkdir(parents=True, exist_ok=True)

    session = build_session()

    if args.probe:
        find_coae_path(session)
        return

    module_ids = args.module or COAE_MODULE_IDS
    manifest = {"path_id": COAE_PATH_ID, "path_name": "AI Red Teamer", "acronym": "COAE", "modules": []}

    for mid in module_ids:
        slug_guess = None
        existing = list((OUT / "modules").glob("*.json"))
        if args.skip_existing:
            for f in existing:
                try:
                    blob = json.loads(f.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if blob.get("id") == mid:
                    slug_guess = blob.get("slug")
                    manifest["modules"].append({
                        "id": mid, "title": blob.get("title"), "slug": slug_guess,
                        "chapter_count": len(blob.get("chapters", [])),
                    })
                    print(f"\nModule {mid}: already on disk ({f.name}) — skipping.")
                    break
            if slug_guess:
                continue

        print(f"\nFetching module {mid}...")
        try:
            mod = fetch_module(session, mid)
        except requests.HTTPError as e:
            print(f"  HTTPError {e.response.status_code} — skipping.", file=sys.stderr)
            continue
        out_file = OUT / "modules" / f"{mod['slug']}.json"
        out_file.write_text(json.dumps(mod, indent=2), encoding="utf-8")
        print(f"  -> {out_file}  ({len(mod['chapters'])} chapters)")
        manifest["modules"].append({
            "id": mod["id"], "title": mod["title"], "slug": mod["slug"],
            "chapter_count": len(mod["chapters"]),
        })

    (OUT / "path.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nManifest -> {OUT / 'path.json'}")


if __name__ == "__main__":
    main()
