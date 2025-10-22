# WebRTC KVS Agent

WebRTC ViewerとしてMasterから映像/音声を受信し、AWS Kinesis Video Streamsにリアルタイム送信するエージェントアプリケーション。

## 概要

このプロジェクトは、ブラウザベースのWebRTC Master（カメラ/マイク入力）から映像・音声ストリームを受信し、GStreamerを使用してAWS Kinesis Video Streamsに転送するViewerエージェントです。

**アーキテクチャフロー:**
```
WebRTC Master (Browser)
  → KVS WebRTC Signaling (webrtc-kvs-agent-channel)
  → WebRTC Viewer (Python/aiortc)
  → GStreamer Pipeline (H.264 + AAC)
  → Kinesis Video Stream (webrtc-kvs-agent-stream)
```

## プロジェクト構成

```
webrtc-kvs-agent/
├── docker/              # メインアプリケーション（Python実装）
├── KvsAgent/            # AWS CDK（Infrastructure as Code）
├── WebRTC/              # WebRTC Master（ブラウザベースの参考実装）
├── CLAUDE.md            # 開発者向け詳細ドキュメント
└── README.md            # このファイル
```

## クイックスタート

### 前提条件

- Python 3.9以上
- Docker
- AWS CLI
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWSアカウントと認証情報

### 1. AWSインフラのデプロイ（CDK）

AWS CDKを使用して、必要なすべてのインフラストラクチャ（VPC、ECS、ECR、KVS等）を自動作成します。

```bash
# CDKディレクトリに移動
cd KvsAgent

# 依存関係のインストール（初回のみ）
npm install

# CDKのブートストラップ（初回のみ、リージョンごとに1回）
npx cdk bootstrap aws://ACCOUNT_ID/ap-northeast-1

# スタックのデプロイ
npx cdk deploy

# デプロイ後の出力（ECR Repository URI等）をメモしておく
```

CDKスタックにより以下のリソースが作成されます:
- VPC（Public Subnet構成）
- ECR Repository（`webrtc-agent-kvs-repo`）
- ECS Cluster & Fargate Service
- IAMロール（必要な権限を自動付与）
- CloudWatch Logs
- KVS Signaling Channel（`webrtc-kvs-agent-channel`）
- KVS Stream（`webrtc-kvs-agent-stream`）

詳細な手順は [CLAUDE.md - AWS Infrastructure Deployment (CDK)](CLAUDE.md#aws-infrastructure-deployment-cdk) を参照してください。

### 2. Dockerイメージのビルドとプッシュ

```bash
# ECRにログイン（リージョンとアカウントIDを適宜変更）
aws ecr get-login-password --region ap-northeast-1 | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com

# Dockerイメージをビルド
cd docker
docker build --platform linux/amd64 -t webrtc-agent-kvs-repo:latest .

# イメージにタグ付け
docker tag webrtc-agent-kvs-repo:latest \
  ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com/webrtc-agent-kvs-repo:latest

# ECRにプッシュ
docker push ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com/webrtc-agent-kvs-repo:latest
```

プッシュ後、Fargateサービスが自動的に新しいイメージをデプロイします。

### 3. WebRTC Masterの起動（テスト用）

別のターミナルで、ブラウザベースのMasterを起動します:

```bash
cd WebRTC

# macOSの場合
open index.html

# または簡易HTTPサーバーを起動
python3 -m http.server 8080
# その後、ブラウザで http://localhost:8080 を開く
```

ブラウザで:
1. AWS認証情報を入力（`🐹credential.md` 参照）
2. "Master" ロールを選択
3. "Start" ボタンをクリック
4. カメラとマイクへのアクセスを許可

### 4. 動作確認

AWS ConsoleでKinesis Video Streamsにアクセスし、ストリームが送信されているか確認:
- https://console.aws.amazon.com/kinesisvideo/home?region=ap-northeast-1#/streams

CloudWatch Logsでエージェントのログを確認:
- https://console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#logsV2:log-groups/log-group/$252Fecs$252Fwebrtc-kvs-agent

## ローカル開発とデバッグ

### Dockerコンテナでのローカルデバッグ

ローカル環境でDockerを使用してデバッグする詳細な手順は、[docker/README.md](docker/README.md) を参照してください。

**概要:**

1. **AWS認証情報の準備**
   ```bash
   export AWS_ACCESS_KEY_ID="YOUR_ACCESS_KEY_ID"
   export AWS_SECRET_ACCESS_KEY="YOUR_SECRET_ACCESS_KEY"
   export AWS_SESSION_TOKEN="YOUR_SESSION_TOKEN"  # オプション
   export AWS_REGION="us-west-2"
   ```

2. **ECRにログイン（KVSベースイメージ取得用）**
   ```bash
   aws ecr get-login-password --region us-west-2 | \
     docker login --username AWS --password-stdin 546150905175.dkr.ecr.us-west-2.amazonaws.com
   ```

3. **Dockerイメージのビルド**
   ```bash
   cd docker
   docker build -t webrtc-kvs-agent .
   ```

4. **Dockerコンテナの実行**
   ```bash
   docker run --rm \
     -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
     -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
     -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
     -e AWS_REGION="$AWS_REGION" \
     webrtc-kvs-agent
   ```

詳細なデバッグ手順、ログの確認方法、トラブルシューティングは [docker/README.md](docker/README.md) を参照してください。

### Pythonコードの直接実行（開発時）

```bash
cd docker

# 依存関係のインストール
pip3 install -r requirements.txt

# 環境変数を設定して実行
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."
export AWS_REGION="us-west-2"

python3 viewer.py
```

## 設定

### 環境変数

| 変数名 | 説明 | デフォルト | 必須 |
|--------|------|-----------|------|
| `AWS_REGION` | AWSリージョン | `us-west-2` | いいえ |
| `AWS_ACCESS_KEY_ID` | AWSアクセスキー | - | ローカル実行時のみ |
| `AWS_SECRET_ACCESS_KEY` | AWSシークレットキー | - | ローカル実行時のみ |
| `AWS_SESSION_TOKEN` | AWSセッショントークン | - | いいえ |

**注意**: Fargate実行時は、IAMロールから認証情報が自動取得されるため、環境変数の設定は不要です。

### 固定値

- **Signaling Channel名**: `webrtc-kvs-agent-channel`
- **Stream名**: `webrtc-kvs-agent-stream`
- **Client ID**: 自動生成（`viewer-{timestamp}`）
- **Codec**: H.264 (Video) + AAC (Audio)

## ドキュメント

- [CLAUDE.md](CLAUDE.md) - 開発者向け詳細ドキュメント（アーキテクチャ、トラブルシューティング等）
- [docker/README.md](docker/README.md) - Dockerローカルデバッグ詳細手順
- [KvsAgent/README.md](KvsAgent/README.md) - CDK使用方法

## トラブルシューティング

### ResourceNotFoundException
**原因**: KVS Signaling ChannelまたはStreamが存在しない

**解決策**: CDKスタックをデプロイしてください（上記「1. AWSインフラのデプロイ（CDK）」参照）

### AccessDeniedException
**原因**: IAM権限が不足している

**解決策**:
- ローカル開発時: 環境変数に正しい認証情報が設定されているか確認
- Fargate実行時: CDKスタックで自動作成されたIAMロールを確認

### Docker build fails with dependency errors
**原因**: Python依存パッケージのビルドエラー

**解決策**:
- ベースイメージにビルドツールがインストールされていることを確認
- Dockerfileで必要な開発パッケージ（gcc, python3-devel等）がインストールされています

### WebRTC接続が確立しない
**原因**: Signaling Channelまたは認証情報の問題

**解決策**:
1. CDKスタックが正しくデプロイされているか確認
2. WebRTC Masterが起動しているか確認
3. CloudWatch Logsでエージェントのログを確認

詳細なトラブルシューティングは [CLAUDE.md - Troubleshooting](CLAUDE.md#troubleshooting) を参照してください。

## セキュリティ

- **絶対にコミットしない**: `🐹credential.md` やAWS認証情報を含むファイル
- **IAMロールを使用**: Fargate/ECSデプロイ時はハードコード認証情報を避ける
- **即座にローテーション**: 認証情報が漏洩した場合は直ちにローテーション

## 実装状況（2025-10-23更新）

### ✅ 完成済み
- AWS CDKによるインフラ自動構築（VPC、ECS、ECR、KVS等）
- KVS Signaling Channelへの接続（AWS SigV4署名対応）
- ICE Server設定の取得
- Docker化とFargateデプロイ対応
- 認証情報管理（環境変数/IAMロール）
- **WebRTC P2P接続確立**（Python + aiortc）
- **ビデオ/オーディオストリーム受信**

### 🔄 開発中（次のステップ）
- **KVS Streamへのメディア転送**（最優先）
- GStreamerブリッジの完全統合（WebRTC → GStreamer → KVS）
- エラーハンドリングと自動再接続

### 技術スタック

**Python + aiortc実装**（Node.js + wrtcから移行完了）

**アーキテクチャ**:
```
WebRTC Master (Browser)
  ↓ KVS WebRTC Signaling (AWS SigV4)
Python Viewer (aiortc) ✅ 接続成功
  ↓ メディアトラック受信 ✅ 動作確認済み
GStreamer (kvssink) ⏳ 実装中
  ↓
Kinesis Video Stream
```

**採用理由**:
- ✅ ネイティブビルド不要（aiortcはピュアPython）
- ✅ シンプルで保守しやすいコード
- ✅ AWS SDKとの統合が容易
- ✅ デバッグが簡単

詳細は [CLAUDE.md - Current Implementation Status](CLAUDE.md#current-implementation-status) を参照してください。

## ライセンス

このプロジェクトは内部開発用です。

## 参考リンク

- [AWS Kinesis Video Streams WebRTC](https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/webrtc.html)
- [GStreamer kvssink Plugin](https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/examples-gstreamer-plugin.html)
- [AWS CDK](https://docs.aws.amazon.com/cdk/latest/guide/home.html)
