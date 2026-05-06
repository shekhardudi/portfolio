# Pulse Scout v2 — Agentic Researcher Uplift

## Context

Today's [PulseScout](backend/scout/engine.py) does the bare minimum: each module fires a single hardcoded Tavily/ArXiv query (or scrapes a fixed URL list), then a single LLM pass smooshes everything into markdown. The output is repetitive across runs because:

- **Queries never change.** [community_sentiment.py](backend/scout/modules/community_sentiment.py:37) searches `"AI LLM machine learning developer opinion discussion"` every single time. [expert_synthesis.py](backend/scout/modules/expert_synthesis.py:32) searches `"AI weekly summary insights analysis trends"`. [technical_deep_dive.py](backend/scout/modules/technical_deep_dive.py:17) searches one giant ArXiv OR-clause and stops at 8 results.
- **No memory.** Each run is independent — last week's findings show up again this week.
- **No structured extraction.** Raw Tavily blobs go straight into a single synthesis prompt, so the LLM can't tell what's novel vs. what's a re-tread.
- **Coverage gap on corp announcements.** None of the five modules directly track the major AI labs' announcement pages — so launches like a new GPT/Claude/Gemini get there only if Tavily happens to surface them through community chatter, often a day or two late and stripped of detail.

User wants Scout to be a best-in-class topic researcher that surfaces the *latest* industry developments, without going stale across consecutive runs.

Locked decisions from clarifying questions:
1. **Stages:** keep all stages separate (no merging Extractor + Synthesizer)
2. **Memory store:** separate file (`outputs/scout/index.jsonl`), not the post-history `history.jsonl`
3. **Queries:** LLM-generated query planning — but also make the hardcoded values better.

---

## Pipeline

Three stages, two LLM calls. The Planner stage is intentionally not built — hardcoded-but-better queries are the answer.

```
[Memory]      Read outputs/scout/index.jsonl, last 30 days.
              Build covered_urls set + covered_claims list. ~0 LLM calls.
   │
   ▼
[Gather]      All selected modules run in parallel with smarter
              hardcoded queries / URL lists. Same scanner classes,
              same return shape (ScanResult). 0 LLM calls.
   │
   ▼
[Extractor]   ONE LLM call (gpt-4o-mini default). In: raw items
              from gather + memory snapshot. Out: structured
              Findings JSON [{id, claim, source_url, module,
              novelty: "new"|"follow_up"|"stale", confidence,
              why_it_matters}]. Drops noise, marks repeats.
   │
   ▼
[Synthesizer] ONE LLM call (gpt-4o-mini default). In: Findings
              filtered to non-stale. Out: Briefing JSON
              {lead, themes, tensions, gaps, action_items,
              findings, modules_used, memory_signals}.
   │
   ▼
[Persist]     outputs/scout/{run_id}/briefing.json
              outputs/scout/{run_id}/briefing.md   (renderer)
              Append to outputs/scout/index.jsonl  (memory feed)
```

Planner-free. The "intelligence" lives in extraction + synthesis, not query generation.

---

## Module overhaul — better hardcoded values + one new module

### NEW: `frontier_labs` (6th module)

The gap the user explicitly named. Direct scrape via the existing `crawl_urls_sync` helper of major AI lab announcement pages:

- `https://openai.com/news/`
- `https://www.anthropic.com/news`
- `https://deepmind.google/discover/blog/`
- `https://blog.google/technology/ai/`
- `https://ai.meta.com/blog/`
- `https://mistral.ai/news/`
- `https://x.ai/news`

This is where new model launches, safety announcements, and product GAs actually appear first. Today's modules don't read these pages directly.

### `community_sentiment` — multi-query, subreddit-targeted

Replace the single generic Tavily query with four focused ones, each tuned for a different signal type:

```
Tavily news (last `days`):
  1. "OpenAI Anthropic Google Meta Mistral xAI announced released this week"
  2. "GPT Claude Gemini Llama new feature shipped production"
  3. "AI agent production deployment postmortem"
  4. "AI model benchmark beats SOTA results"

Tavily reddit (subreddit-targeted, include_domains=
  ["reddit.com/r/MachineLearning",
   "reddit.com/r/LocalLLaMA",
   "reddit.com/r/singularity"]):
  - "AI model release new"
  - "AI tool launched this week"

HN (Algolia, points>30, last `days`):
  - "OpenAI OR Anthropic OR Google OR DeepMind OR Mistral OR xAI"
```

Drop the TLDR AI scrape from this module — TLDR AI is a *digest*, not community sentiment. Move it to `tooling_and_tactics`.

### `expert_synthesis` — multi-query against curated domains

```
Tavily news with include_domains=
  ["deeplearning.ai", "huggingface.co", "anthropic.com",
   "openai.com", "ai.googleblog.com", "ai.meta.com"]:
  1. "AI breakthrough notable result this week"
  2. "AI research paper analysis explainer"
  3. "weekly AI digest top stories"
```

Curated domain set ensures we only get expert/practitioner sources, not blogspam.

### `technical_deep_dive` — 5 sub-area ArXiv queries, dedupe, top by recency

```
ArXiv (sort=SubmittedDate desc, max 5 per query):
  1. "(large language model OR LLM)"
  2. "(AI agent OR multi-agent OR tool use)"
  3. "(multimodal OR vision language model)"
  4. "(reasoning OR chain of thought OR scaling laws)"
  5. "(alignment OR RLHF OR AI safety)"

Combine: dedupe by paper id, sort by submitted date desc, keep top 12.
```

Replaces the current single-query 8-paper limit. Better coverage of sub-areas, no fewer total papers.

### `tooling_and_tactics` — refresh URL list

Drop Ben's Bites (defunct brand). Add TLDR AI (moved from community_sentiment) + AI News by smol.ai:

```
crawl_urls_sync([
  "https://www.theneurondaily.com",     # was already
  "https://www.therundown.ai",          # was already
  "https://tldr.tech/ai",               # moved here from community_sentiment
  "https://buttondown.com/ainews",      # smol.ai's daily AI digest
])
```

### `long_form_strategy` — unchanged

Latent Space, Import AI, MIT Tech Review AI section. These are stable.

---

## Files

### New files

| Path | Purpose |
|---|---|
| `backend/scout/types.py` | Pydantic models — `Finding`, `Theme`, `Tension`, `Briefing`, `MemorySnapshot`. |
| `backend/scout/memory.py` | Read/write `outputs/scout/index.jsonl`. Compute `MemorySnapshot` for the extractor. |
| `backend/scout/extractor.py` | Single LLM call: raw items → `list[Finding]`. Strict JSON parse with fallback. |
| `backend/scout/synthesizer.py` | Single LLM call: filtered Findings → `Briefing`. Strict JSON parse with fallback. |
| `backend/scout/renderer.py` | `Briefing` → markdown (Lead / Themes / Tensions / Gaps / Action Items / Sources). |
| `backend/scout/modules/frontier_labs.py` | New 6th scanner — crawl4ai over major AI lab blog pages. |
| `backend/prompts/scout_extractor.txt` | Extractor system prompt + JSON schema instructions. |
| `backend/prompts/scout_synthesizer.txt` | Synthesizer system prompt + JSON schema instructions. |
| `tests/test_scout_types.py` | Round-trip Briefing JSON. |
| `tests/test_scout_memory.py` | JSONL append, dedup-window read, fingerprint match. |
| `tests/test_scout_renderer.py` | Briefing → markdown contract (sections + citation links). |
| `tests/test_scout_extractor.py` | Lenient JSON parse + fallback when LLM returns garbage. |
| `tests/test_scout_synthesizer.py` | Same shape contract on synthesizer output. |
| `tests/test_frontier_labs.py` | Mock crawl_urls_sync, verify ScanResult shape. |

### Modified files

| Path | Change |
|---|---|
| [backend/scout/engine.py](backend/scout/engine.py) | `run()` orchestrates `gather → extract → synthesize → persist`. The legacy markdown-only `synthesize()` becomes a fallback when extraction fails. Token-usage tuple shape preserved; cost_breakdown sums per-stage usage. |
| [backend/scout/modules/community_sentiment.py](backend/scout/modules/community_sentiment.py) | Multi-query rewrite, drop TLDR AI. |
| [backend/scout/modules/expert_synthesis.py](backend/scout/modules/expert_synthesis.py) | Multi-query rewrite against curated domains. |
| [backend/scout/modules/technical_deep_dive.py](backend/scout/modules/technical_deep_dive.py) | 5 sub-area ArXiv queries, dedupe. |
| [backend/scout/modules/tooling_and_tactics.py](backend/scout/modules/tooling_and_tactics.py) | Refresh URL list. |
| [backend/scout/__init__.py](backend/scout/__init__.py) | Export new types. |
| [backend/api/schemas.py](backend/api/schemas.py) | `ScoutJobResult.briefing: dict \| None` next to existing `report_md` + `cost_breakdown`. |
| [backend/api/routes/scout.py](backend/api/routes/scout.py) | Pass `briefing` through; richer `progress.callbacks` for the new stages. |
| [backend/core/settings.py](backend/core/settings.py) | New knobs: `scout_extractor_model` (default `openai/gpt-4o-mini`), `scout_synthesizer_model` (default `openai/gpt-4o-mini`), `scout_memory_days: int = 30`. |
| [backend/core/paths.py](backend/core/paths.py) | Add `scout_run_dir(run_id)` + `scout_index_path()` helpers. |
| [ui/streamlit_app.py](ui/streamlit_app.py) | Render structured `briefing` (Themes / Tensions / Gaps / Action Items as separate sections). Markdown fallback. Update `MODULE_OPTIONS` to include `frontier_labs`. |

### Reused without change

- [backend/scout/modules/crawl4ai_helper.py](backend/scout/modules/crawl4ai_helper.py) — `crawl_urls_sync` is the right primitive for `frontier_labs`.
- [backend/scout/modules/long_form_strategy.py](backend/scout/modules/long_form_strategy.py) — URLs are still the strongest in the curated newsletter set.
- [backend/scout/modules/base.py](backend/scout/modules/base.py) — `BaseScanner.scan(days)` signature unchanged. Module-level query/URL lists stay private.
- [backend/core/pricing.py](backend/core/pricing.py) — already has `text_cost(model, ...)` for cost computation.
- [backend/core/jobs.py](backend/core/jobs.py) — JobStore + JobRunner unchanged.
- [backend/utils/post_parser.py](backend/utils/post_parser.py) `parse_h2_sections` — handy for renderer testing.

---

## Cost (gpt-4o-mini defaults)

Per scout run, on top of existing scanner cost (Tavily + crawl4ai):

| Stage | In tokens | Out tokens | Cost |
|---|---:|---:|---:|
| Extractor | ~15-30k | ~2-3k | $0.003–$0.006 |
| Synthesizer | ~3-5k | ~1.5k | $0.001–$0.002 |
| **Total** | | | **~$0.005–$0.01** |

Bump either to `openai/gpt-5` via `.env` for richer reasoning at ~$0.10–$0.20.

---

## Memory schema

`outputs/scout/index.jsonl` — append-only, one line per finalized briefing:

```json
{
  "run_id": "20260505_134200",
  "created_at": "2026-05-05T03:42:00Z",
  "modules": ["community_sentiment", "frontier_labs", ...],
  "days": 7,
  "lead": "...",
  "claims": [
    {"id": "f1", "claim": "...", "source_url": "..."},
    ...
  ]
}
```

`scout/memory.py` reads the last `scout_memory_days` rows, builds `MemorySnapshot{covered_urls, covered_claims}`, hands it to the extractor. The extractor marks any item whose `source_url ∈ covered_urls` as `novelty: "stale"`; the synthesizer drops those. Items that are clearly follow-ups to covered claims get `novelty: "follow_up"` and stay in the briefing tagged accordingly.

---

## What the user sees in the UI feed

```
🚦 Memory · 47 covered claims, 38 covered URLs from 12 prior briefings
🛠 Gather · community_sentiment: 4 queries planned (corp / launches / prod / benchmarks)
🛠 Gather · frontier_labs: 7 lab pages
🛠 Gather · technical_deep_dive: 5 ArXiv sub-areas
📥 community_sentiment · 18 items
📥 frontier_labs · 12 items (3 OpenAI, 2 Anthropic, …)
📥 technical_deep_dive · 12 unique papers (after dedupe)
🔬 Extractor · 64 raw → 27 findings (19 novel · 6 follow-up · 2 stale)
✍️  Synthesizer · 27 findings → 4 themes · 2 tensions · 2 gaps
✅ Done · outputs/scout/20260505_134200/
```

---

## Verification

1. **Unit tests:**
   ```
   uv run pytest -q
   ```
   - Memory append + dedup-window read
   - Renderer produces all four sections + citation hyperlinks
   - Extractor lenient-JSON parse handles fenced blocks + prose-wrapped JSON
   - Synthesizer fallback when LLM output is malformed
   - frontier_labs module returns a valid `ScanResult` with mocked `crawl_urls_sync`

2. **End-to-end:**
   ```
   make dev
   ```
   In the UI, deselect all modules, select only `frontier_labs`, run. Verify items show OpenAI / Anthropic / DeepMind blog entries with publication dates.

   Then run with all 6 modules. Verify:
   - The new 4-stage feed is visible
   - Extractor count shows novel/follow_up/stale split
   - Briefing renders with Lead / Themes / Tensions / Gaps / Action Items as separate sections
   - `outputs/scout/{run_id}/briefing.json` and `.md` both exist
   - `outputs/scout/index.jsonl` got one new line

3. **Dedup check:** run the same module set twice in quick succession with no fresh news. The second run should show `stale` count > 0 and the synthesizer should produce a different lead — typically a follow-up or a "no new movement on X" framing.

4. **Cost check:** sidebar's session cost should rise by ~$0.01 (or whatever the new models cost) per run. The per-run breakdown in the result should show separate `extractor` and `synthesizer` blocks.

5. **CLI backward-compat:** `uv run run_scout` should still work — it doesn't go through the API, it calls `PulseScout().run(...)` directly. The new pipeline is the same call.

---

## Out of scope (deliberately deferred)

- LLM-driven query planning (the user explicitly opted out: "keep hardcoded")
- Topic input field (user opted to stay module-only)
- Caching of Tavily / ArXiv responses across runs
- Cross-encoder reranking of raw items before extraction
- Auto-suggesting trending topics
- A "deep" preset with multi-round refinement
