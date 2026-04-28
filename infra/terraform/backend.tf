# Remote state lives in S3; lock table in DynamoDB. Bootstrap both with
# scripts/bootstrap-tf-state.sh. Provide bucket / table at init time:
#
#   terraform init \
#     -backend-config="bucket=shekharlabs-tfstate" \
#     -backend-config="key=portfolio/prod.tfstate" \
#     -backend-config="region=us-east-1" \
#     -backend-config="dynamodb_table=shekharlabs-tflock"
terraform {
  backend "s3" {
    encrypt = true
  }
}
