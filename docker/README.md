# WebRTC KVS Agent - Docker ローカルデバッグガイド

このドキュメントでは、ローカル環境でDockerを使用してWebRTC KVS Agent (Python実装) をデバッグする方法を説明します。

プロジェクト全体の概要は [../README.md](../README.md) を、詳細な開発ガイドは [../CLAUDE.md](../CLAUDE.md) を参照してください。

## 前提条件

- Docker Desktop
- AWS CLI
- AWS認証情報（`🐹credential.md` 参照）
- Python 3.9以上（ローカル直接実行の場合）

## Pythonコードの直接実行（開発時）

Dockerを使わずに、Pythonで直接実行する方法:

```bash
cd docker

# 依存関係のインストール
pip3 install -r requirements.txt

# 環境変数を設定
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_SESSION_TOKEN="your-session-token"  # オプション
export AWS_REGION="us-west-2"

# 実行
python3 viewer.py
```

## Docker環境での実行（デバッグ用）

このセクションでは、ローカル環境でDockerを使用してデバッグする方法を説明します。

### Step 1: AWS認証情報の準備

`🐹credential.md` から認証情報を取得し、環境変数にエクスポート：

```bash
# プロジェクトルートディレクトリで実行
export AWS_ACCESS_KEY_ID="YOUR_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="YOUR_SECRET_ACCESS_KEY"
export AWS_SESSION_TOKEN="YOUR_SESSION_TOKEN"  # オプション
export AWS_REGION="us-west-2"
```

### Step 2: ECRにログイン

KVSベースイメージを取得するため、ECRにログインします：

```bash
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin 546150905175.dkr.ecr.us-west-2.amazonaws.com
```

**注意**: このコマンドは、Step 1で設定した認証情報を使用します。

### Step 3: Dockerイメージのビルド

プロジェクトルートから、dockerディレクトリに移動してビルド：

```bash
cd docker
docker build -t webrtc-kvs-agent .
```

または、プロジェクトルートから：

```bash
docker build -t webrtc-kvs-agent -f docker/Dockerfile docker/
```

**ビルドスクリプトを使用する場合**:

```bash
cd docker
./scripts/build-docker.sh
```

### Step 4: WebRTC Masterを起動

別のターミナルウィンドウで、ブラウザベースのMasterを起動：

```bash
# プロジェクトルートから
cd WebRTC
# index.htmlをブラウザで開く（macOSの場合）
open index.html

# または、簡易HTTPサーバーを起動
python3 -m http.server 8080
# その後、ブラウザで http://localhost:8080 を開く
```

ブラウザで：
1. AWS認証情報を入力（🐹credential.md参照）
2. "Master" ロールを選択
3. "Start" ボタンをクリック
4. カメラとマイクへのアクセスを許可

### Step 5: Dockerコンテナの実行

認証情報を環境変数として渡してコンテナを起動：

```bash
docker run --rm \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_REGION="$AWS_REGION" \
  webrtc-kvs-agent
```

**注意**: `$`を使用することで、Step 1で設定した環境変数を参照します。

### Step 6: ログの確認

コンテナが起動すると、以下のようなログが表示されます：

```
[2024-01-01T12:00:00.000Z] === WebRTC KVS Agent を起動中 ===
[2024-01-01T12:00:00.000Z] Channel Name: webrtc-kvs-agent-channel
[2024-01-01T12:00:00.000Z] Stream Name: webrtc-kvs-agent-stream
[2024-01-01T12:00:00.000Z] Client ID: viewer-1234567890
[2024-01-01T12:00:00.000Z] Region: us-west-2
[2024-01-01T12:00:00.000Z] AWS認証情報を環境変数から設定しました
[2024-01-01T12:00:00.000Z] Signaling Channelを取得中: webrtc-kvs-agent-channel
```

### Step 7: KVSストリームの確認

別のターミナルで、KVSストリームにデータが送信されているか確認：

```bash
aws kinesisvideo describe-stream --stream-name webrtc-kvs-agent-stream --region us-west-2
```

または、AWS ConsoleでKinesis Video Streamsを確認：
https://console.aws.amazon.com/kinesisvideo/home?region=us-west-2#/streams

### デバッグのヒント

#### ログをファイルに保存

```bash
docker run --rm \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_REGION="$AWS_REGION" \
  webrtc-kvs-agent 2>&1 | tee debug.log
```

#### コンテナ内でシェルを起動

```bash
docker run --rm -it \
  -e AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  -e AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN" \
  -e AWS_REGION="$AWS_REGION" \
  --entrypoint /bin/bash \
  webrtc-kvs-agent
```

コンテナ内で手動実行：

```bash
# GStreamerの確認
gst-launch-1.0 --version

# Pythonの確認
python3 --version

# アプリケーションの実行
python3 viewer.py
```

#### イメージのサイズ確認

```bash
docker images webrtc-kvs-agent
```

#### イメージの詳細確認

```bash
docker inspect webrtc-kvs-agent
```

### クリーンアップ

不要なDockerリソースを削除：

```bash
# イメージの削除
docker rmi webrtc-kvs-agent

# 全ての停止中のコンテナを削除
docker container prune

# 未使用のイメージを削除
docker image prune
```

## 環境変数

| 変数名 | 説明 | デフォルト | 必須 |
|--------|------|-----------|------|
| `AWS_REGION` | AWSリージョン | `us-west-2` | いいえ |
| `AWS_ACCESS_KEY_ID` | AWSアクセスキー | - | ローカル実行時のみ |
| `AWS_SECRET_ACCESS_KEY` | AWSシークレットキー | - | ローカル実行時のみ |
| `AWS_SESSION_TOKEN` | AWSセッショントークン | - | いいえ |

## トラブルシューティング

### GStreamerが見つからない
**原因**: Dockerイメージ内にGStreamerがインストールされていない

**解決策**:
- ベースイメージ `546150905175.dkr.ecr.us-west-2.amazonaws.com/kinesis-video-producer-sdk-cpp-amazon-linux:latest` にはGStreamerとkvssinkプラグインが含まれています
- ECRにログインできているか確認してください

### コンテナが起動しない
**原因**: 環境変数が正しく設定されていない

**解決策**:
```bash
# 環境変数を確認
echo $AWS_ACCESS_KEY_ID
echo $AWS_SECRET_ACCESS_KEY
echo $AWS_REGION

# 再度エクスポート
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_REGION="us-west-2"
```

### WebRTC接続が確立しない
**原因**: Signaling Channelが存在しないか、Masterが起動していない

**解決策**:
- CDKスタックがデプロイされているか確認（[../README.md](../README.md) 参照）
- WebRTC Masterが起動していることを確認
- CloudWatch Logsでエラーログを確認

その他のトラブルシューティングは [../CLAUDE.md - Troubleshooting](../CLAUDE.md#troubleshooting) を参照してください。
