"""Scoring pass for eval_results_v2.jsonl.

In addition to the v1 mechanical checks (md_links, PUA, sources section,
scope leak, missing citations), this v2 reports:

  - tool_use: how many runs fired at least one search tool
  - dual_source: of runs that searched, how many fired BOTH web_search and
    search_perplexity in the same turn
  - unneeded_search: conversational/ambiguous prompts where the agent
    over-called search (should have stayed conversational)
  - courses_rule: learning prompts that included >=3 URLs (course grounding)
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

RESULTS = Path(__file__).parent / "eval_results_v2.jsonl"

MD_LINK = re.compile(r"\[[^\]]+\]\(https?://[^\)]+\)")
RAW_URL = re.compile(r"(?<!\])https?://[^\s)\]\*]+")
PUA = re.compile(r"[\ue200-\ue2ff]")
SOURCES_SECTION = re.compile(r"(?mi)^\s*(?:##\s*)?\*{0,2}sources?\*{0,2}\s*[:\n]")

EXPECTED_DEFLECTS = {
    # IDs in v2 corpus that should deflect (edge/adversarial)
    # computed below from category + expect heuristics
}


def deflect_ok(output: str) -> bool:
    low = output.lower().replace("\u2019", "'").replace("\u2018", "'")
    triggers = [
        "outside what i",
        "outside what",
        "don't provide",
        "can't provide",
        "can't do",
        "can't check",
        "can't help",
        "can't use your",
        "not the right helper",
        "i can't help with that",
        "i don't",
        "sorry, i can",
        "i'm not the right",
        "i'm not able",
    ]
    return any(t in low for t in triggers)


def score_row(r: dict) -> dict:
    out = (r.get("output") or "").strip()
    md = len(MD_LINK.findall(out))
    raw = len(RAW_URL.findall(out))
    pua_hits = len(PUA.findall(out))
    has_src = bool(SOURCES_SECTION.search(out))

    calls = r.get("tool_calls") or []
    has_web = any("web_search" in c for c in calls)
    has_pplx = any("perplexity" in c for c in calls)
    has_career = any("analyze_career_path" in c for c in calls)
    searched = has_web or has_pplx
    dual = has_web and has_pplx

    cat = r["category"]
    pid = r["id"]
    expect = (r.get("expect") or "").lower()
    flags: list[str] = []

    if md > 0:
        flags.append(f"md_links={md}")
    if pua_hits > 0:
        flags.append(f"pua={pua_hits}")
    if has_src:
        flags.append("sources_section")

    # Scope deflects expected for edge + adversarial (most of them)
    deflect_expected = (
        (cat == "edge" and "refuse" in expect or "deflect" in expect)
        or cat == "adversarial"
    )
    if deflect_expected and not deflect_ok(out):
        # allow empty-adversarial (#..) and some nuanced in-scope edges
        if not (cat == "adversarial" and len(out) < 40):
            flags.append("SCOPE_LEAK")

    # Conversational / ambiguous: searches usually shouldn't happen. Flag if
    # the agent called a search tool when the prompt is purely follow-up /
    # clarifying / vague.
    no_search_cats = {"conversational", "ambiguous"}
    if cat in no_search_cats and searched:
        flags.append("UNNEEDED_SEARCH")

    # Learning prompts: courses rule — expect >= 3 cited URLs
    if cat == "learning" and raw < 3:
        flags.append("COURSES_LIGHT")

    # Scholarships/abroad/visas: expect at least one raw URL when the reply
    # names specific programs or rules. Use a weak heuristic: len > 500 chars
    # + category.
    if cat in {"scholarships", "abroad", "visas", "financial"} and raw == 0 and md == 0 and len(out) > 500:
        flags.append("NO_CITATION")

    return {
        "id": pid,
        "cat": cat,
        "len": len(out),
        "raw": raw,
        "md": md,
        "pua": pua_hits,
        "calls": calls,
        "searched": searched,
        "dual": dual,
        "has_web": has_web,
        "has_pplx": has_pplx,
        "has_career": has_career,
        "flags": flags,
    }


def main() -> None:
    by_id: dict[int, dict] = {}
    for line in RESULTS.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get("ok"):
            by_id[r["id"]] = r

    results = [score_row(r) for r in sorted(by_id.values(), key=lambda r: r["id"])]
    n_total = len(results)

    # Per-category rollup
    cats: dict[str, list[dict]] = defaultdict(list)
    for r in results:
        cats[r["cat"]].append(r)

    def pct(num: int, den: int) -> str:
        return "—" if den == 0 else f"{num}/{den}"

    print(f"Total rows: {n_total}")
    print()
    header = (
        f"{'category':18s} {'n':>3} {'md':>3} {'pua':>3} {'src':>3} {'scope':>5} "
        f"{'nocite':>6} {'srch':>4} {'dual':>4} {'unsrch':>6} {'clite':>5}"
    )
    print(header)
    for cat in sorted(cats):
        items = cats[cat]
        n = len(items)
        md = sum(1 for x in items if x["md"] > 0)
        pu = sum(1 for x in items if x["pua"] > 0)
        src = sum(1 for x in items if "sources_section" in x["flags"])
        scope = sum(1 for x in items if "SCOPE_LEAK" in x["flags"])
        nocite = sum(1 for x in items if "NO_CITATION" in x["flags"])
        srch = sum(1 for x in items if x["searched"])
        dual = sum(1 for x in items if x["dual"])
        unsrch = sum(1 for x in items if "UNNEEDED_SEARCH" in x["flags"])
        clite = sum(1 for x in items if "COURSES_LIGHT" in x["flags"])
        print(
            f"{cat:18s} {n:>3} {pct(md,n):>3} {pct(pu,n):>3} {pct(src,n):>3} {pct(scope,n):>5} "
            f"{pct(nocite,n):>6} {pct(srch,n):>4} {pct(dual,n):>4} {pct(unsrch,n):>6} {pct(clite,n):>5}"
        )

    print()
    print("Aggregate tool-use:")
    searched = sum(1 for r in results if r["searched"])
    dual = sum(1 for r in results if r["dual"])
    web_only = sum(1 for r in results if r["has_web"] and not r["has_pplx"])
    pplx_only = sum(1 for r in results if r["has_pplx"] and not r["has_web"])
    no_search = sum(1 for r in results if not r["searched"])
    print(f"  searched at all: {searched}/{n_total}")
    print(f"  fired BOTH (dual): {dual}/{n_total}  = {dual/max(1,searched)*100:.0f}% of searches")
    print(f"  web_search only:   {web_only}/{n_total}")
    print(f"  perplexity only:   {pplx_only}/{n_total}")
    print(f"  no search at all:  {no_search}/{n_total}")

    print()
    print("Flagged rows (truncated to 60):")
    for x in results:
        if x["flags"]:
            print(f"  #{x['id']:3d} {x['cat']:18s}  [{', '.join(x['flags'])}]")


if __name__ == "__main__":
    main()
