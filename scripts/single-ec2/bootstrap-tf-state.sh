#!/usr/bin/env bash
# One-time creation of the S3 bucket + DynamoDB table that hold Terraform's
# remote state and lock for this project. Idempotent. Safe to re-run.
#
# Required env (or pass via flags):
#   AWS_REGION   default: us-east-1
#   STATE_BUCKET default: shekharlabs-tfstate
#   LOCK_TABLE   default: shekharlabs-tflock
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
BUCKET="${STATE_BUCKET:-shekharlabs-tfstate}"
TABLE="${LOCK_TABLE:-shekharlabs-tflock}"

echo "Region : $REGION"
echo "Bucket : $BUCKET"
echo "Table  : $TABLE"
echo

# ---- S3 bucket ------------------------------------------------------------
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  echo "S3 bucket '$BUCKET' already exists — skipping create."
else
  echo "Creating S3 bucket '$BUCKET'..."
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION"
  fi
fi

echo "Enforcing bucket hardening (versioning, encryption, public-access block)..."
aws s3api put-bucket-versioning  --bucket "$BUCKET" --region "$REGION" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption  --bucket "$BUCKET" --region "$REGION" \
  --server-side-encryption-configuration '{
    "Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]
  }'
aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGION" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# ---- DynamoDB lock table --------------------------------------------------
if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "DynamoDB table '$TABLE' already exists — skipping create."
else
  echo "Creating DynamoDB lock table '$TABLE'..."
  aws dynamodb create-table --region "$REGION" \
    --table-name "$TABLE" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
fi

echo
echo "Done."
echo "Now run:"
echo "  cd infra/single-ec2/terraform/envs/prod"
echo "  terraform init -backend-config=\"bucket=$BUCKET\" \\"
echo "                 -backend-config=\"key=portfolio/prod.tfstate\" \\"
echo "                 -backend-config=\"region=$REGION\" \\"
echo "                 -backend-config=\"dynamodb_table=$TABLE\""
