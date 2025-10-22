#!/bin/bash
set -e

# このスクリプトは開発環境でエージェントを実行するためのものです
# 🐹credential.md の内容を環境変数として設定して実行します

echo "=== WebRTC KVS Agent - ローカル実行 ==="
echo ""

# 認証情報ファイルのパス
CRED_FILE="../🐹credential.md"

if [ ! -f "$CRED_FILE" ]; then
    echo "エラー: 🐹credential.md が見つかりません"
    echo "パス: $CRED_FILE"
    exit 1
fi

echo "認証情報を設定中..."

# 認証情報を環境変数に設定
# Note: 🐹credential.md から実際の値を読み取る処理が必要
# 以下は手動で設定する例です

read -p "AWS_ACCESS_KEY_ID: " AWS_ACCESS_KEY_ID
read -p "AWS_SECRET_ACCESS_KEY: " AWS_SECRET_ACCESS_KEY
read -p "AWS_SESSION_TOKEN (オプション): " AWS_SESSION_TOKEN
read -p "AWS_REGION [us-west-2]: " AWS_REGION

export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_SESSION_TOKEN
export AWS_REGION=${AWS_REGION:-us-west-2}

echo ""
echo "環境変数を設定しました"
echo "Region: $AWS_REGION"
echo ""

# ビルドして実行
echo "アプリケーションをビルド中..."
npm run build

echo ""
echo "アプリケーションを起動中..."
npm start
