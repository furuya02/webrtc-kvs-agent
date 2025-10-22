# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**注意**: レスポンスは日本語でお願いします。

## Project Overview

WebRTC KVS Agent is a Viewer application that receives video/audio streams from a WebRTC Master via AWS Kinesis Video Streams (KVS) WebRTC signaling, and forwards them to a KVS stream in real-time using GStreamer.

**開発フロー:**
1. ローカルDockerで動作確認
2. AWS Fargateで運用

**Architecture Flow:**
```
WebRTC Master (Browser)
  → KVS WebRTC Signaling (webrtc-kvs-agent-channel)
  → WebRTC Viewer (Python/aiortc)
  → GStreamer Pipeline (kvssink)
  → Kinesis Video Stream (webrtc-kvs-agent-stream)
```

## Repository Structure

```
webrtc-kvs-agent/
├── docker/                    # メインアプリケーション（Python実装）
│   ├── viewer.py             # Python WebRTC Viewer (aiortc)
│   ├── requirements.txt      # Python依存パッケージ
│   ├── Dockerfile            # Debian-based Dockerfile (Python 3.12)
│   └── README.md             # Docker詳細ドキュメント
├── KvsAgent/                  # AWS CDK Infrastructure as Code
│   ├── bin/                   # CDK app entry point
│   ├── lib/                   # CDK stack definitions
│   ├── cdk.json              # CDK configuration
│   ├── package.json          # CDK dependencies
│   └── README.md             # CDK使用方法
├── WebRTC/                    # WebRTC Master（ブラウザベース参考実装）
│   ├── app.js                # Master application logic
│   └── index.html            # Web interface
├── CLAUDE.md                  # このファイル
├── README.md                  # プロジェクト概要
└── 🐹credential.md            # AWS認証情報（.gitignoreに含む）
```

## Technology Stack

### Python Implementation (現在の実装)

**実装言語:** Python 3.12
**ベースイメージ:** `python:3.12-slim-bookworm` (Debian 12)

**主要パッケージ:**
- `boto3>=1.35.0` - AWS SDK
- `aiortc>=1.6.0` - WebRTC implementation
- `websockets>=13.0` - WebSocket client
- `av>=11.0.0` - Media processing
- `numpy>=1.26.0` - 数値計算

**システム依存:**
- GStreamer 1.0 (プラグイン含む)
- FFmpeg libraries
- AWS KVS Producer SDK (kvssink plugin)

## Development Commands

### Docker開発（推奨）

```bash
# Dockerイメージをビルド
cd docker
docker build -t webrtc-kvs-agent .

# Dockerコンテナを実行
docker run --rm \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_REGION="us-west-2" \
  webrtc-kvs-agent
```

### ローカル開発（デバッグ用）

```bash
cd docker

# Python依存関係をインストール
pip3 install -r requirements.txt

# 環境変数を設定して実行
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."
export AWS_REGION="us-west-2"

python3 viewer.py
```

**注意:** ローカル実行にはGStreamerとFFmpegライブラリが必要です。

### WebRTC Masterでのテスト

```bash
# 1. WebRTC Masterをブラウザで起動
cd WebRTC
open index.html  # または python3 -m http.server 8080

# 2. ブラウザで設定
# - AWS認証情報を入力
# - Channel Name: webrtc-kvs-agent-channel
# - Region: us-west-2
# - Role: Master
# - "Start"をクリック

# 3. Viewerを起動（別ターミナル）
cd docker
docker run --rm \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_REGION="us-west-2" \
  webrtc-kvs-agent
```

## Architecture Details

### WebRTC Viewer Implementation (Python)

実装ファイル: [docker/viewer.py](docker/viewer.py)

**主要コンポーネント:**

1. **KVSSignalingClient**
   - AWS Signature V4によるWebSocket認証
   - KVS WebRTC Signaling Channelへの接続
   - ICE Server設定の取得
   - SDP Offer/Answer交換

2. **MediaHandler**
   - aiortcによるメディアトラック受信
   - GStreamerパイプラインへの転送（実装中）

3. **main()**
   - RTCPeerConnection管理
   - ICE Candidate交換
   - 接続状態監視

### Docker Image

**ベースイメージ:** `python:3.12-slim-bookworm`

**含まれるコンポーネント:**
- Python 3.12 runtime
- GStreamer 1.0 (全プラグイン)
- FFmpeg libraries
- AWS KVS Producer SDK (kvssink plugin) - ソースからビルド
- Python依存パッケージ

**イメージサイズ:** 約500-700MB（最適化可能）

**重要な環境変数:**
- `GST_PLUGIN_PATH=/usr/local/lib/gstreamer-1.0` - kvssinkプラグインのパス
- `LD_LIBRARY_PATH=/usr/local/lib` - KVS SDKライブラリのパス

## Configuration

### 固定値

- **Signaling Channel Name**: `webrtc-kvs-agent-channel`
- **KVS Stream Name**: `webrtc-kvs-agent-stream`
- **Client ID**: Auto-generated as `viewer-{timestamp}`
- **Codec**: H.264 (Video) + AAC (Audio)

### 環境変数

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `AWS_REGION` | AWS region | No | `ap-northeast-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key | Local only | - |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | Local only | - |
| `AWS_SESSION_TOKEN` | AWS session token | No | - |

**Fargate実行時:** IAMロールから認証情報を自動取得

## AWS Infrastructure Deployment (CDK)

### CDKスタック構成

AWS CDKを使用してインフラストラクチャを自動デプロイできます。

**含まれるリソース:**
- VPC (Public Subnet構成)
- ECR Repository
- ECS Cluster + Fargate Service
- IAM Roles (必要な権限自動付与)
- CloudWatch Logs
- KVS Signaling Channel (`webrtc-kvs-agent-channel`)
- KVS Stream (`webrtc-kvs-agent-stream`)

### デプロイ手順

```bash
# 1. CDKディレクトリに移動
cd KvsAgent

# 2. 依存関係のインストール（初回のみ）
npm install

# 3. CDKブートストラップ（初回のみ）
npx cdk bootstrap aws://ACCOUNT_ID/ap-northeast-1

# 4. スタックのデプロイ
npx cdk deploy

# 5. ECRにDockerイメージをプッシュ
aws ecr get-login-password --region ap-northeast-1 | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com

cd ../docker
docker build -t webrtc-agent-kvs-repo:latest .
docker tag webrtc-agent-kvs-repo:latest ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com/webrtc-agent-kvs-repo:latest
docker push ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com/webrtc-agent-kvs-repo:latest
```

### 自動付与されるIAM権限

**Signaling Channel用:**
- `kinesisvideo:DescribeSignalingChannel`
- `kinesisvideo:GetSignalingChannelEndpoint`
- `kinesisvideo:GetIceServerConfig`
- `kinesisvideo:ConnectAsViewer`

**Stream用:**
- `kinesisvideo:PutMedia`
- `kinesisvideo:CreateStream`
- `kinesisvideo:DescribeStream`
- `kinesisvideo:GetDataEndpoint`

## Implementation Status

### ✅ 完成済み（2025-10-23更新）

- ✅ Python 3.12 + Debian環境への移行
- ✅ AWS CDKによるインフラ自動デプロイ
- ✅ KVS Signaling Channelへの接続（AWS SigV4署名対応）
- ✅ ICE Server設定の取得
- ✅ WebRTC P2P接続確立（aiortc）
- ✅ ビデオ/オーディオメディアストリーム受信
- ✅ Dockerイメージのビルド成功
- ✅ 最新パッケージバージョンへの更新

### 🔄 開発中

- 🔄 **KVS Streamへのメディア転送**（最優先）
  - GStreamerパイプラインの統合
  - kvssinkプラグインを使用したKVS送信
- 🔄 エラーハンドリングと自動再接続
- 🔄 Fargateでの運用確認

### 📊 動作確認状況

**ローカル動作確認:**
- WebRTC接続: ✅ 成功（2025-10-23確認済み）
- メディア受信: ✅ 成功（ビデオ/オーディオフレーム受信確認）
- Docker環境: ✅ ビルド成功

**次のステップ:**
1. Dockerコンテナでの動作確認
2. KVS Streamへのメディア転送実装
3. Fargateデプロイと運用確認

## Troubleshooting

### Dockerビルドエラー

**問題:** パッケージのインストールに失敗する

**解決策:**
- ビルドキャッシュをクリア: `docker build --no-cache -t webrtc-kvs-agent .`
- requirements.txtのバージョンを確認

### WebRTC接続が確立しない

**原因:** KVS Signaling Channelまたは認証情報の問題

**解決策:**
1. KVS Signaling Channelが存在するか確認:
   ```bash
   aws kinesisvideo list-signaling-channels --region us-west-2
   ```
2. AWS認証情報が正しいか確認:
   ```bash
   aws sts get-caller-identity --region us-west-2
   ```
3. WebRTC Masterが起動しているか確認

### AccessDeniedException

**原因:** IAM権限不足

**解決策:**
- **ローカル:** 環境変数に正しい認証情報を設定
- **Fargate:** CDKスタックで作成されたIAMロールを確認

## Security Notes

### セキュリティベストプラクティス

- **絶対にコミットしない**: `🐹credential.md` やAWS認証情報
- **IAMロールを使用**: Fargate/ECSデプロイ時はハードコード認証情報を避ける
- **即座にローテーション**: 認証情報が漏洩した場合は直ちにローテーション
- **.gitignoreに追加**: 認証情報ファイルは必ず`.gitignore`に追加

### 開発時の注意事項

- **質問優先**: 不明な点があったら、質問してから作業を開始
- **環境変数使用**: 認証情報はファイルにハードコードせず、環境変数から取得
- **型アノテーション**: すべてのPython関数に型アノテーションを追加
- **変数名**: 常に説明的な変数名を使用

## References

- [AWS Kinesis Video Streams WebRTC](https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/webrtc.html)
- [GStreamer kvssink Plugin](https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/examples-gstreamer-plugin.html)
- [aiortc Documentation](https://aiortc.readthedocs.io/)
- [AWS CDK](https://docs.aws.amazon.com/cdk/latest/guide/home.html)
