# Architecture

## High-level

```
                          ┌──────────────────────┐
                          │       Route 53       │
                          │  shekharlabs.com     │
                          └──────────┬───────────┘
                                     │
        ┌────────────────────────────┼─────────────────────────────┐
        │                            │                             │
   ALIAS apex/www              ALIAS api.*                    ALIAS dashboards.*
        │                            │                             │
   ┌────▼────────┐            ┌──────▼──────────┐          ┌───────▼─────────┐
   │ AWS Amplify │            │   CloudFront    │          │   CloudFront    │
   │ Next.js SSR │            │  (api origin)   │          │  (dash origin)  │
   └─────────────┘            └────────┬────────┘          └────────┬────────┘
                                       │                            │
                                ┌──────▼──────────────────  ────────▼──────┐
                                │             EC2 t3.xlarge (single AZ)    │
                                │  ┌──────── nginx :443 ───────────┐       │
                                │  │ /intelli-search/  → :8001     │       │
                                │  │ /agentic-hr/      → :8002     │       │
                                │  │ /linkedin-generator/ → :8003  │       │
                                │  │ dashboards.*       → :5601    │       │
                                │  └──────────────────────────────┘        │
                                │                                          │
                                │  docker-compose.prod.yml                 │
                                │  ├ intelli-search   (FastAPI)            │
                                │  ├ agentic-hr       (FastAPI)            │
                                │  ├ linkedin-gen     (FastAPI)            │
                                │  ├ opensearch + dashboards               │
                                │  ├ postgres (pgvector) + nocodb          │
                                │  ├ gitea + mattermost                    │
                                │  └ redis                                 │
                                └──────────────────────────────────────────┘
```

## Why this shape

**Single EC2 box** for all backends. This is a portfolio, not a SaaS — running three separate
ECS services would 3× the cost and add zero learning value. A `t3.xlarge` (4 vCPU / 16 GB) handles
all three FastAPI apps + OpenSearch + Postgres comfortably for demo traffic. EBS gp3 + daily DLM
snapshots cover durability.

**CloudFront in front of EC2** for two reasons: (1) free TLS terminations + edge caching for static
assets, (2) the security group can lock the EC2 to CloudFront's managed prefix list, so the box has
zero direct internet exposure on 80/443. SSH is locked to the operator's `/32`.

**Amplify for Next.js** rather than self-hosting on the same EC2 — Amplify gives free CI/CD on push,
SSR support, atomic deploys, and built-in CloudFront. Splitting the frontend off the box also means
a frontend deploy can't take down the API.

**Plugin-style solution registry** in `apps/web/solutions/` so new demos slot in without touching
the layout, routing, or homepage. Each solution exports a `meta`, optional `Demo` and `Architecture`
components, and the framework wires them into a tabbed page automatically.

## Network

- **VPC**: `10.40.0.0/16`, single public subnet, IGW.
- **Security group**: 22 from operator IP, 80/443 from `com.amazonaws.global.cloudfront.origin-facing` prefix list, all egress allowed.
- **EIP**: pinned to the instance so DNS doesn't drift on reboot.
- **IMDSv2 only** on the instance (token-required metadata).

## Compute

- **Instance**: `t3.xlarge` Amazon Linux 2, 150 GB gp3 root volume, encrypted.
- **User-data** (`infra/single-ec2/terraform/modules/ec2/user-data.sh.tftpl`):
  1. Install Docker, docker-compose v2, nginx, certbot, awscli.
  2. `git clone` the portfolio repo.
     3. `aws ssm get-parameters-by-path` → write `infra/single-ec2/docker/env/<service>.env` files.
     4. Drop `infra/single-ec2/docker/nginx/nginx.conf` into `/etc/nginx/`.
  5. Issue Let's Encrypt cert for `api.*` and `dashboards.*` (CloudFront → EC2 leg).
     6. `docker compose -f infra/single-ec2/docker/docker-compose.prod.yml up -d`.

## Data services

| Service        | Image                            | Bind            | Notes |
|----------------|----------------------------------|-----------------|-------|
| OpenSearch     | `opensearchproject/opensearch:2.13.0` | `127.0.0.1:9200` | 3 GB heap |
| OS Dashboards  | `opensearchproject/opensearch-dashboards:2.13.0` | `127.0.0.1:5601` | nginx + basic auth |
| Postgres       | `pgvector/pgvector:pg16`         | `127.0.0.1:5432` | 4 DBs (agentic_hr, nocodb, gitea, mattermost) |
| NocoDB         | `nocodb/nocodb:latest`           | `127.0.0.1:8080` | HRIS records UI |
| Gitea          | `gitea/gitea:latest`             | `127.0.0.1:3000` | code-review workflow demo |
| Mattermost     | `mattermost/mattermost-team-edition:latest` | `127.0.0.1:8065` | chat-driven request demo |
| Redis          | `redis:7-alpine`                 | `127.0.0.1:6379` | intelli-search cache |

All ports `127.0.0.1`-bound — backends reach them via Docker network names, so the SG never has to
open them.

## Secrets

- **AWS SSM Parameter Store**, prefix `/portfolio/prod/<service>/<KEY>`, all SecureString.
- EC2 instance role has `ssm:GetParametersByPath` for that exact prefix only.
- User-data hydrates `.env` files on boot. Rotation: update SSM, run `sudo systemctl restart docker`.
- **Never** commit a `.env`. Only `*.env.example` files exist in git.

## Frontend deploy

- Amplify auto-builds on push to `main`. Build root is `apps/web/`.
- Build command: `pnpm install --frozen-lockfile && pnpm build` (see [apps/web/amplify.yml](../apps/web/amplify.yml)).
- Public env vars are set at the Amplify app level via Terraform.

## Observability

For now: container logs via `docker logs`, nginx access logs in `/var/log/nginx/`. The intelli-search
service has built-in OpenTelemetry export (set `OTLP_ENDPOINT` to enable). Adding a Grafana stack on
the same box is one compose service away — left out of v1 to keep the initial deploy boring.
