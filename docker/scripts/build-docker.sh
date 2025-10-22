#!/bin/bash
set -e

echo "=== WebRTC KVS Agent - Dockerイメージビルド ==="
echo ""

REGION=${AWS_REGION:-us-west-2}
IMAGE_NAME="webrtc-kvs-agent"
TAG=${1:-latest}

echo "Step 1: ECRにログイン中..."
aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin 546150905175.dkr.ecr.$REGION.amazonaws.com

echo ""
echo "Step 2: Dockerイメージをビルド中..."
cd "$(dirname "$0")/.."
docker build -t $IMAGE_NAME:$TAG .

echo ""
echo "✅ ビルド完了"
echo "Image: $IMAGE_NAME:$TAG"
echo ""
echo "実行するには:"
echo "  docker run --rm \\"
echo "    -e AWS_ACCESS_KEY_ID=\$AWS_ACCESS_KEY_ID \\"
echo "    -e AWS_SECRET_ACCESS_KEY=\$AWS_SECRET_ACCESS_KEY \\"
echo "    -e AWS_SESSION_TOKEN=\$AWS_SESSION_TOKEN \\"
echo "    -e AWS_REGION=$REGION \\"
echo "    $IMAGE_NAME:$TAG"
