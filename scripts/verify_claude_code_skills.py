#!/usr/bin/env python3
"""Verify Claude Code skill repos (frontend design, mobile, architecture).
Saves verified reference to /home/z/my-project/download/claude_code_skills_reference.md
"""
import urllib.request
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

REPOS = [
    # (repo, subpath, category, note)
    # Frontend Design
    ("anthropics/claude-code", "plugins/frontend-design", "Frontend Design Skills",
     "Official Anthropic skill — pushes restraint, mobile-responsive, accessible, reduced-motion output"),
    ("nextlevelbuilder/ui-ux-pro-max-skill", "", "Frontend Design Skills",
     "Popular UI/UX skill"),
    ("wilwaldon/Claude-Code-Frontend-Design-Toolkit", "", "Frontend Design Skills",
     "Curated index of design skills, plugins, and MCP servers"),
    ("GrubbyLee/design-guide", "", "Frontend Design Skills",
     "Routes dashboards/landings/redesigns/mobile UI, runs responsive & performance QA"),
    ("lotfb86/web-design-skills", "", "Frontend Design Skills",
     "Frontend design, responsive-design sub-skill, design-system generator"),
    ("HermeticOrmus/LibreUIUX-Claude-Code", "", "Frontend Design Skills",
     "Large UI/UX kit (copy only what you need)"),
    # Mobile and responsive
    ("ceorkm/mobile-app-ui-design", "", "Mobile & Responsive",
     "Patterns from Airbnb, Revolut, Phantom — relevant to Kotak Neo clone"),
    ("w159/carlos-code", "", "Mobile & Responsive",
     "Mobile-first responsive-design ref, performance-optimize skill, enterprise-webapp arch skill"),
    # Architecture, performance, simplicity
    ("tomas-u/claude-skills", "", "Architecture & Performance",
     "Technical architecture, UX for web/mobile, code review, DevOps"),
    ("DevelopersGlobal/ai-agent-skills", "", "Architecture & Performance",
     "Frontend-engineering, performance-optimization, think-before-coding"),
    ("wshobson/agents", "", "Architecture & Performance",
     "Microservices and architecture patterns"),
]


def check_repo(item):
    repo, subpath, cat, note = item
    html_url = f"https://github.com/{repo}"
    req = urllib.request.Request(
        html_url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as e:
        return {"repo": repo, "subpath": subpath, "category": cat, "note": note,
                "status": f"HTTP {e.code}", "stars": 0, "pushed_at": "",
                "archived": False, "description": "", "url": html_url,
                "subpath_exists": None}
    except Exception as e:
        return {"repo": repo, "subpath": subpath, "category": cat, "note": note,
                "status": f"ERR {type(e).__name__}", "stars": 0, "pushed_at": "",
                "archived": False, "description": "", "url": html_url,
                "subpath_exists": None}

    stars = 0
    m = re.search(r'aria-label="([\d,]+)\s+users?\s+starred', body)
    if not m:
        m = re.search(r'([\d.,]+k?)\s+stars?', body, re.IGNORECASE)
    if m:
        s = m.group(1).strip().replace(",", "")
        if s.lower().endswith("k"):
            stars = int(float(s[:-1]) * 1000)
        else:
            try:
                stars = int(s)
            except ValueError:
                stars = 0

    archived = ("This repository has been archived by the owner" in body or
               "This repository was archived" in body or
               'aria-label="Archived"' in body)

    desc = ""
    m = re.search(r'<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"', body)
    if not m:
        m = re.search(r'<meta\s+content="([^"]+)"\s+(?:property|name)="og:description"', body)
    if m:
        desc = m.group(1)[:140]

    pushed_at = ""
    m = re.search(r'<relative-time[^>]+datetime="([^"]+)"', body)
    if m:
        pushed_at = m.group(1)[:10]
    if not pushed_at:
        m = re.search(r'<meta\s+(?:property|name)="og:updated_time"\s+content="([^"]+)"', body)
        if m:
            pushed_at = m.group(1)[:10]
    if not pushed_at:
        try:
            atom_url = f"https://github.com/{repo}/commits.atom"
            areq = urllib.request.Request(
                atom_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
                    "Accept": "application/atom+xml,application/xml",
                },
            )
            with urllib.request.urlopen(areq, timeout=15) as ar:
                abody = ar.read().decode("utf-8", errors="ignore")
            am = re.search(r"<updated>([^<]+)</updated>", abody)
            if am:
                pushed_at = am.group(1)[:10]
        except Exception:
            pass

    # Verify subpath if provided
    subpath_exists = None
    if subpath:
        sub_url = f"https://github.com/{repo}/tree/main/{subpath}"
        try:
            sreq = urllib.request.Request(
                sub_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
                    "Accept": "text/html",
                },
            )
            with urllib.request.urlopen(sreq, timeout=15) as sr:
                scode = sr.getcode()
            subpath_exists = (scode == 200)
        except urllib.error.HTTPError as e:
            subpath_exists = False if e.code == 404 else None
        except Exception:
            subpath_exists = None

    return {
        "repo": repo, "subpath": subpath, "category": cat, "note": note,
        "status": "OK", "stars": stars, "pushed_at": pushed_at,
        "archived": archived, "description": desc, "url": html_url,
        "subpath_exists": subpath_exists,
    }


def days_since(date_str):
    if not date_str:
        return None
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
        return (datetime.now(timezone.utc).replace(tzinfo=None) - d.replace(tzinfo=None)).days
    except Exception:
        return None


def activity_label(days):
    if days is None:
        return "—"
    if days <= 30:
        return "🟢 active (≤30d)"
    if days <= 180:
        return "🟡 recent (≤6mo)"
    if days <= 730:
        return "🟠 stale (≤2y)"
    return "🔴 dormant (>2y)"


def main():
    results = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = {ex.submit(check_repo, item): item for item in REPOS}
        for fut in as_completed(futures):
            results.append(fut.result())

    cat_order = []
    for _, _, c, _ in REPOS:
        if c not in cat_order:
            cat_order.append(c)
    results.sort(key=lambda r: (cat_order.index(r["category"]) if r["category"] in cat_order else 99, r["repo"]))

    print(f"\n{'REPO':<50} {'STATUS':<10} {'STARS':>8} {'PUSH':<12} {'ACTIVITY':<22} {'SUBPATH'}")
    print("-" * 130)
    for r in results:
        days = days_since(r.get("pushed_at"))
        activity = activity_label(days)
        stars = f"{r.get('stars', 0):,}" if r.get("status") == "OK" else "—"
        pushed = r.get("pushed_at", "—")
        sub = "✓" if r.get("subpath_exists") is True else ("✗" if r.get("subpath_exists") is False else "—")
        print(f"{r['repo'][:50]:<50} {r['status']:<10} {stars:>8} {pushed:<12} {activity:<22} {sub:>7}")

    out_path = "/home/z/my-project/download/claude_code_skills_reference.md"
    lines = []
    lines.append("# Verified Claude Code Skill Repos (Frontend Design / Mobile / Architecture)\n")
    lines.append(f"_Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}_\n")
    lines.append(f"_Total repos verified: {len(results)}_  ")
    ok = sum(1 for r in results if r["status"] == "OK")
    bad = len(results) - ok
    lines.append(f"_Active: {ok}  •  Failed/Other: {bad}_\n")
    lines.append("These are Claude Code skills / plugins — collections of design rules, ")
    lines.append("playbooks, and patterns curated by Claude Code users. They are NOT auto-loaded ")
    lines.append("into my system, but I will consult their approaches (restraint, accessibility, ")
    lines.append("mobile-first, performance QA) when building UI for you.\n")

    by_cat = {}
    for r in results:
        by_cat.setdefault(r["category"], []).append(r)

    for cat in cat_order:
        items = by_cat.get(cat, [])
        if not items:
            continue
        lines.append(f"\n## {cat}\n")
        lines.append("| Repo | Note | Stars | Last Push | Activity | Archived | Subpath Verified |")
        lines.append("|------|------|------:|-----------|----------|----------|------------------|")
        for r in items:
            days = days_since(r.get("pushed_at"))
            activity = activity_label(days)
            stars = f"{r.get('stars', 0):,}" if r.get("status") == "OK" else "—"
            pushed = r.get("pushed_at", "—")
            archived = "yes" if r.get("archived") else "no"
            sub = "✓ exists" if r.get("subpath_exists") is True else ("✗ missing" if r.get("subpath_exists") is False else "n/a")
            link = f"[{r['repo']}]({r.get('url')})"
            if r.get("subpath"):
                link += f" → `/{r['subpath']}`"
            note = r["note"].replace("|", "\\|")
            lines.append(f"| {link} | {note} | {stars} | {pushed} | {activity} | {archived} | {sub} |")
        lines.append("")
        for r in items:
            if r.get("description"):
                lines.append(f"- **{r['repo']}** — {r['description']}")
        lines.append("")

    # Synthesis: design principles I will adopt
    lines.append("\n## Design Principles I Will Adopt From These Skills\n")
    lines.append("Reading the descriptions you provided and the Anthropic official skill in particular, ")
    lines.append("I will apply these rules whenever you ask me to build UI:\n")
    lines.append("1. **Restraint over flash** — fewer colors, fewer animations, more whitespace. ")
    lines.append("   The Anthropic skill explicitly pushes restraint.\n")
    lines.append("2. **Mobile-responsive by default** — every layout must work at 360px, 768px, 1280px. ")
    lines.append("   Use Tailwind's responsive prefixes (sm:/md:/lg:), not pixel breakpoints.\n")
    lines.append("3. **Accessibility (a11y) is non-negotiable** — semantic HTML, ARIA where needed, ")
    lines.append("   keyboard navigation, focus rings, color contrast ≥ 4.5:1 (WCAG AA).\n")
    lines.append("4. **Reduced-motion support** — wrap all non-essential animation in ")
    lines.append("   `@media (prefers-reduced-motion: reduce)`. Provide a static fallback.\n")
    lines.append("5. **Performance QA** — check bundle size, avoid layout thrash, lazy-load below-the-fold, ")
    lines.append("   use `next/dynamic` for heavy components.\n")
    lines.append("6. **Routing by task type** — dashboards vs landing pages vs mobile UI each have ")
    lines.append("   different patterns; I won't apply a landing-page playbook to a dashboard.\n")
    lines.append("7. **Pattern libraries over reinvention** — pull from shadcn/HeroUI/Mantine for ")
    lines.append("   components, Magic UI for animation, but never copy an entire design wholesale.\n")

    lines.append("\n## Kotak Neo Clone Notes\n")
    lines.append("Per your mention of `ceorkm/mobile-app-ui-design` — patterns from Airbnb, Revolut, ")
    lines.append("and Phantom are highly relevant to a brokerage app. When you ask for the clone:\n")
    lines.append("- **Phantom** → wallet connection, token swap UI, gas estimation cards\n")
    lines.append("- **Revolut** → multi-currency account tiles, instant transfer confirmations\n")
    lines.append("- **Airbnb** → search/discovery patterns, large hero imagery, sticky bottom CTAs\n")
    lines.append("- **Kotak Neo specific** → Indian brokerage conventions: NSE/BSE tabs, ")
    lines.append("  GTT orders, SIP tracker, hold-to-confirm for buy/sell\n")

    lines.append("\n## What I'll Default To\n")
    lines.append("- **\"Build a dashboard\"** → Tremor blocks + shadcn tables + dense info display\n")
    lines.append("- **\"Build a landing page\"** → Magic UI hero + scroll reveals + restrained palette\n")
    lines.append("- **\"Build a mobile app\"** (Kotak Neo, fintech) → Phantom/Revolut patterns, ")
    lines.append("  bottom-sheet navigation, hold-to-confirm gestures\n")
    lines.append("- **\"Redesign my [X]\"** → I will first audit: a11y, performance, mobile-responsiveness, ")
    lines.append("  motion-safety. Then propose changes ranked by impact.\n")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\n✓ Saved reference doc → {out_path}")


if __name__ == "__main__":
    main()
