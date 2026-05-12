# linkedin-generator — high-level flow

Two pipelines stitched into one workspace:

1. **Scout** — gathers AI-sector signals from 5 source modules, extracts
   atomic findings via LLM, synthesises a briefing of pickable signals.
2. **Crew** — once the user picks a signal (or types a topic), a
   CrewAI-driven Researcher → Writer → Critic → Visual Director sequence
   produces a finished LinkedIn post plus a cover image.

Both run as **background jobs** persisted to JSONL via `JobRunner` +
`JobStore`, so the frontend polls and can survive navigation.

## Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       Next.js frontend                            │
│   ScoutPanel ─► picks a signal ─► ProductionStudio ─► Output     │
└────────┬──────────────────────────────────────────┬──────────────┘
         │ POST /scout                              │ POST /posts
         ▼                                          ▼
┌────────────────────────────────────────────────────────────────────┐
│             FastAPI :8000 — JobRunner (in-process)                  │
│   • create()   → JSONL row in outputs/jobs/<kind>.jsonl             │
│   • schedule() → asyncio.Task on bounded semaphore                  │
│   • GET /scout/{id} or /posts/{id}  ─► poll status/progress/result  │
│   • DELETE → cancel, frees worker slot                              │
└─────────┬──────────────────────────────────────────────┬───────────┘
          │                                              │
          ▼  SCOUT pipeline                              ▼  CREW pipeline
┌─────────────────────────────────────────┐    ┌───────────────────────────┐
│  scout/engine.py — PulseScout           │    │  post_generator/          │
│                                         │    │  AuthorityCrew (CrewAI)   │
│  Gather 5 modules in parallel:          │    │                           │
│   ┌───────────────────────────────┐     │    │   Researcher              │
│   │ frontier_labs                 │     │    │     (Arxiv + Tavily)      │
│   │   RSS: OpenAI, DeepMind, HF   │     │    │       │                   │
│   │   crawl: Anthropic, Meta AI,  │     │    │       ▼                   │
│   │          xAI, Mistral         │     │    │     Fact Sheet            │
│   ├───────────────────────────────┤     │    │       │                   │
│   │ top_newsletters               │     │    │       ▼                   │
│   │   RSS: Latent Space, Import   │     │    │   Writer (Opus)           │
│   │        AI, MIT TR, TLDR AI    │     │    │     5-part LinkedIn post  │
│   │   crawl: Neuron, Rundown,     │     │    │     (Hook/Brain/Soul/     │
│   │          AINews               │     │    │      Gift/Handshake)      │
│   ├───────────────────────────────┤     │    │       │                   │
│   │ technical_deep_dive (ArXiv)   │     │    │       ▼                   │
│   ├───────────────────────────────┤     │    │   Critic                  │
│   │ community_sentiment           │     │    │     enforces "## Final-   │
│   │   Tavily / Reddit / HN        │     │    │     ized Post" header,    │
│   ├───────────────────────────────┤     │    │     drops echoes of user  │
│   │ expert_synthesis              │     │    │     inputs                │
│   │   RSS: Karpathy, Mollick,     │     │    │       │                   │
│   │        Willison               │     │    │       ▼                   │
│   │   crawl: Andrew Ng, AMI Labs  │     │    │   post_parser →           │
│   │   Tavily: Yann LeCun          │     │    │     post_draft (or "" →   │
│   └───────────────────────────────┘     │    │     status=failed)        │
│                                         │    │       │                   │
│   ▼  Date-filtered ScanResult lists     │    │       ▼                   │
│                                         │    │   Visual Director         │
│   extractor.py (LLM)                    │    │     (Anthropic SDK)       │
│     • wraps content in                  │    │     → image_plan          │
│       <external_content>…</…>           │    │       │                   │
│     • scrub_input on every item         │    │       ▼                   │
│       (block injection, redact PII)     │    │   Image generation        │
│     • emits Finding{...,published_at}   │    │     /images endpoint      │
│                                         │    │     (background job)      │
│   ▼                                     │    └───────────┬───────────────┘
│   synthesizer.py (LLM)                  │                │
│     • derives Signal.published_at =     │                │
│       max(cited findings)               │                │
│     • emits Briefing{lead, signals,     │                │
│       themes, gaps, action_items}       │                │
│                                         │                │
│   ▼  /scout/{id}.result.briefing        │                ▼
│   Output guardrail (_scrub_briefing_    │       Output guardrail
│   pii) strips emails/phones from        │       (scrub_output strips
│   every text field; names pass through  │        emails/phones from
│                                         │        post_draft)
└─────────────────────────────────────────┘
```

## Request lifecycle

### Scout

1. `POST /scout` with `{modules: [...], days: N}` → creates a `scout`
   job, returns `{job_id}`.
2. **Module fan-out** — `PulseScout.run_with_briefing()` calls each
   selected scanner in parallel. RSS-backed sources hard-filter by
   `days_to_cutoff(days)`; crawl-backed sources attach `cutoff_date` for
   soft enforcement downstream.
3. **Extractor** — LLM turns raw items into `Finding` objects with
   `published_at`. Every item's content is wrapped in
   `<external_content>` and run through `scrub_input` so prompt-injection
   payloads in scraped HTML are blocked or redacted.
4. **Synthesizer** — second LLM call shapes findings into a `Briefing`
   with pickable `Signal[]`. `Signal.published_at` is derived from the
   newest cited finding (post-processing, no LLM).
5. **Output scrub** — `_scrub_briefing_pii` walks the briefing and
   strips emails/phone numbers from every text field. Names pass through.
6. Frontend `GET /scout/{job_id}` polls until `status=completed`, then
   renders signals + findings with the "Pub MMM DD" pill from
   `published_at`.

### Crew (Studio)

1. `POST /posts` with `{topic, leader_angle, author_name, author_title,
   author_vibe, audience}` → input fields run through `scrub_input`
   (HTTP 400 on prompt injection; silent redaction of emails/phones).
2. **CrewAI sequence** — Researcher pulls Arxiv + Tavily into a Fact
   Sheet; Writer drafts the 5-part LinkedIn post (Opus); Critic enforces
   the `## Finalized Post` header and forbids echoing user inputs.
3. **post_parser** extracts the finalised body. If the Critic didn't
   emit the header (malformed run), the parser returns `""` and the
   worker raises `RuntimeError("model output malformed: ...")` —
   `JobRunner` marks the job `status=failed` rather than letting raw
   crew reasoning leak as the post.
4. **Output scrub** — `scrub_output(post_draft)` strips emails/phones.
5. **Visual Director** builds an image plan from the post + emotional
   beats; image generation is a follow-up job via `/images`.

## Key files

| Concern | Path |
|---|---|
| Scout HTTP routes | [services/linkedin-generator/backend/api/routes/scout.py](../../services/linkedin-generator/backend/api/routes/scout.py) |
| Crew HTTP routes | [services/linkedin-generator/backend/api/routes/posts.py](../../services/linkedin-generator/backend/api/routes/posts.py) |
| Job runner / store | [services/linkedin-generator/backend/core/jobs.py](../../services/linkedin-generator/backend/core/jobs.py) |
| Module scanners | [services/linkedin-generator/backend/scout/modules/](../../services/linkedin-generator/backend/scout/modules/) |
| Extractor + synthesizer | [services/linkedin-generator/backend/scout/](../../services/linkedin-generator/backend/scout/) |
| CrewAI agents/tasks | [services/linkedin-generator/backend/post_generator/config/](../../services/linkedin-generator/backend/post_generator/config/) |
| Output parser | [services/linkedin-generator/backend/utils/post_parser.py](../../services/linkedin-generator/backend/utils/post_parser.py) |
| Guardrails | [services/linkedin-generator/backend/guardrails/](../../services/linkedin-generator/backend/guardrails/) |
| Frontend Scout UI | [apps/web/solutions/linkedin-generator/ScoutPanel.tsx](../../apps/web/solutions/linkedin-generator/ScoutPanel.tsx) |
| Frontend Studio UI | [apps/web/solutions/linkedin-generator/ProductionStudio.tsx](../../apps/web/solutions/linkedin-generator/ProductionStudio.tsx) |
