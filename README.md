# WebRTC KVS Agent

WebRTC ViewerとしてMasterから映像/音声を受信し、AWS Kinesis Video Streamsにリアルタイム送信するエージェントアプリケーション。

## 概要

このプロジェクトは、ブラウザベースのWebRTC Master（カメラ/マイク入力）から映像・音声ストリームを受信し、GStreamerを使用してAWS Kinesis Video Streamsに転送するViewerエージェントです。

**アーキテクチャフロー:**
```
WebRTC Master (Browser)
  → KVS WebRTC Signaling (webrtc-kvs-agent-channel)
  → WebRTC Viewer (Python/aiortc)
  → GStreamer Pipeline (kvssink)
  → Kinesis Video Stream (webrtc-kvs-agent-stream)
```

## 技術スタック

- **言語**: Python 3.12
- **WebRTC**: aiortc
- **メディア処理**: GStreamer + kvssink plugin
- **AWS SDK**: boto3
- **インフラ**: AWS CDK (TypeScript)
- **コンテナ**: Docker (Debian-based)

## プロジェクト構成

```
webrtc-kvs-agent/
├── docker/              # メインアプリケーション（Python実装）
│   ├── viewer.py       # Python WebRTC Viewer
│   ├── requirements.txt # Python依存パッケージ
│   └── Dockerfile      # Python 3.12 + Debian 12
├── KvsAgent/            # AWS CDK（Infrastructure as Code）
│   ├── bin/            # CDK app entry point
│   ├── lib/            # CDK stack definitions
│   └── cdk.json        # CDK configuration
├── WebRTC/              # WebRTC Master（ブラウザベース）
│   ├── app.js          # Master application logic
│   └── index.html      # Web interface
├── CLAUDE.md            # 開発者向け詳細ドキュメント
└── README.md            # このファイル
```

## クイックスタート

### 前提条件

- Docker
- AWS CLI
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWSアカウントと認証情報

### 1. AWSインフラのデプロイ（CDK）

AWS CDKを使用して、必要なすべてのインフラストラクチャを自動作成します。

```bash
# CDKディレクトリに移動
cd KvsAgent

# 依存関係のインストール（初回のみ）
npm install

# CDKブートストラップ（初回のみ）
npx cdk bootstrap aws://ACCOUNT_ID/ap-northeast-1

# スタックのデプロイ
npx cdk deploy
```

**作成されるリソース:**
- VPC（Public Subnet構成）
- ECR Repository（`webrtc-agent-kvs-repo`）
- ECS Cluster & Fargate Service
- IAMロール（必要な権限を自動付与）
- CloudWatch Logs
- KVS Signaling Channel（`webrtc-kvs-agent-channel`）
- KVS Stream（`webrtc-kvs-agent-stream`）

### 2. Dockerイメージのビルド

```bash
cd docker
docker build -t webrtc-kvs-agent .
```

**注意:** 初回ビルドは約10-20分かかります（KVS Producer SDKをソースからビルドするため）

### 3. ローカルでの動作確認

#### 3-1. AWS認証情報の設定

```bash
export AWS_ACCESS_KEY_ID="YOUR_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="YOUR_SECRET_ACCESS_KEY"
export AWS_SESSION_TOKEN="YOUR_SESSION_TOKEN"  # オプション
export AWS_REGION="us-west-2"
```

#### 3-2. WebRTC Masterを起動

別のターミナルで:

```bash
cd WebRTC
open index.html  # macOS

# または簡易HTTPサーバーを起動
python3 -m http.server 8080
# ブラウザで http://localhost:8080 を開く
```

**ブラウザで設定:**
1. AWS認証情報を入力
2. Channel Name: `webrtc-kvs-agent-channel`
3. Region: `us-west-2`
4. Role: **Master**
5. "Start"をクリック
6. カメラとマイクへのアクセスを許可

#### 3-3. Viewerを起動

```bash
docker run --rm \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_REGION="$AWS_REGION" \
  webrtc-kvs-agent
```

**期待される動作:**
- WebSocket接続の確立
- SDP Offer/Answer交換
- ICE Connection State: `completed`
- ビデオ/オーディオトラックの受信

### 4. Fargateへのデプロイ

```bash
# ECRにログイン
aws ecr get-login-password --region ap-northeast-1 | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com

# イメージをビルドしてタグ付け
cd docker
docker build -t webrtc-agent-kvs-repo:latest .
docker tag webrtc-agent-kvs-repo:latest \
  ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com/webrtc-agent-kvs-repo:latest

# ECRにプッシュ
docker push ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com/webrtc-agent-kvs-repo:latest
```

プッシュ後、Fargateサービスが自動的に新しいイメージをデプロイします。

## 設定

### 環境変数

| 変数名 | 説明 | デフォルト | 必須 |
|--------|------|-----------|------|
| `AWS_REGION` | AWSリージョン | `ap-northeast-1` | いいえ |
| `AWS_ACCESS_KEY_ID` | AWSアクセスキー | - | ローカルのみ |
| `AWS_SECRET_ACCESS_KEY` | AWSシークレットキー | - | ローカルのみ |
| `AWS_SESSION_TOKEN` | AWSセッショントークン | - | いいえ |

**注意**: Fargate実行時は、IAMロールから認証情報が自動取得されるため、環境変数の設定は不要です。

### 固定値

- **Signaling Channel名**: `webrtc-kvs-agent-channel`
- **Stream名**: `webrtc-kvs-agent-stream`
- **Client ID**: 自動生成（`viewer-{timestamp}`）
- **Codec**: H.264 (Video) + AAC (Audio)

## 開発状況

### ✅ 完成済み

- Python 3.12 + Debian環境への移行
- AWS CDKによるインフラ自動構築
- KVS Signaling Channelへの接続（AWS SigV4署名対応）
- WebRTC P2P接続確立（aiortc）
- ビデオ/オーディオメディアストリーム受信
- Dockerイメージのビルド

### 🔄 開発中

- **KVS Streamへのメディア転送**（最優先）
- GStreamerパイプラインの統合
- エラーハンドリングと自動再接続
- Fargateでの運用確認

## トラブルシューティング

### Dockerビルドエラー

**問題:** パッケージのインストールに失敗する

**解決策:**
```bash
# ビルドキャッシュをクリア
docker build --no-cache -t webrtc-kvs-agent .
```

### WebRTC接続が確立しない

**原因:** KVS Signaling Channelまたは認証情報の問題

**解決策:**
1. KVS Signaling Channelの存在確認:
   ```bash
   aws kinesisvideo list-signaling-channels --region us-west-2
   ```
2. AWS認証情報の確認:
   ```bash
   aws sts get-caller-identity --region us-west-2
   ```
3. WebRTC Masterが起動しているか確認

### AccessDeniedException

**原因:** IAM権限不足

**解決策:**
- **ローカル:** 環境変数に正しい認証情報を設定
- **Fargate:** CDKスタックで作成されたIAMロールを確認

## ドキュメント

- [CLAUDE.md](CLAUDE.md) - 開発者向け詳細ドキュメント（アーキテクチャ、実装詳細、トラブルシューティング等）
- [docker/README.md](docker/README.md) - Dockerローカルデバッグ詳細手順（予定）
- [KvsAgent/README.md](KvsAgent/README.md) - CDK使用方法（予定）

## セキュリティ

- **絶対にコミットしない**: `🐹credential.md` やAWS認証情報を含むファイル
- **IAMロールを使用**: Fargate/ECSデプロイ時はハードコード認証情報を避ける
- **即座にローテーション**: 認証情報が漏洩した場合は直ちにローテーション

## 参考リンク

- [AWS Kinesis Video Streams WebRTC](https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/webrtc.html)
- [GStreamer kvssink Plugin](https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/examples-gstreamer-plugin.html)
- [aiortc Documentation](https://aiortc.readthedocs.io/)
- [AWS CDK](https://docs.aws.amazon.com/cdk/latest/guide/home.html)

## ライセンス

このプロジェクトは内部開発用です。
