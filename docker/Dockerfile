# WebRTC KVS Agent - Python Implementation
# ベースイメージ: Python 3.11 (Debian-based, システムパッケージとの互換性重視)
FROM python:3.11-slim-bookworm

# システムパッケージのインストール
# GStreamer、FFmpeg、ビルドツール、KVS SDK依存関係
RUN apt-get update && apt-get install -y \
    # GStreamer core and plugins
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-tools \
    libgstreamer1.0-dev \
    libgstreamer-plugins-base1.0-dev \
    # FFmpeg libraries (for av package)
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    libavdevice-dev \
    libavfilter-dev \
    libswscale-dev \
    libswresample-dev \
    # Python GObject bindings
    python3-gi \
    python3-gi-cairo \
    gir1.2-gstreamer-1.0 \
    gir1.2-gst-plugins-base-1.0 \
    libcairo2-dev \
    libgirepository1.0-dev \
    # Build tools
    build-essential \
    cmake \
    git \
    pkg-config \
    # KVS SDK dependencies
    libssl-dev \
    libcurl4-openssl-dev \
    liblog4cplus-dev \
    libgstreamer1.0-0 \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-ugly \
    # Additional KVS SDK build dependencies
    m4 \
    autoconf \
    automake \
    libtool \
    libcap-dev \
    && rm -rf /var/lib/apt/lists/*

# python3-giのシンボリックリンクを作成
# システムパッケージのgiモジュールをPython 3.11から参照できるようにする
RUN ln -s /usr/lib/python3/dist-packages/gi /usr/local/lib/python3.11/site-packages/gi && \
    ln -s /usr/lib/python3/dist-packages/cairo /usr/local/lib/python3.11/site-packages/cairo && \
    ln -s /usr/lib/python3/dist-packages/_gi.cpython-311-aarch64-linux-gnu.so /usr/local/lib/python3.11/site-packages/_gi.cpython-311-aarch64-linux-gnu.so || true && \
    ln -s /usr/lib/python3/dist-packages/_gi_cairo.cpython-311-aarch64-linux-gnu.so /usr/local/lib/python3.11/site-packages/_gi_cairo.cpython-311-aarch64-linux-gnu.so || true

# AWS Kinesis Video Streams Producer SDK (kvssink plugin)
# ソースからビルドしてインストール
RUN cd /tmp && \
    git clone --recursive https://github.com/awslabs/amazon-kinesis-video-streams-producer-sdk-cpp.git && \
    cd amazon-kinesis-video-streams-producer-sdk-cpp && \
    mkdir -p build && cd build && \
    cmake .. \
        -DBUILD_GSTREAMER_PLUGIN=ON \
        -DBUILD_DEPENDENCIES=OFF \
        -DCMAKE_BUILD_TYPE=Release && \
    make && \
    make install && \
    ldconfig && \
    cd / && rm -rf /tmp/amazon-kinesis-video-streams-producer-sdk-cpp

# 作業ディレクトリ
WORKDIR /app

# Python依存関係をコピーしてインストール
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Pythonスクリプトをコピー
COPY viewer.py ./

# 環境変数
ENV PYTHONUNBUFFERED=1 \
    AWS_REGION=ap-northeast-1 \
    GST_PLUGIN_PATH=/usr/local/lib/gstreamer-1.0 \
    LD_LIBRARY_PATH=/usr/local/lib

# アプリケーションを起動
CMD ["python3", "viewer.py"]
