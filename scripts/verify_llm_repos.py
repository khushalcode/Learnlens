#!/usr/bin/env python3
"""Verify LLM training/serving/learning repos.
Saves verified reference to /home/z/my-project/download/llm_training_reference.md
"""
import urllib.request
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

REPOS = [
    # (repo, category, note)
    # Fine-tuning (start here)
    ("unslothai/unsloth", "Fine-tuning (start here)", "Fastest & lowest VRAM; runs on free Colab/Kaggle GPUs"),
    ("hiyouga/LLaMA-Factory", "Fine-tuning (start here)", "100+ models, has a web UI"),
    ("huggingface/peft", "Fine-tuning (start here)", "LoRA/QLoRA — base of most pipelines"),
    ("huggingface/trl", "Fine-tuning (start here)", "SFT, DPO, PPO, GRPO for alignment & reasoning"),
    ("meta-pytorch/torchtune", "Fine-tuning (start here)", "Clean PyTorch-native recipes"),
    ("Lightning-AI/litgpt", "Fine-tuning (start here)", "Pretrain, fine-tune, deploy recipes"),
    ("modelscope/ms-swift", "Fine-tuning (start here)", "Large & multimodal models, Qwen workflows"),
    ("huggingface/autotrain-advanced", "Fine-tuning (start here)", "Low-code training"),
    # Large-scale / multi-GPU
    ("microsoft/DeepSpeed", "Large-scale / Multi-GPU", "ZeRO, for very large models"),
    ("EleutherAI/pythia", "Large-scale / Multi-GPU", "Research-grade training suite"),
    # Agents and tool-use training
    ("OpenPipe/ART", "Agents & Tool-use Training", "RL for agents (verified: path correct)"),
    ("OpenBMB/ToolBench", "Agents & Tool-use Training", "Tool-use training"),
    # Serving what you train
    ("vllm-project/vllm", "Serving", "High-throughput serving"),
    ("ggml-org/llama.cpp", "Serving", "CPU/GPU inference, GGUF format"),
    ("ollama/ollama", "Serving", "Run models locally with one command"),
    ("sgl-project/sglang", "Serving", "Fast serving"),
    # Learning path
    ("mlabonne/llm-course", "Learning path", "Roadmap plus Colab notebooks"),
    ("Hannibal046/Awesome-LLM", "Learning path", "Papers, tools, leaderboards"),
]

# Note: https://github.com/topics/fine-tuning is a topic page, not a repo — handled separately


def check_repo(item):
    repo, cat, note = item
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
        return {"repo": repo, "category": cat, "note": note, "status": f"HTTP {e.code}",
                "stars": 0, "pushed_at": "", "archived": False, "description": "", "url": html_url}
    except Exception as e:
        return {"repo": repo, "category": cat, "note": note, "status": f"ERR {type(e).__name__}",
                "stars": 0, "pushed_at": "", "archived": False, "description": "", "url": html_url}

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

    archived = "This repository has been archived by the owner" in body or \
               "This repository was archived" in body or \
               'aria-label="Archived"' in body

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

    return {
        "repo": repo,
        "category": cat,
        "note": note,
        "status": "OK",
        "stars": stars,
        "pushed_at": pushed_at,
        "archived": archived,
        "description": desc,
        "url": html_url,
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
    for _, c, _ in REPOS:
        if c not in cat_order:
            cat_order.append(c)
    results.sort(key=lambda r: (cat_order.index(r["category"]) if r["category"] in cat_order else 99, r["repo"]))

    print(f"\n{'REPO':<45} {'STATUS':<10} {'STARS':>10} {'LAST PUSH':<12} {'ACTIVITY':<22} {'ARCHIVED'}")
    print("-" * 130)
    for r in results:
        days = days_since(r.get("pushed_at"))
        activity = activity_label(days)
        stars = f"{r.get('stars', 0):,}" if r.get("status") == "OK" else "—"
        pushed = r.get("pushed_at", "—")
        archived = "YES" if r.get("archived") else "no"
        print(f"{r['repo']:<45} {r['status']:<10} {stars:>10} {pushed:<12} {activity:<22} {archived}")

    out_path = "/home/z/my-project/download/llm_training_reference.md"
    lines = []
    lines.append("# Verified LLM Training / Serving / Learning Repos\n")
    lines.append(f"_Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}_\n")
    lines.append(f"_Total repos verified: {len(results)}_  ")
    ok = sum(1 for r in results if r["status"] == "OK")
    bad = len(results) - ok
    lines.append(f"_Active: {ok}  •  Failed/Archived/Other: {bad}_\n")
    lines.append("Each entry includes stars, last push date, activity flag, archived status. ")
    lines.append("Verified via GitHub HTML + Atom feed (no API rate-limit).\n")

    by_cat = {}
    for r in results:
        by_cat.setdefault(r["category"], []).append(r)

    for cat in cat_order:
        items = by_cat.get(cat, [])
        if not items:
            continue
        lines.append(f"\n## {cat}\n")
        lines.append("| Repo | Note | Stars | Last Push | Activity | Archived |")
        lines.append("|------|------|------:|-----------|----------|----------|")
        for r in items:
            days = days_since(r.get("pushed_at"))
            activity = activity_label(days)
            stars = f"{r.get('stars', 0):,}" if r.get("status") == "OK" else "—"
            pushed = r.get("pushed_at", "—")
            archived = "yes" if r.get("archived") else "no"
            link = f"[{r['repo']}]({r.get('url')})"
            note = r["note"].replace("|", "\\|")
            lines.append(f"| {link} | {note} | {stars} | {pushed} | {activity} | {archived} |")
        lines.append("")
        for r in items:
            if r.get("description"):
                lines.append(f"- **{r['repo']}** — {r['description']}")
        lines.append("")

    # Hardware-constrained workflow
    lines.append("\n## Recommended Workflow (2013 MacBook Air, no GPU)\n")
    lines.append("Based on your hardware constraints:\n")
    lines.append("1. **Train on free cloud GPU** — Colab (T4 16GB free tier) or Kaggle (P100 16GB). ")
    lines.append("   Use [unslothai/unsloth](https://github.com/unslothai/unsloth) for the lowest VRAM footprint. ")
    lines.append("   A QLoRA run on a 3B–8B model (Qwen 2.5 3B/7B, Gemma 2 2B/9B, Llama 3.1 8B) fits in 16GB.\n")
    lines.append("2. **Build a small focused dataset** — 500–2,000 examples for ONE narrow task ")
    lines.append("   (e.g., JSON output formatting, RAG-style Q&A over your docs, function-calling on your tools). ")
    lines.append("   Quality > quantity. Use [huggingface/trl](https://github.com/huggingface/trl) SFTTrainer.\n")
    lines.append("3. **Export to GGUF** — quantize to 4-bit or 8-bit for local inference. ")
    lines.append("   Use [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) `convert_hf_to_gguf.py` ")
    lines.append("   + `llama-quantize`. Test locally with [ollama/ollama](https://github.com/ollama/ollama) ")
    lines.append("   (`ollama create mymodel -f Modelfile`).\n")
    lines.append("4. **Iterate with DPO or GRPO** — only AFTER SFT works. ")
    lines.append("   Use [huggingface/trl](https://github.com/huggingface/trl) DPOTrainer / GRPOTrainer ")
    lines.append("   with a preference dataset (winner/loser pairs).\n")
    lines.append("5. **Serve in production** — when you outgrow Ollama, use ")
    lines.append("   [vllm-project/vllm](https://github.com/vllm-project/vllm) for high-throughput serving, ")
    lines.append("   or [sgl-project/sglang](https://github.com/sgl-project/sglang) for low-latency.\n")
    lines.append("\n**Serving note for MacBook Air 2013**: It's a 1.3–1.7GHz dual-core CPU with 4–8GB RAM. ")
    lines.append("llama.cpp will technically run a 1B–3B Q4 model at ~1-3 tokens/sec, but realistically you should ")
    lines.append("use the Mac only for code; serve trained models on Colab/Kaggle GPUs or a small cloud VM.\n")

    lines.append("\n## What I'll Default To\n")
    lines.append("- **\"Help me fine-tune [model] for [task]\"** → Unsloth + QLoRA pipeline, Colab/Kaggle-ready notebook\n")
    lines.append("- **\"Generate a training dataset for [task]\"** → 500–2000 example JSONL with format spec\n")
    lines.append("- **\"Convert my HF model to GGUF\"** → llama.cpp convert + quantize commands\n")
    lines.append("- **\"Set up local serving with Ollama\"** → Modelfile + commands\n")
    lines.append("- **\"Explain LoRA/QLoRA/DPO/GRPO\"** → cited from HF peft/trl docs\n")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\n✓ Saved reference doc → {out_path}")


if __name__ == "__main__":
    main()
