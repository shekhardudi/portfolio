# intelli-search

Hybrid LinkedIn-profile search built on OpenSearch with three execution modes:

1. **Regular** — BM25 keyword search.
2. **Semantic** — kNN vector search (384-dim sentence-transformer embeddings).
3. **Agentic** — LangGraph-style orchestrator that picks the best strategy per query and uses Reciprocal Rank Fusion to merge results.

Routed by an Intent Classifier (GPT-4o-mini + Instructor).

## Endpoints

| Method | Path                             | Notes                                   |
|--------|----------------------------------|-----------------------------------------|
| POST   | `/search/intelligent`            | Main JSON endpoint                      |
| GET    | `/search/intelligent/stream`     | Server-Sent Events                      |
| GET    | `/health`                        | Liveness                                |

## Local run

```
docker build -t intelli-search .
docker run --rm -p 8001:8000 --env-file .env intelli-search
```

## Prod port

`8001` on the host (mapped to container `:8000`). See `infra/docker/docker-compose.prod.yml`.

## Required env

See [.env.example](.env.example).

## Data ingestion

`data-pipeline/` ships with `data_ingestion_pipeline.py`. For one-off bulk loads from your laptop, prefer an SSH tunnel rather than opening :9200:

```
ssh -i ~/.ssh/portfolio.pem -L 9200:localhost:9200 ec2-user@<EIP>
python data-pipeline/data_ingestion_pipeline.py --host http://localhost:9200
```
