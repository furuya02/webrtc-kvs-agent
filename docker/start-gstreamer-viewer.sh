#!/bin/bash

# WebRTC KVS Agent - GStreamer Viewer Startup Script
# このスクリプトは、GStreamerのwebrtcbinを使用してWebRTC Viewerとして動作し、
# 受信したメディアストリームをKVSに転送します。

set -e

# 設定
REGION=${AWS_REGION:-"ap-northeast-1"}
CHANNEL_NAME="webrtc-kvs-agent-channel"
STREAM_NAME="webrtc-kvs-agent-stream"
CLIENT_ID="viewer-$(date +%s)"

echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] === WebRTC KVS Agent (GStreamer) を起動中 ==="
echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] Channel Name: ${CHANNEL_NAME}"
echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] Stream Name: ${STREAM_NAME}"
echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] Client ID: ${CLIENT_ID}"
echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] Region: ${REGION}"

# AWS認証情報の確認
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] AWS認証情報をIAMロールから取得します"
else
    echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] AWS認証情報を環境変数から取得しました"
fi

# GStreamerパイプライン
# WebRTCで受信した映像/音声をKVSに転送
echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] GStreamerパイプラインを構築中..."

# GStreamer WebRTC Viewer Pipeline
# webrtcbin: WebRTC接続を処理
# kvssink: KVSへストリーミング
gst-launch-1.0 -v \
  webrtcbin name=webrtc \
    stun-server=stun://stun.kinesisvideo.${REGION}.amazonaws.com:443 \
  webrtc. ! queue ! \
    rtph264depay ! h264parse ! \
    video/x-h264,stream-format=avc,alignment=au ! \
    kvssink \
      stream-name="${STREAM_NAME}" \
      aws-region="${REGION}" \
      storage-size=512 \
  webrtc. ! queue ! \
    rtpopusdepay ! opusdec ! audioconvert ! \
    audioresample ! \
    avenc_aac ! aacparse ! \
    audio/mpeg ! \
    kvssink \
      stream-name="${STREAM_NAME}" \
      aws-region="${REGION}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] GStreamerパイプラインが終了しました"
