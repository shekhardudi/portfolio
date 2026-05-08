#!/usr/bin/env bash
# Open an SSM port-forwarding tunnel from the local machine to OpenSearch (9200)
# on the single-EC2 host. Lets you ingest into the prod cluster from your
# laptop without exposing 9200 publicly.
#
# Prereqs:
#   - AWS CLI v2 + Session Manager plugin
#       brew install --cask session-manager-plugin
#   - IAM creds with ssm:StartSession permission on this instance
#
# Usage:
#   bash scripts/single-ec2/tunnel-opensearch.sh                # default 9200 -> 9200
#   PORT=5601 bash scripts/single-ec2/tunnel-opensearch.sh      # forward dashboards (5601)
#   AWS_REGION=ap-southeast-2 PORT=9200 LOCAL_PORT=19200 ./tunnel-opensearch.sh
#
# Then from another shell:
#   curl -k -u admin:"$OPENSEARCH_PASSWORD" https://localhost:9200/_cluster/health

set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
PORT="${PORT:-9200}"
LOCAL_PORT="${LOCAL_PORT:-$PORT}"
TAG_NAME="${INSTANCE_TAG_NAME:-portfolio-prod-host}"

echo "Resolving instance with tag Name=$TAG_NAME in $REGION ..."
INSTANCE_ID=$(aws ec2 describe-instances \
  --region "$REGION" \
  --filters "Name=tag:Name,Values=$TAG_NAME" \
            "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text)

if [[ -z "$INSTANCE_ID" || "$INSTANCE_ID" == "None" ]]; then
  echo "No running instance found with tag Name=$TAG_NAME in region $REGION." >&2
  exit 1
fi

echo "Instance: $INSTANCE_ID"
echo "Forwarding localhost:$LOCAL_PORT -> $INSTANCE_ID:$PORT (Ctrl-C to stop)"

aws ssm start-session \
  --region "$REGION" \
  --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSession \
  --parameters "{\"portNumber\":[\"$PORT\"],\"localPortNumber\":[\"$LOCAL_PORT\"]}"
