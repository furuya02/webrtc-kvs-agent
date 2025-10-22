# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**注意**: レスポンスは日本語でお願いします。

## Project Overview

WebRTC KVS Agent is a Viewer application that receives video/audio streams from a WebRTC Master via AWS Kinesis Video Streams (KVS) WebRTC signaling, and forwards them to a KVS stream in real-time using GStreamer.

**開発フロー:**
1. まず、Dockerで動作するものを完成させる
2. 最終的にAWS Fargateで運用する

**Architecture Flow:**
```
WebRTC Master (Browser)
  → KVS WebRTC Signaling (webrtc-kvs-agent-channel)
  → WebRTC Viewer (TypeScript/Node.js)
  → GStreamer Pipeline (H.264 + AAC)
  → Kinesis Video Stream (webrtc-kvs-agent-stream)
```

## Repository Structure

```
webrtc-kvs-agent/
├── docker/                    # Main application (Python implementation)
│   ├── viewer.py             # Python WebRTC Viewer (aiortc)
│   ├── requirements.txt      # Python dependencies
│   ├── Dockerfile            # Python-based Dockerfile
│   ├── scripts/              # Helper scripts
│   │   ├── run-local.sh     # Run locally with credentials
│   │   └── build-docker.sh  # Build Docker image
│   ├── start-gstreamer-viewer.sh  # GStreamer startup script (reference)
│   └── README.md             # Detailed Docker usage and debugging
├── KvsAgent/                  # AWS CDK Infrastructure as Code
│   ├── bin/                   # CDK app entry point
│   │   └── kvs_agent.ts      # CDK app initialization
│   ├── lib/                   # CDK stack definitions
│   │   └── webrtc-agent-kvs-stack.ts  # Main infrastructure stack
│   ├── cdk.json              # CDK configuration
│   ├── package.json          # CDK dependencies
│   └── README.md             # CDK usage instructions
├── WebRTC/                    # WebRTC Master (Browser-based reference implementation)
│   ├── app.js                # Master application logic
│   └── index.html            # Web interface
├── CLAUDE.md                  # This file
├── README.md                  # Project overview and getting started
└── 🐹credential.md            # AWS credentials (DO NOT COMMIT - in .gitignore)
```

## Development Commands

### Local Development (Python)

```bash
# Setup
cd docker

# Install Python dependencies
pip3 install -r requirements.txt

# Run locally (with environment variables)
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."
export AWS_REGION="us-west-2"
python3 viewer.py
```

### Docker Development

```bash
# Login to ECR (required for base image)
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin 546150905175.dkr.ecr.us-west-2.amazonaws.com

# Build Docker image (explicitly specify platform for compatibility)
cd docker
docker build --platform linux/amd64 -t webrtc-kvs-agent .

# Or use the helper script
./scripts/build-docker.sh

# Run Docker container
docker run --rm \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_REGION="us-west-2" \
  webrtc-kvs-agent
```

### Testing with WebRTC Master

```bash
# 1. Open WebRTC/index.html in a browser
# 2. Configure AWS credentials in the web interface
# 3. Select "Master" role and click "Start"
# 4. Run the Viewer agent (this application)
# 5. The agent will connect to the Master and forward video to KVS
```

## Architecture Details

### WebRTC Viewer Implementation (Python)

The Viewer ([docker/viewer.py](docker/viewer.py)) performs the following:

1. **AWS Configuration**: Loads credentials from environment variables or IAM role (for Fargate)
2. **Signaling Client**: Connects to KVS WebRTC signaling channel (`webrtc-kvs-agent-channel`) using boto3
3. **ICE Server Configuration**: Retrieves STUN/TURN servers from KVS
4. **RTCPeerConnection**: Creates peer connection with Master using aiortc
5. **Offer/Answer Exchange**: Negotiates WebRTC connection via WebSocket signaling
6. **Media Reception**: Receives video/audio tracks from Master
7. **GStreamer Forwarding**: Pipes received media to GStreamer pipeline (in development)

### GStreamer Integration

The MediaHandler class in [docker/viewer.py](docker/viewer.py) manages the pipeline:

- **Input**: WebRTC media tracks (video/audio)
- **Processing**:
  - Video: Convert → x264enc → h264parse → kvssink
  - Audio: Convert → aacparse → kvssink
- **Output**: Kinesis Video Stream (`webrtc-kvs-agent-stream`)

### Docker Image

**Base Image**: AWS KVS Producer SDK (`546150905175.dkr.ecr.us-west-2.amazonaws.com/kinesis-video-producer-sdk-cpp-amazon-linux:latest`)

**含まれるコンポーネント**:
- GStreamer with kvssink plugin (pre-installed)
- Python 3.9+ runtime
- aiortc and dependencies
- boto3 AWS SDK

**Important**: Dockerfileは `--platform=linux/amd64` を使用してFargate互換性を確保しています。Apple Silicon環境では、Dockerがエミュレーションを使用します。

## Configuration

### Fixed Values

- **Signaling Channel Name**: `webrtc-kvs-agent-channel` (固定値)
- **KVS Stream Name**: `webrtc-kvs-agent-stream` (固定値)
- **Client ID**: Auto-generated as `viewer-{timestamp}`
- **Codec**: H.264 (Video) + AAC (Audio)
- **解像度/ビットレート**: 特に要件なし（デフォルト値を使用）

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `AWS_REGION` | AWS region | No | `ap-northeast-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key | Local only | - |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | Local only | - |
| `AWS_SESSION_TOKEN` | AWS session token | No | - |

#### ローカル開発時の認証情報
- `🐹credential.md` に記載された認証情報を使用
- コマンド実行時に環境変数としてセット:
  ```bash
  export AWS_ACCESS_KEY_ID="..."
  export AWS_SECRET_ACCESS_KEY="..."
  export AWS_SESSION_TOKEN="..."
  export AWS_REGION="us-west-2"
  ```

#### Fargate運用時の認証情報
- Fargateタスクロールに必要な権限を付与
- コード上は認証情報の設定不要（IAMロールから自動取得）

**Note**: For Fargate deployment, credentials are obtained from the task role automatically.

## AWS Infrastructure Deployment (CDK)

### デプロイ方法

AWS CDKを使用してインフラストラクチャを自動デプロイできます。CDKスタックには以下のリソースが含まれます:

- **VPC**: Public Subnet構成（NAT Gateway不要）
- **ECR Repository**: Dockerイメージ保存用
- **ECS Cluster**: Fargateタスク実行環境
- **Fargate Service**: 常時起動のViewerエージェント
- **IAM Roles**: タスクロールと実行ロール（必要な権限自動付与）
- **CloudWatch Logs**: ログ収集用
- **KVS Signaling Channel**: `webrtc-kvs-agent-channel` (Custom Resource)
- **KVS Stream**: `webrtc-kvs-agent-stream` (Custom Resource)

### CDKデプロイ手順

```bash
# 1. CDKディレクトリに移動
cd KvsAgent

# 2. 依存関係のインストール（初回のみ）
npm install

# 3. CDKのブートストラップ（初回のみ、リージョンごとに1回）
npx cdk bootstrap aws://ACCOUNT_ID/ap-northeast-1

# 4. スタックの差分確認
npx cdk diff

# 5. スタックのデプロイ
npx cdk deploy

# 6. デプロイ後の出力を確認
# ECR Repository URI, VPC ID, ECS Cluster Name などが表示されます
```

### Dockerイメージのビルドとプッシュ

CDKデプロイ後、Dockerイメージをビルドしてプッシュします:

```bash
# 1. ECRにログイン（CDKデプロイ時の出力からECR URIを取得）
aws ecr get-login-password --region ap-northeast-1 | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com

# 2. Dockerイメージをビルド
cd docker
docker build --platform linux/amd64 -t webrtc-agent-kvs-repo:latest .

# 3. イメージにタグ付け
docker tag webrtc-agent-kvs-repo:latest \
  ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com/webrtc-agent-kvs-repo:latest

# 4. ECRにプッシュ
docker push ACCOUNT_ID.dkr.ecr.ap-northeast-1.amazonaws.com/webrtc-agent-kvs-repo:latest

# 5. Fargateサービスが自動的に新しいイメージをデプロイします
```

### CDKスタックの削除

```bash
cd KvsAgent
npx cdk destroy
```

**注意**: KVS Signaling ChannelとStreamは削除されます。データを保持する場合は、事前にバックアップしてください。

### 自動作成されるIAM権限

CDKスタックは以下の権限を持つタスクロールを自動作成します:

**Signaling Channel用**:
- `kinesisvideo:DescribeSignalingChannel`
- `kinesisvideo:GetSignalingChannelEndpoint`
- `kinesisvideo:GetIceServerConfig`
- `kinesisvideo:ConnectAsViewer`

**Stream用**:
- `kinesisvideo:PutMedia`
- `kinesisvideo:CreateStream`
- `kinesisvideo:DescribeStream`
- `kinesisvideo:GetDataEndpoint`

## Dependencies

### Base Docker Image
- **Repository**: `546150905175.dkr.ecr.us-west-2.amazonaws.com/kinesis-video-producer-sdk-cpp-amazon-linux:latest`
- **Includes**: GStreamer, kvssink plugin, KVS Producer SDK
- **Reference**: https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/examples-gstreamer-plugin.html#examples-gstreamer-plugin-docker

### Python Packages
- `boto3>=1.34.0`: AWS SDK for Python (KVS API統合)
- `aiortc>=1.6.0`: WebRTC implementation for Python (P2P接続)
- `websockets>=13.0.0`: WebSocket client (Signaling通信)
- `av>=10.0.0`: Media processing library (フレーム処理)

## Current Implementation Status

### 完成済み（2025-10-23更新）
- ✅ AWS CDKによるインフラストラクチャ自動デプロイ
- ✅ KVS Signaling Channelへの接続（AWS SigV4署名対応）
- ✅ ICE Server設定の取得
- ✅ AWS認証情報の管理（環境変数/IAMロール）
- ✅ Docker化とFargateデプロイ対応
- ✅ **WebRTC P2P接続確立**（Python + aiortc）
- ✅ **ビデオ/オーディオメディアストリーム受信**

### 開発中
- 🔄 **KVS Streamへの転送**: 受信したメディアをKVS Streamに送信（最優先）
- 🔄 **GStreamerブリッジ**: WebRTCからGStreamerへのメディア転送の完全統合
- 🔄 **エラーハンドリング**: 自動再接続とエラー回復機能

### 新アーキテクチャ（Python実装）

Node.js + `wrtc`の課題を解決するため、**Python実装に移行**しました:

**新アーキテクチャ**:
```
WebRTC Master (Browser)
  ↓ KVS WebRTC Signaling
Python Viewer (aiortc)
  ↓ メディアトラック受信
GStreamer Pipeline (kvssink)
  ↓
Kinesis Video Stream
```

**使用技術**:
- `aiortc`: PythonのWebRTC実装（ネイティブビルド不要）
- `boto3`: AWS SDK for Python
- `asyncio`: 非同期処理
- GStreamer + kvssink: KVSへのストリーム送信

**メリット**:
- ✅ ネイティブビルドの問題を回避（aiortcはピュアPython）
- ✅ シンプルで読みやすいコード
- ✅ AWS SDKとの統合が容易
- ✅ デバッグしやすい

**実装ファイル**:
- [docker/viewer.py](docker/viewer.py) - Pythonメインスクリプト
- [docker/requirements.txt](docker/requirements.txt) - Python依存パッケージ
- [docker/Dockerfile](docker/Dockerfile) - Python用Dockerfile

**参考**:
- [aiortc Documentation](https://aiortc.readthedocs.io/)
- [AWS KVS WebRTC SDK](https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/webrtc.html)

## ローカル動作確認の進捗（2025-10-23更新）

### 🎉 WebRTC接続成功！

Python実装（aiortc）によるWebRTC Viewerの**完全動作確認に成功**しました。

#### 完成した機能
1. ✅ Python依存パッケージのインストール
2. ✅ AWS認証情報の設定（環境変数）
3. ✅ KVS Signaling Channelへの接続
4. ✅ ICE Server設定の取得
5. ✅ AWS Signature V4によるWebSocket認証
6. ✅ WebRTC Signaling（SDP Offer/Answer交換）
7. ✅ ICE Candidate交換
8. ✅ DTLS接続確立
9. ✅ WebRTC P2P接続確立
10. ✅ ビデオ/オーディオトラックの受信開始

#### 修正したバグ（すべて解決済み）

**1. HTTPS Endpoint URL重複問題**
   - 問題: `endpoint_url=f"https://{endpoints['HTTPS']}"` で`https://`が二重になっていた
   - 修正: `endpoint_url=endpoints['HTTPS']` に変更
   - 場所: [docker/viewer.py:82](docker/viewer.py#L82)

**2. WebSocket URL重複問題**
   - 問題: `f"wss://{endpoints['WSS']}"` で`wss://`が二重になっていた
   - 修正: `f"{endpoints['WSS']}"` に変更
   - 場所: [docker/viewer.py:103](docker/viewer.py#L103)

**3. WebSocket接続の403 Forbidden**
   - 問題: AWS Signature V4による署名が不足していた
   - 修正: AWS公式Pythonサンプルを参考に、`botocore.auth.SigV4QueryAuth`を使用した署名付きURL生成を実装
   - 実装: `_create_signed_wss_url()`メソッドを追加
   - 参考: [python-samples-for-amazon-kinesis-video-streams-with-webrtc](https://github.com/aws-samples/amazon-kinesis-video-streams-webrtc-sdk-python)

**4. RTCPeerConnection設定の型エラー**
   - 問題: `configuration`パラメータに`dict`を渡していたが、`RTCConfiguration`オブジェクトが必要だった
   - エラー: `AttributeError: 'dict' object has no attribute 'bundlePolicy'`
   - 修正: `RTCConfiguration(iceServers=signaling.ice_servers)`に変更

**5. ICE Serverの型エラー**
   - 問題: `ice_servers`に`dict`のリストを渡していたが、`RTCIceServer`オブジェクトのリストが必要だった
   - エラー: `AttributeError: 'dict' object has no attribute 'urls'`
   - 修正: `RTCIceServer`オブジェクトを使用するように変更

**6. SDP Offer送信時のrecipientClientId**
   - 問題: 当初、ViewerのClient IDを`recipientClientId`に設定していたため、メッセージが正しくルーティングされなかった
   - 修正: SINGLE_MASTERチャネルでは、Viewerから送信する際は空文字列(`''`)を指定

**7. 空メッセージ処理**
   - 問題: WebSocketから空メッセージが送られてきて、JSON decodeエラーが発生
   - 修正: 空メッセージをスキップする処理を追加

#### 実装の詳細

**主要な変更点:**

1. **AWS Signature V4対応** ([docker/viewer.py:111-148](docker/viewer.py#L111-L148))
   ```python
   def _create_signed_wss_url(self, wss_endpoint: str, channel_arn: str) -> str:
       """AWS Signature V4で署名されたWebSocket URLを生成"""
       session = Session()
       credentials = session.get_credentials()

       auth_credentials = Credentials(
           access_key=credentials.access_key,
           secret_key=credentials.secret_key,
           token=credentials.token
       )

       sig_v4 = SigV4QueryAuth(auth_credentials, 'kinesisvideo', self.region, 299)

       aws_request = AWSRequest(
           method='GET',
           url=wss_endpoint,
           params={
               'X-Amz-ChannelARN': channel_arn,
               'X-Amz-ClientId': self.client_id
           }
       )

       sig_v4.add_auth(aws_request)
       prepared_request = aws_request.prepare()
       return prepared_request.url
   ```

2. **メッセージエンコード/デコード** ([docker/viewer.py:151-167](docker/viewer.py#L151-L167))
   - Base64エンコードされたペイロード形式に対応
   - AWS SDK互換のメッセージフォーマットを実装

3. **WebSocket接続とSignaling** ([docker/viewer.py:169-231](docker/viewer.py#L169-L231))
   - `websockets`ライブラリを使用（`aiohttp`から変更）
   - ViewerからOfferを送信し、MasterからAnswerを受信
   - ICE Candidate交換の実装

4. **RTCPeerConnection設定** ([docker/viewer.py:275-277](docker/viewer.py#L275-L277))
   ```python
   pc = RTCPeerConnection(configuration=RTCConfiguration(
       iceServers=signaling.ice_servers
   ))
   ```

#### テスト結果

**Python Viewer側ログ（抜粋）:**
```
[2025-10-23T02:07:11] INFO: SDP Answerを受信しました（Masterから）
[2025-10-23T02:07:11] INFO: Remote Description (Answer)を設定しました
[2025-10-23T02:07:11] INFO: ICE Connection State: checking
[2025-10-23T02:07:11] INFO: ICE Connection State: completed
[2025-10-23T02:07:11] INFO: リモートトラックを受信: video (ID: e1ad48e3-345f-4959-ba0e-91e47be8cd1b)
[2025-10-23T02:07:11] INFO: リモートトラックを受信: audio (ID: a0ff88a8-b7ad-421f-b344-6b1befed7b44)
[2025-10-23T02:07:11] DEBUG: フレーム受信: video
[2025-10-23T02:07:11] DEBUG: フレーム受信: audio
```

**WebRTC Master側ログ（抜粋）:**
```
[2:07:11] SDP Offer を受信 (from: viewer-1761152830)
[2:07:11] ✅ Viewer viewer-1761152830 からの Offer を処理中...
[2:07:11] Answer を送信 (to: viewer-1761152830)
[2:07:11] ICE Connection State (viewer-1761152830): connected
[2:07:11] [SUCCESS] Viewer viewer-1761152830 との WebRTC 接続が確立しました！
```

**接続フロー確認:**
```
Python Viewer → KVS Signaling (WebSocket + AWS SigV4) → Master (Browser)
     ↓
SDP Offer送信
     ↓
SDP Answer受信 ← Master
     ↓
ICE Candidates交換
     ↓
DTLS Handshake
     ↓
P2P接続確立 ✅
     ↓
ビデオ/オーディオストリーム受信開始 ✅
```

### 現在の状態（2025-10-23時点）

**動作状況:**
- ✅ **WebRTC接続**: 完全に動作中
- ✅ **メディア受信**: ビデオ/オーディオフレームを正常に受信
- ⏳ **KVSストリーム転送**: 未実装（次のステップ）

**テスト環境:**
- **Master**: WebRTC/index.html（ブラウザベース）
- **Viewer**: docker/viewer.py（Python + aiortc）
- **接続**: ローカルネットワーク経由で正常に動作確認済み

**検証済みの項目:**
1. AWS認証（環境変数）
2. KVS Signaling Channelへの接続
3. AWS Signature V4によるWebSocket認証
4. SDP Offer/Answer交換
5. ICE Candidate交換
6. DTLS接続確立
7. メディアフレーム受信

### 次のステップ（優先順位順）

#### 1. KVS Streamへのメディア転送実装（最優先）

**現状:**
- ビデオ/オーディオフレームは正常に受信できているが、ログ出力のみ
- KVS Streamへの転送が未実装

**実装方針:**

**オプションA: GStreamer + kvssink plugin（推奨）**
- Dockerfileの基盤イメージに既にインストール済み
- aiortcで受信したフレームをGStreamerパイプラインに渡す
- 実装場所: [docker/viewer.py:241-259](docker/viewer.py#L241-L259) の`MediaHandler.handle_track()`

**オプションB: boto3 PutMedia API**
- より直接的だが、コーデック変換が必要
- boto3の`kinesisvideo.put_media()`を使用

**推奨実装手順:**
1. GStreamerパイプラインの初期化
2. aiortcから受信したフレームをGStreamerに渡す
3. kvssinkプラグインでKVS Streamに送信
4. エラーハンドリングと再接続ロジック

#### 2. Docker環境での動作確認

- ローカルでの動作確認は完了
- 次はDockerイメージをビルドして動作確認
- GStreamerとkvssinkプラグインの動作確認

#### 3. エラーハンドリングと再接続ロジック

- WebSocket切断時の自動再接続
- DTLS接続失敗時のリトライ
- GStreamerパイプラインエラーの処理

#### 4. Fargateへのデプロイ

- CDKスタックは既に完成
- Dockerイメージの最終ビルドとECRプッシュ
- Fargateサービスの起動と動作確認

## Security Notes and Development Guidelines

### セキュリティ
- **絶対にコミットしない**: `🐹credential.md` やAWS認証情報を含むファイル
- **IAMロールを使用**: Fargate/ECSデプロイ時はハードコード認証情報を避ける
- **即座にローテーション**: 認証情報が漏洩した場合は直ちにローテーション
- **gitignoreに追加**: 認証情報ファイルは必ず`.gitignore`に追加済み

### 開発時の注意事項
- **質問優先**: 不明な点があったら、質問してから作業を開始すること
- **環境変数使用**: 認証情報はファイルにハードコードせず、環境変数から取得すること
- **型アノテーション**: すべてのPython関数に型アノテーションを追加すること（グローバルルール）
- **変数名**: 常に説明的な変数名を使用すること（グローバルルール）

## Initial Setup

**初回セットアップ**: AWS CDKを使用してインフラストラクチャをデプロイしてください。詳細は上記「AWS Infrastructure Deployment (CDK)」セクションを参照してください。

CDKスタックにより、必要なすべてのAWSリソース（VPC、ECS、ECR、KVS Signaling Channel、KVS Stream、IAMロール等）が自動的に作成されます。

## Troubleshooting

### ResourceNotFoundException: The requested channel/stream is not found
**原因**: KVS Signaling ChannelまたはStreamが存在しない

**解決策**: CDKスタックをデプロイして、必要なリソースを作成してください
```bash
cd KvsAgent
npx cdk deploy
```

### AccessDeniedException
**原因**: IAM権限が不足している

**解決策**:
- **ローカル開発時**: 環境変数に `🐹credential.md` の認証情報が正しく設定されているか確認
  ```bash
  echo $AWS_ACCESS_KEY_ID
  echo $AWS_REGION
  ```
- **Fargate実行時**: CDKスタックで自動作成されたIAMロールに必要な権限が付与されているか確認

### WebRTC接続が確立しない
**原因**: Signaling Channelまたは認証の問題

**解決策**:
1. CDKスタックが正しくデプロイされているか確認
2. WebRTC Master（ブラウザ）が起動しているか確認
3. ログを確認:
   ```bash
   # ローカル実行時
   python3 viewer.py

   # Fargate実行時
   # CloudWatch Logsで確認
   ```

### Docker build時のプラットフォーム警告
**原因**: Apple Silicon (ARM64)環境でAMD64イメージをビルドしている

**解決策**: これは正常な動作です。`--platform=linux/amd64`によりFargate互換イメージがビルドされます。
