# WebRTC KVS Agent - Python Implementation
# ベースイメージ: AWS KVS Producer SDK (GStreamer + kvssink含む)
FROM --platform=linux/amd64 546150905175.dkr.ecr.us-west-2.amazonaws.com/kinesis-video-producer-sdk-cpp-amazon-linux:latest

# Python 3.9とGStreamer Python bindingsに必要なパッケージをインストール
RUN yum update -y && \
    yum install -y \
        python3 \
        python3-pip \
        python3-devel \
        gcc \
        gcc-c++ \
        make \
        libffi-devel \
        openssl-devel \
        cairo-devel \
        gobject-introspection-devel && \
    yum clean all

# 作業ディレクトリ
WORKDIR /app

# Python依存関係をコピーしてインストール
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Pythonスクリプトをコピー
COPY viewer.py ./

# 環境変数
ENV PYTHONUNBUFFERED=1 \
    AWS_REGION=ap-northeast-1

# アプリケーションを起動
CMD ["python3", "viewer.py"]
