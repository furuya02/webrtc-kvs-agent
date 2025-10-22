# WebRTC Agent KVS Stack

AWS CDK v2を使用したWebRTC KVS Agentインフラストラクチャのコード化。

## 構成リソース

このCDKスタックは以下のリソースを作成します：

- **VPC**: Public Subnetのみ (NAT Gatewayなし)
- **ECR Repository**: `webrtc-agent-kvs-repo`
- **ECS Fargate**: WebRTC Viewerエージェント実行環境
- **KVS Signaling Channel**: `webrtc-kvs-agent-channel`
- **KVS Stream**: `webrtc-kvs-agent-stream`
- **IAM Roles**: Fargateタスク用の実行ロールとタスクロール
- **CloudWatch Logs**: `/ecs/webrtc-kvs-agent`

## 前提条件

- Node.js 18以上
- AWS CLI設定済み
- AWS CDK CLI インストール済み (`npm install -g aws-cdk`)
- Dockerビルド済みのイメージ (`webrtc-kvs-agent`)

## セットアップ

### 1. 依存関係のインストール

\`\`\`bash
cd KvsAgent
npm install
\`\`\`

### 2. CDK Bootstrap (初回のみ)

\`\`\`bash
# デフォルトアカウント/ap-northeast-1リージョンでブートストラップ
cdk bootstrap aws://ACCOUNT_ID/ap-northeast-1
\`\`\`

### 3. スタックの確認

\`\`\`bash
# CloudFormationテンプレートの確認
cdk synth

# デプロイ内容の差分確認
cdk diff
\`\`\`

## デプロイ手順

### Step 1: CDKスタックのデプロイ

\`\`\`bash
cd KvsAgent
cdk deploy
\`\`\`

### Step 2: Dockerイメージのプッシュ

\`\`\`bash
# 1. ECR URIを取得（デプロイ後の出力から）
ECR_URI="<YOUR_ECR_URI_FROM_OUTPUT>"

# 2. ECRにログイン
aws ecr get-login-password --region ap-northeast-1 | \\
  docker login --username AWS --password-stdin \$(echo \$ECR_URI | cut -d'/' -f1)

# 3. Dockerイメージにタグ付け
cd ../docker
docker tag webrtc-kvs-agent:latest \$ECR_URI:latest

# 4. ECRにプッシュ
docker push \$ECR_URI:latest
\`\`\`

### Step 3: Fargateサービスの起動確認

\`\`\`bash
aws ecs list-tasks --cluster webrtc-kvs-cluster --region ap-northeast-1
\`\`\`

## スタックの削除

\`\`\`bash
cd KvsAgent
cdk destroy
\`\`\`
