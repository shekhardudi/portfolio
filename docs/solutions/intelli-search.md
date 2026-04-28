# intelli-search

Hybrid search over millions of LinkedIn-style profiles. Three execution modes,
auto-routed by an intent classifier, fused with Reciprocal Rank Fusion.

## Modes

| Mode | What it does | When the classifier picks it |
|---|---|---|
| `regular` | BM25 keyword search over indexed fields | Short, exact-match-y queries (companies, names, titles) |
| `semantic` | kNN over 384-dim embeddings (HNSW) | Conceptual / paraphrase queries |
| `agentic` | LangGraph orchestrator that issues sub-queries, re-ranks with an LLM | Multi-clause / reasoning-heavy queries |
| `auto` | Classifier routes to one of the above | Default |

## Why hybrid

BM25 wins on rare technical terms ("Rust borrow checker"), embeddings win on synonyms
("ML engineer" ≈ "machine learning practitioner"). RRF lets us blend without tuning a
weighted sum.

## Endpoints

```
POST /search/intelligent       { query, mode?, size? } -> { hits, duration_ms, classifier_intent }
GET  /search/intelligent/stream  ?query=...&mode=...    -> SSE stream of incremental hits
GET  /health
```

## Cold-start gotcha

OpenSearch's HNSW graph for 7M × 384-dim vectors is ~5–7 GB. First kNN query on a fresh
container will time out. The startup hook calls `warmup_knn(index_name)` to load the graph
into native memory before serving traffic.

## Local dev

```bash
cd services/intelli-search
docker build -t intelli-search .
docker run --rm -p 8001:8000 --env-file .env intelli-search
curl http://localhost:8001/health
```

## Bulk ingest

The pipeline lives in `services/intelli-search/data-pipeline/`. For one-off loads from
your laptop, prefer SSH tunnel over opening :9200 publicly:

```bash
ssh -i ~/.ssh/portfolio.pem -L 9200:localhost:9200 ec2-user@<EIP>
python services/intelli-search/data-pipeline/data_ingestion_pipeline.py --host http://localhost:9200
```
