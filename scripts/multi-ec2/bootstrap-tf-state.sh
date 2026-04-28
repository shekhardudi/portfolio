#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
BUCKET="${STATE_BUCKET:-portfolio-multi-ec2-tfstate}"
TABLE="${LOCK_TABLE:-portfolio-multi-ec2-tflock}"

echo "Region : $REGION"
echo "Bucket : $BUCKET"
echo "Table  : $TABLE"
echo

if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  echo "S3 bucket '$BUCKET' already exists - skipping create."
else
  echo "Creating S3 bucket '$BUCKET'..."
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION"
  fi
fi

aws s3api put-bucket-versioning --bucket "$BUCKET" --region "$REGION" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET" --region "$REGION" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGION" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "DynamoDB table '$TABLE' already exists - skipping create."
else
  echo "Creating DynamoDB lock table '$TABLE'..."
  aws dynamodb create-table --region "$REGION" \
    --table-name "$TABLE" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
fi

echo
cat <<EOF
Now run:
  cd infra/multi-ec2/terraform
  terraform init -backend-config="bucket=$BUCKET" \
                 -backend-config="key=portfolio/multi-ec2/prod.tfstate" \
                 -backend-config="region=$REGION" \
                 -backend-config="dynamodb_table=$TABLE"
EOF
