# Portfolio Platform

Unified portfolio platform on AWS — a Next.js 14 frontend showcasing three production-grade ML/AI solutions (intelli-search, agentic-hr, linkedin-generator), each with a live demo wired to a FastAPI backend running on a single EC2 box.

## Architecture

```
Route 53 (shekharlabs.com)
 +-- shekharlabs.com / www  -> CloudFront -> Amplify (Next.js apps/web)
 +-- api.shekharlabs.com    -> CloudFront -> EC2 :443 (nginx)
 |                                            +-- /intelli-search/*      -> :8001
 |                                            +-- /agentic-hr/*          -> :8002
 |                                            +-- /linkedin-generator/*  -> :8003
 +-- dashboards.shekharlabs.com -> CloudFront -> EC2 nginx -> :5601 (basic-auth)
```

EC2: t3.xlarge (4 vCPU / 16 GB / 150 GB gp3), single AZ, EIP, daily EBS snapshot.

## Repo layout

```
apps/web/                     # Next.js 14 frontend (App Router + shadcn/ui)
  solutions/                  # plugin folder (registry-driven)
services/                     # three FastAPI backends (copied & cleaned)
  intelli-search/
  agentic-hr/
  linkedin-generator/
infra/
  single-ec2/                 # current prod topology (docker + terraform)
  multi-ec2/                  # multi-instance topology (docker + terraform)
  local/                      # local backend docker runtime
docs/                         # architecture, deployment, per-solution docs
scripts/                      # compatibility wrappers + track-specific scripts
```

## Quick links

- [Architecture](docs/architecture.md)
- [Deployment guide](docs/deployment.md)
- [intelli-search](docs/solutions/intelli-search.md)
- [agentic-hr](docs/solutions/agentic-hr.md)
- [linkedin-generator](docs/solutions/linkedin-generator.md)

## Local development

Frontend:
```
cd apps/web
pnpm install
pnpm dev        # http://localhost:3000
```

Backends (single service):
```
cd services/<name>
docker build -t <name> .
docker run --rm -p 8000:8000 --env-file .env <name>
```

Combined runtime (mirrors prod):
```
cd infra/single-ec2/docker
cp env/intelli-search.env.example   env/intelli-search.env
cp env/agentic-hr.env.example       env/agentic-hr.env
cp env/linkedin-generator.env.example env/linkedin-generator.env
# fill in real values, then:
docker compose -f docker-compose.prod.yml up -d
```

Local backend-only runtime:
```
./scripts/local/bootstrap-env.sh
./scripts/local/up.sh
```

## Deployment

See [docs/deployment.md](docs/deployment.md). One-line summary:
```
cd infra/single-ec2/terraform/envs/prod
terraform init && terraform apply
```
