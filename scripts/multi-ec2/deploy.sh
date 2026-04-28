#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/infra/multi-ec2/terraform"

if [[ ! -f envs/prod/terraform.tfvars ]]; then
  echo "Missing envs/prod/terraform.tfvars"
  echo "Copy envs/prod/terraform.tfvars.example and set values first."
  exit 1
fi

terraform init
terraform plan -var-file=envs/prod/terraform.tfvars -out=tfplan
terraform apply tfplan
