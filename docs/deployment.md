# Deployment guide

End-to-end deploy from a fresh laptop. ~30 minutes the first time, ~2 minutes for code-only updates.

## 0. Prereqs

| Tool | Version | Notes |
|---|---|---|
| AWS CLI | v2 | `aws configure` with an IAM user that has `AdministratorAccess` (or scope down later) |
| Terraform | ≥ 1.6 | `brew install terraform` |
| Node | ≥ 20 | for local frontend dev |
| pnpm | 9 | `npm i -g pnpm@9` |
| Docker | 24+ | for local backend dev |
| GitHub PAT | — | `repo` scope; Amplify pulls source via this |

A Route 53–delegated domain. If you bought it elsewhere (Namecheap, etc.), update the registrar's
nameservers to the four NS values Terraform outputs as `route53_name_servers` after the first apply.

## 1. Bootstrap Terraform state

Creates the S3 bucket + DynamoDB lock table. Idempotent.

```bash
./scripts/single-ec2/bootstrap-tf-state.sh
```

Outputs the exact `terraform init` command to run next.

## 2. Push secrets to SSM Parameter Store

For each service, push the keys you want hydrated into its `.env` on EC2 boot:

```bash
aws ssm put-parameter --name "/portfolio/prod/intelli-search/OPENAI_API_KEY"  --type SecureString --value "$OPENAI_API_KEY"
aws ssm put-parameter --name "/portfolio/prod/intelli-search/OPENSEARCH_PASSWORD" --type SecureString --value "$(openssl rand -base64 24)"
aws ssm put-parameter --name "/portfolio/prod/agentic-hr/OPENAI_API_KEY"      --type SecureString --value "$OPENAI_API_KEY"
aws ssm put-parameter --name "/portfolio/prod/agentic-hr/POSTGRES_PASSWORD"   --type SecureString --value "$(openssl rand -base64 24)"
aws ssm put-parameter --name "/portfolio/prod/linkedin-generator/OPENAI_API_KEY"    --type SecureString --value "$OPENAI_API_KEY"
aws ssm put-parameter --name "/portfolio/prod/linkedin-generator/ANTHROPIC_API_KEY" --type SecureString --value "$ANTHROPIC_API_KEY"
aws ssm put-parameter --name "/portfolio/prod/dashboards/basic_auth"          --type SecureString --value "admin:$(openssl passwd -apr1 'choose-a-password')"
```

Add anything else (`TAVILY_API_KEY`, model overrides, etc.) under the same prefix. Each
`<KEY>` ends up as a line in the corresponding `<service>.env` file.

## 3. Pre-create EC2 keypair

```bash
aws ec2 create-key-pair --key-name portfolio-prod \
  --query 'KeyMaterial' --output text > ~/.ssh/portfolio.pem
chmod 400 ~/.ssh/portfolio.pem
```

## 4. Configure & apply

```bash
cd infra/single-ec2/terraform
cp envs/prod/terraform.tfvars.example envs/prod/terraform.tfvars
# fill in: ssh_ingress_cidr, key_name, github_repo_url

export TF_VAR_amplify_oauth_token=ghp_xxxxxxxxxxxxxxxxxxxx

terraform init \
  -backend-config="bucket=shekharlabs-tfstate" \
  -backend-config="key=portfolio/prod.tfstate" \
  -backend-config="region=us-east-1" \
  -backend-config="dynamodb_table=shekharlabs-tflock"

terraform plan  -var-file=envs/prod/terraform.tfvars -out=tfplan
terraform apply tfplan
```

First apply creates: VPC, EC2, EIP, Route53 zone, ACM cert, two CloudFront distributions, Amplify
app. Takes 10–25 min (CloudFront propagation dominates).

## 5. Delegate the domain (one-time)

If your registrar isn't AWS:

```bash
terraform output route53_name_servers
# Copy the four ns-*.awsdns-*.{com,net,org,co.uk} values into your registrar.
```

Validation (ACM, Amplify) won't complete until DNS resolves through Route 53.

## 6. Verify

```bash
terraform output api_url            # https://api.shekharlabs.com
terraform output site_url           # https://shekharlabs.com
terraform output dashboards_url     # https://dashboards.shekharlabs.com

# Each backend should respond to /health
curl  -fsSL https://api.shekharlabs.com/intelli-search/health
curl  -fsSL https://api.shekharlabs.com/agentic-hr/health
curl  -fsSL https://api.shekharlabs.com/linkedin-generator/health

# Site
open https://shekharlabs.com
```

Cold start of the EC2 stack takes ~3 min after `apply` finishes (Docker images pull, OpenSearch
warms its HNSW graph, etc.). Re-run the curl commands until they return 200.

## 7. Code-only updates

Two paths:

**Frontend:** push to `main`. Amplify auto-builds + deploys.

**Backend:** SSH in and recompose:
```bash
ssh -i ~/.ssh/portfolio.pem ec2-user@$(terraform output -raw ec2_public_ip)
cd portfolio && git pull
cd infra/single-ec2/docker
docker compose -f docker-compose.prod.yml up -d --build <service-name>
```

Or, after editing locally:
```bash
./scripts/single-ec2/sync-from-source.sh   # if pulling fresh code from ../ai-workspace/
git push
ssh ... && cd portfolio && git pull && docker compose -f infra/single-ec2/docker/docker-compose.prod.yml up -d --build
```

## 8. Operational tasks

- **Bulk-load OpenSearch** (laptop):
  ```bash
  ssh -i ~/.ssh/portfolio.pem -L 9200:localhost:9200 ec2-user@<EIP>
  python services/intelli-search/data-pipeline/data_ingestion_pipeline.py --host http://localhost:9200
  ```
- **Inspect logs**:
  ```bash
  docker compose -f infra/single-ec2/docker/docker-compose.prod.yml logs -f intelli-search
  sudo tail -f /var/log/nginx/error.log
  ```
- **Rotate a secret**: `aws ssm put-parameter --overwrite ...`, then re-run user-data
  (`sudo bash /var/lib/cloud/instance/scripts/part-001`) or just SSH and reload the env.

## 9. Tearing down

```bash
cd infra/single-ec2/terraform
terraform destroy -var-file=envs/prod/terraform.tfvars
```

S3 state bucket + DynamoDB lock table are NOT destroyed by Terraform — delete manually if needed
(`scripts/single-ec2/bootstrap-tf-state.sh` is the inverse, just reverse-engineer the AWS CLI calls).
