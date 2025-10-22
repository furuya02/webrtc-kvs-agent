#!/usr/bin/env python3
"""
WebRTC KVS Agent - Python Viewer Implementation

このスクリプトは、aiortcを使用してWebRTC Viewerとして動作し、
Masterから受信したメディアストリームをKinesis Video Streamsに転送します。
"""

import asyncio
import json
import logging
import os
import sys
from datetime import datetime
from typing import Optional

import boto3
import websockets
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, RTCConfiguration, RTCIceServer
from aiortc.sdp import candidate_from_sdp
from base64 import b64decode, b64encode
from botocore.auth import SigV4QueryAuth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials
from botocore.session import Session

# GStreamer
import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib

# GStreamer初期化
Gst.init(None)

# ログ設定
logging.basicConfig(
    level=logging.DEBUG,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S'
)
logger = logging.getLogger(__name__)

# 設定
REGION = os.environ.get('AWS_REGION') or 'us-west-2'  # 空文字列の場合もデフォルト値を使用
CHANNEL_NAME = 'webrtc-kvs-agent-channel'
STREAM_NAME = 'webrtc-kvs-agent-stream'
CLIENT_ID = f"viewer-{int(datetime.now().timestamp())}"


class KVSSignalingClient:
    """AWS Kinesis Video Streams WebRTC Signaling Client"""

    def __init__(self, region: str, channel_name: str, client_id: str):
        self.region = region
        self.channel_name = channel_name
        self.client_id = client_id
        self.kvs_client = boto3.client('kinesisvideo', region_name=region)
        self.ws_url: Optional[str] = None
        self.ice_servers: list = []

    async def get_signaling_endpoint(self) -> str:
        """Signaling Channelのエンドポイントを取得"""
        logger.info(f"Signaling Channelを取得中: {self.channel_name}")

        # Channel情報を取得
        describe_response = self.kvs_client.describe_signaling_channel(
            ChannelName=self.channel_name
        )
        channel_arn = describe_response['ChannelInfo']['ChannelARN']
        logger.info(f"Channel ARN: {channel_arn}")

        # エンドポイントを取得
        logger.info("Signaling Channelエンドポイントを取得中...")
        endpoint_response = self.kvs_client.get_signaling_channel_endpoint(
            ChannelARN=channel_arn,
            SingleMasterChannelEndpointConfiguration={
                'Protocols': ['WSS', 'HTTPS'],
                'Role': 'VIEWER'
            }
        )

        endpoints = {
            endpoint['Protocol']: endpoint['ResourceEndpoint']
            for endpoint in endpoint_response['ResourceEndpointList']
        }

        logger.info(f"WSS Endpoint: {endpoints['WSS']}")
        logger.info(f"HTTPS Endpoint: {endpoints['HTTPS']}")

        # ICE Server設定を取得
        logger.info("ICE Server設定を取得中...")
        kvs_signaling_client = boto3.client(
            'kinesis-video-signaling',
            region_name=self.region,
            endpoint_url=endpoints['HTTPS']
        )

        ice_response = kvs_signaling_client.get_ice_server_config(
            ChannelARN=channel_arn
        )

        self.ice_servers = [
            RTCIceServer(urls=f"stun:stun.kinesisvideo.{self.region}.amazonaws.com:443")
        ]

        for ice_server in ice_response['IceServerList']:
            self.ice_servers.append(RTCIceServer(
                urls=ice_server['Uris'],
                username=ice_server.get('Username'),
                credential=ice_server.get('Password')
            ))

        logger.info(f"ICE Servers: {[s.urls for s in self.ice_servers]}")

        # 署名付きWebSocket URLを構築
        self.ws_url = self._create_signed_wss_url(endpoints['WSS'], channel_arn)

        return self.ws_url

    def _create_signed_wss_url(self, wss_endpoint: str, channel_arn: str) -> str:
        """AWS Signature V4で署名されたWebSocket URLを生成"""
        # AWS認証情報を取得
        session = Session()
        credentials = session.get_credentials()

        if credentials is None:
            raise RuntimeError("AWS認証情報が取得できませんでした")

        # Credentialsオブジェクトを作成
        auth_credentials = Credentials(
            access_key=credentials.access_key,
            secret_key=credentials.secret_key,
            token=credentials.token
        )

        # AWS Signature V4クエリ認証を作成（有効期限299秒）
        sig_v4 = SigV4QueryAuth(auth_credentials, 'kinesisvideo', self.region, 299)

        # AWSRequestオブジェクトを作成
        aws_request = AWSRequest(
            method='GET',
            url=wss_endpoint,
            params={
                'X-Amz-ChannelARN': channel_arn,
                'X-Amz-ClientId': self.client_id
            }
        )

        # 署名を追加
        sig_v4.add_auth(aws_request)

        # 署名付きURLを取得
        prepared_request = aws_request.prepare()

        logger.info(f"署名付きWebSocket URLを生成しました")

        return prepared_request.url

    def _decode_message(self, msg: str) -> tuple:
        """受信したメッセージをデコード"""
        try:
            logger.debug(f"受信メッセージ(raw): {msg[:200]}...")  # 最初の200文字をログ出力
            data = json.loads(msg)
            payload = json.loads(b64decode(data['messagePayload'].encode('ascii')).decode('ascii'))
            return data['messageType'], payload, data.get('senderClientId')
        except (json.JSONDecodeError, KeyError) as e:
            logger.error(f"メッセージデコードエラー: {e}")
            logger.error(f"問題のメッセージ: {msg[:500]}")  # 最初の500文字を表示
            return '', {}, ''

    def _encode_message(self, action: str, payload: dict, client_id: str) -> str:
        """送信するメッセージをエンコード"""
        return json.dumps({
            'action': action,
            'messagePayload': b64encode(json.dumps(payload).encode('ascii')).decode('ascii'),
            'recipientClientId': client_id,
        })

    async def send_offer_and_receive(self, pc: RTCPeerConnection) -> None:
        """WebSocketに接続してSDP Offerを送信し、Answerを受信"""
        if not self.ws_url:
            raise RuntimeError("WebSocket URLが設定されていません")

        logger.info("SignalingClientに接続中...")

        try:
            async with websockets.connect(self.ws_url) as websocket:
                logger.info("SignalingClient接続が開きました")

                # ViewerとしてOfferを作成するには、transceiverを追加する必要がある
                # audio/videoを受信するためのtransceiverを追加
                pc.addTransceiver('video', direction='recvonly')
                pc.addTransceiver('audio', direction='recvonly')
                logger.info("Transceiverを追加しました（video/audio recvonly）")

                # SDP Offerを作成
                offer = await pc.createOffer()
                await pc.setLocalDescription(offer)
                logger.info("SDP Offerを作成しました")

                # SDP Offerを送信
                # ViewerからMasterへ送る場合、recipientClientIdは空文字列
                offer_message = self._encode_message(
                    'SDP_OFFER',
                    {
                        'sdp': pc.localDescription.sdp,
                        'type': pc.localDescription.type
                    },
                    ''  # SINGLE_MASTERチャネルではMasterへ自動的にルーティングされる
                )
                logger.info(f"送信メッセージ(JSON構造): action=SDP_OFFER, recipientClientId='', payload_size={len(offer_message)}")
                await websocket.send(offer_message)
                logger.info("SDP Offerを送信しました")

                # メッセージ受信ループ
                async for message in websocket:
                    # 空メッセージはスキップ
                    if not message or message.strip() == '':
                        logger.debug("空メッセージを受信（スキップ）")
                        continue

                    msg_type, payload, sender_client_id = self._decode_message(message)

                    # デコードに失敗した場合はスキップ
                    if not msg_type:
                        logger.warning("メッセージのデコードに失敗しました（スキップ）")
                        continue

                    if msg_type == 'SDP_ANSWER':
                        logger.info("SDP Answerを受信しました（Masterから）")
                        await pc.setRemoteDescription(
                            RTCSessionDescription(
                                sdp=payload['sdp'],
                                type=payload['type']
                            )
                        )
                        logger.info("Remote Description (Answer)を設定しました")

                    elif msg_type == 'ICE_CANDIDATE':
                        logger.info("ICE Candidateを受信しました")
                        try:
                            candidate = candidate_from_sdp(payload['candidate'])
                            candidate.sdpMid = payload['sdpMid']
                            candidate.sdpMLineIndex = payload['sdpMLineIndex']
                            await pc.addIceCandidate(candidate)
                        except Exception as e:
                            logger.error(f"ICE Candidate追加エラー: {e}")

        except Exception as e:
            logger.error(f"WebSocket接続エラー: {e}")
            raise


class MediaHandler:
    """受信したメディアトラックを処理してGStreamer経由でKVSに転送"""

    def __init__(self, stream_name: str, region: str):
        self.stream_name = stream_name
        self.region = region
        self.video_track = None
        self.audio_track = None
        self.video_pipeline = None
        self.audio_pipeline = None
        self.video_appsrc = None
        self.audio_appsrc = None

    def _create_video_pipeline(self) -> Gst.Pipeline:
        """ビデオ用GStreamerパイプラインを作成"""
        logger.info("ビデオ用GStreamerパイプラインを作成中...")

        # パイプライン文字列
        # appsrc: Pythonからフレームを受け取る
        # videoconvert: フォーマット変換
        # x264enc: H.264エンコード
        # h264parse: H.264ストリーム解析
        # kvssink: KVS Streamに送信
        pipeline_str = (
            f"appsrc name=videosrc format=time is-live=true ! "
            f"videoconvert ! "
            f"video/x-raw,format=I420 ! "
            f"x264enc tune=zerolatency bitrate=2000 speed-preset=veryfast ! "
            f"h264parse ! "
            f"video/x-h264,stream-format=avc,alignment=au ! "
            f"kvssink stream-name=\"{self.stream_name}\" aws-region=\"{self.region}\" "
            f"storage-size=512"
        )

        logger.debug(f"ビデオパイプライン: {pipeline_str}")
        pipeline = Gst.parse_launch(pipeline_str)

        # appsrcエレメントを取得
        self.video_appsrc = pipeline.get_by_name("videosrc")
        if not self.video_appsrc:
            raise RuntimeError("videosrc要素が見つかりません")

        # appsrcの設定
        self.video_appsrc.set_property("format", Gst.Format.TIME)
        self.video_appsrc.set_property("is-live", True)

        # パイプライン開始
        ret = pipeline.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            logger.error("ビデオパイプラインの開始に失敗しました")
            sys.exit(1)

        logger.info("ビデオパイプライン作成完了")
        return pipeline

    def _create_audio_pipeline(self) -> Gst.Pipeline:
        """オーディオ用GStreamerパイプラインを作成"""
        logger.info("オーディオ用GStreamerパイプラインを作成中...")

        # パイプライン文字列
        # appsrc: Pythonからフレームを受け取る
        # audioconvert: フォーマット変換
        # audioresample: リサンプリング
        # avenc_aac: AACエンコード
        # aacparse: AACストリーム解析
        # kvssink: KVS Streamに送信
        pipeline_str = (
            f"appsrc name=audiosrc format=time is-live=true ! "
            f"audioconvert ! "
            f"audioresample ! "
            f"audio/x-raw,rate=48000,channels=2 ! "
            f"avenc_aac ! "
            f"aacparse ! "
            f"audio/mpeg ! "
            f"kvssink stream-name=\"{self.stream_name}\" aws-region=\"{self.region}\""
        )

        logger.debug(f"オーディオパイプライン: {pipeline_str}")
        pipeline = Gst.parse_launch(pipeline_str)

        # appsrcエレメントを取得
        self.audio_appsrc = pipeline.get_by_name("audiosrc")
        if not self.audio_appsrc:
            raise RuntimeError("audiosrc要素が見つかりません")

        # appsrcの設定
        self.audio_appsrc.set_property("format", Gst.Format.TIME)
        self.audio_appsrc.set_property("is-live", True)

        # パイプライン開始
        ret = pipeline.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            logger.error("オーディオパイプラインの開始に失敗しました")
            sys.exit(1)

        logger.info("オーディオパイプライン作成完了")
        return pipeline

    def _push_video_frame(self, frame):
        """ビデオフレームをGStreamerに送信"""
        if not self.video_appsrc:
            logger.warning("video_appsrcが初期化されていません")
            return

        try:
            # av.VideoFrameをnumpy配列に変換
            img = frame.to_ndarray(format="rgb24")

            # numpy配列からGstBufferを作成
            data = img.tobytes()
            buffer = Gst.Buffer.new_allocate(None, len(data), None)
            buffer.fill(0, data)

            # タイムスタンプを設定
            buffer.pts = frame.pts if hasattr(frame, 'pts') and frame.pts else Gst.CLOCK_TIME_NONE
            buffer.dts = Gst.CLOCK_TIME_NONE
            buffer.duration = Gst.CLOCK_TIME_NONE

            # バッファをappsrcにプッシュ
            ret = self.video_appsrc.emit("push-buffer", buffer)
            if ret != Gst.FlowReturn.OK:
                logger.error(f"ビデオバッファのプッシュに失敗: {ret}")
                sys.exit(1)

            logger.debug("ビデオフレームをGStreamerにプッシュしました")
        except Exception as e:
            logger.error(f"ビデオフレームのプッシュエラー: {e}")
            sys.exit(1)

    def _push_audio_frame(self, frame):
        """オーディオフレームをGStreamerに送信"""
        if not self.audio_appsrc:
            logger.warning("audio_appsrcが初期化されていません")
            return

        try:
            # av.AudioFrameをnumpy配列に変換
            audio_data = frame.to_ndarray()

            # numpy配列からGstBufferを作成
            data = audio_data.tobytes()
            buffer = Gst.Buffer.new_allocate(None, len(data), None)
            buffer.fill(0, data)

            # タイムスタンプを設定
            buffer.pts = frame.pts if hasattr(frame, 'pts') and frame.pts else Gst.CLOCK_TIME_NONE
            buffer.dts = Gst.CLOCK_TIME_NONE
            buffer.duration = Gst.CLOCK_TIME_NONE

            # バッファをappsrcにプッシュ
            ret = self.audio_appsrc.emit("push-buffer", buffer)
            if ret != Gst.FlowReturn.OK:
                logger.error(f"オーディオバッファのプッシュに失敗: {ret}")
                sys.exit(1)

            logger.debug("オーディオフレームをGStreamerにプッシュしました")
        except Exception as e:
            logger.error(f"オーディオフレームのプッシュエラー: {e}")
            sys.exit(1)

    async def handle_track(self, track):
        """トラックを受信してGStreamer経由でKVSに転送"""
        logger.info(f"リモートトラックを受信: {track.kind} (ID: {track.id})")

        if track.kind == "video":
            self.video_track = track
            # ビデオパイプラインを作成
            self.video_pipeline = self._create_video_pipeline()

            # トラックからフレームを受信してGStreamerに転送
            while True:
                try:
                    frame = await track.recv()
                    self._push_video_frame(frame)
                except Exception as e:
                    logger.error(f"ビデオフレーム受信エラー: {e}")
                    sys.exit(1)

        elif track.kind == "audio":
            self.audio_track = track
            # オーディオパイプラインを作成
            self.audio_pipeline = self._create_audio_pipeline()

            # トラックからフレームを受信してGStreamerに転送
            while True:
                try:
                    frame = await track.recv()
                    self._push_audio_frame(frame)
                except Exception as e:
                    logger.error(f"オーディオフレーム受信エラー: {e}")
                    sys.exit(1)

    def cleanup(self):
        """リソースをクリーンアップ"""
        logger.info("GStreamerパイプラインをクリーンアップ中...")

        if self.video_pipeline:
            self.video_pipeline.set_state(Gst.State.NULL)
            logger.info("ビデオパイプラインを停止しました")

        if self.audio_pipeline:
            self.audio_pipeline.set_state(Gst.State.NULL)
            logger.info("オーディオパイプラインを停止しました")


async def run_viewer():
    """Viewerを起動"""
    logger.info("=== WebRTC KVS Agent (Python) を起動中 ===")
    logger.info(f"Channel Name: {CHANNEL_NAME}")
    logger.info(f"Stream Name: {STREAM_NAME}")
    logger.info(f"Client ID: {CLIENT_ID}")
    logger.info(f"Region: {REGION}")

    # Signaling Clientを初期化
    signaling = KVSSignalingClient(REGION, CHANNEL_NAME, CLIENT_ID)
    await signaling.get_signaling_endpoint()

    # PeerConnectionを作成
    pc = RTCPeerConnection(configuration=RTCConfiguration(
        iceServers=signaling.ice_servers
    ))

    # メディアハンドラを作成
    media_handler = MediaHandler(STREAM_NAME, REGION)

    # トラック受信イベント
    @pc.on("track")
    async def on_track(track):
        await media_handler.handle_track(track)

    # ICE接続状態変更イベント
    @pc.on("iceconnectionstatechange")
    async def on_ice_connection_state_change():
        logger.info(f"ICE Connection State: {pc.iceConnectionState}")

    # Signalingに接続してOfferを送信
    try:
        await signaling.send_offer_and_receive(pc)
    except KeyboardInterrupt:
        logger.info("KeyboardInterruptを受信。終了中...")
    except Exception as e:
        logger.error(f"エラー: {e}", exc_info=True)
    finally:
        # GStreamerパイプラインをクリーンアップ
        media_handler.cleanup()
        # PeerConnectionをクローズ
        await pc.close()
        logger.info("PeerConnectionをクローズしました")


def main():
    """メイン処理"""
    # AWS認証情報の確認
    if os.environ.get('AWS_ACCESS_KEY_ID') and os.environ.get('AWS_SECRET_ACCESS_KEY'):
        logger.info('AWS認証情報を環境変数から取得しました')
    else:
        logger.info('AWS認証情報をデフォルト（IAMロール）から取得します')

    # イベントループを実行
    try:
        asyncio.run(run_viewer())
    except KeyboardInterrupt:
        logger.info("プログラムを終了します")
        sys.exit(0)


if __name__ == '__main__':
    main()
