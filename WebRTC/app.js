// Global variables
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let peerConnectionByClientId = {};
let signalingClient = null;
let role = 'master';

// WebRTC configuration
const configuration = {
    iceServers: [],
    iceTransportPolicy: 'all'
};

// Credentials management
function saveCredentials() {
    const credentials = {
        accessKeyId: document.getElementById('accessKeyId').value,
        secretAccessKey: document.getElementById('secretAccessKey').value,
        sessionToken: document.getElementById('sessionToken').value,
        region: document.getElementById('region').value,
        channelName: document.getElementById('channelName').value
    };

    if (!credentials.accessKeyId || !credentials.secretAccessKey || !credentials.region || !credentials.channelName) {
        showStatus('error', '必須項目を入力してください (Access Key, Secret Key, Region, Channel Name)');
        return;
    }

    localStorage.setItem('awsCredentials', JSON.stringify(credentials));
    showStatus('success', '認証情報を保存しました');
    log('認証情報を localStorage に保存');
}

function loadCredentials() {
    const saved = localStorage.getItem('awsCredentials');
    if (saved) {
        const credentials = JSON.parse(saved);
        document.getElementById('accessKeyId').value = credentials.accessKeyId || '';
        document.getElementById('secretAccessKey').value = credentials.secretAccessKey || '';
        document.getElementById('sessionToken').value = credentials.sessionToken || '';
        document.getElementById('region').value = credentials.region || '';
        document.getElementById('channelName').value = credentials.channelName || '';
        showStatus('success', '保存された認証情報を読み込みました');
        log('認証情報を localStorage から読み込み');
    } else {
        showStatus('warning', '保存された認証情報がありません');
    }
}

function clearCredentials() {
    document.getElementById('accessKeyId').value = '';
    document.getElementById('secretAccessKey').value = '';
    document.getElementById('sessionToken').value = '';
    document.getElementById('region').value = '';
    document.getElementById('channelName').value = '';
    localStorage.removeItem('awsCredentials');
    showStatus('info', '認証情報をクリアしました');
    log('認証情報をクリア');
}

function getCredentials() {
    const credentials = {
        accessKeyId: document.getElementById('accessKeyId').value.trim(),
        secretAccessKey: document.getElementById('secretAccessKey').value.trim(),
        sessionToken: document.getElementById('sessionToken').value.trim(),
        region: document.getElementById('region').value.trim(),
        channelName: document.getElementById('channelName').value.trim()
    };

    if (!credentials.accessKeyId || !credentials.secretAccessKey || !credentials.region || !credentials.channelName) {
        throw new Error('認証情報が不完全です');
    }

    return credentials;
}

// Status and logging
function showStatus(type, message) {
    const container = document.getElementById('statusContainer');
    container.innerHTML = `<div class="status ${type}">${message}</div>`;
    log(`[${type.toUpperCase()}] ${message}`);
}

function log(message) {
    console.log(message); // Console にも出力
    const logsDiv = document.getElementById('logs');
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;
    logsDiv.appendChild(entry);
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

// AWS KVS WebRTC functions
async function start() {
    try {
        const credentials = getCredentials();
        role = document.querySelector('input[name="role"]:checked').value;

        log(`Starting as ${role}...`);
        showStatus('info', `${role} として起動中...`);

        // Configure AWS SDK
        AWS.config.update({
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken || undefined,
            region: credentials.region
        });

        const kinesisVideoClient = new AWS.KinesisVideo({
            region: credentials.region,
            correctClockSkew: true
        });

        log('Kinesis Video Client を作成');

        // Get signaling channel ARN
        log(`Signaling Channel を取得中: ${credentials.channelName}`);
        const describeSignalingChannelResponse = await kinesisVideoClient
            .describeSignalingChannel({
                ChannelName: credentials.channelName
            })
            .promise();

        const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
        log(`Channel ARN: ${channelARN}`);

        // Get signaling channel endpoints
        log('Signaling Channel エンドポイントを取得中...');
        const getSignalingChannelEndpointResponse = await kinesisVideoClient
            .getSignalingChannelEndpoint({
                ChannelARN: channelARN,
                SingleMasterChannelEndpointConfiguration: {
                    Protocols: ['WSS', 'HTTPS'],
                    Role: role === 'master' ? 'MASTER' : 'VIEWER'
                }
            })
            .promise();

        const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList.reduce(
            (endpoints, endpoint) => {
                endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
                return endpoints;
            },
            {}
        );

        log(`WSS Endpoint: ${endpointsByProtocol.WSS}`);
        log(`HTTPS Endpoint: ${endpointsByProtocol.HTTPS}`);

        // Get ICE server configuration
        log('ICE Server 設定を取得中...');
        const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
            region: credentials.region,
            endpoint: endpointsByProtocol.HTTPS,
            correctClockSkew: true
        });

        const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
            .getIceServerConfig({
                ChannelARN: channelARN
            })
            .promise();

        const iceServers = [];
        iceServers.push({ urls: `stun:stun.kinesisvideo.${credentials.region}.amazonaws.com:443` });

        getIceServerConfigResponse.IceServerList.forEach(iceServer => {
            iceServers.push({
                urls: iceServer.Uris,
                username: iceServer.Username,
                credential: iceServer.Password
            });
        });

        log(`ICE Servers: ${JSON.stringify(iceServers.map(s => s.urls))}`);
        configuration.iceServers = iceServers;

        // Create signaling client using KVS WebRTC SDK
        log('SignalingClient を作成中...');
        const signalingClientConfig = {
            channelARN: channelARN,
            channelEndpoint: endpointsByProtocol.WSS,
            role: role === 'master' ? KVSWebRTC.Role.MASTER : KVSWebRTC.Role.VIEWER,
            region: credentials.region,
            credentials: {
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
                sessionToken: credentials.sessionToken || undefined
            },
            systemClockOffset: kinesisVideoClient.config.systemClockOffset
        };

        // Viewerの場合はclientIdを追加
        if (role === 'viewer') {
            signalingClientConfig.clientId = 'viewer-' + Date.now();
        }

        signalingClient = new KVSWebRTC.SignalingClient(signalingClientConfig);

        // Setup signaling client event handlers
        signalingClient.on('open', async () => {
            log('SignalingClient が接続されました');

            // Start WebRTC based on role
            if (role === 'master') {
                await startMaster();
            } else {
                await startViewer();
            }
        });

        signalingClient.on('sdpOffer', async (offer, remoteClientId) => {
            log(`SDP Offer を受信 (from: ${remoteClientId})`);
            await handleOffer(offer, remoteClientId);
        });

        signalingClient.on('sdpAnswer', async (answer, remoteClientId) => {
            log(`SDP Answer を受信 (from: ${remoteClientId})`);
            await handleAnswer(answer, remoteClientId);
        });

        signalingClient.on('iceCandidate', async (candidate, remoteClientId) => {
            log(`ICE Candidate を受信 (from: ${remoteClientId || 'unknown'})`);
            await handleIceCandidate(candidate, remoteClientId);
        });

        signalingClient.on('close', () => {
            log('SignalingClient が切断されました');
        });

        signalingClient.on('error', (error) => {
            log(`SignalingClient エラー: ${error.message}`);
            showStatus('error', `シグナリングエラー: ${error.message}`);
        });

        // Open signaling connection
        log('SignalingClient を開始中...');
        signalingClient.open();

        document.getElementById('startButton').disabled = true;
        document.getElementById('stopButton').disabled = false;

    } catch (error) {
        log(`Error: ${error.message}`);
        showStatus('error', `エラー: ${error.message}`);
        console.error('Start error:', error);
    }
}

async function startMaster() {
    log('Master モードで起動中...');

    // Get local media stream
    log('カメラとマイクにアクセス中...');
    localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
    });

    document.getElementById('localVideo').srcObject = localStream;
    log('ローカルビデオストリームを取得');
    log('Master として待機中 - Viewer からの Offer を待っています...');

    showStatus('success', 'Master として起動完了。Viewer からの Offer を待機中...');
}

async function sendOfferBroadcast() {
    if (!localStream) {
        log('警告: localStream が存在しません');
        return;
    }

    log('全 Viewer にブロードキャスト Offer を送信中...');

    // Create new peer connection
    const newPeerConnection = new RTCPeerConnection(configuration);

    // Add local stream to peer connection
    localStream.getTracks().forEach(track => {
        newPeerConnection.addTrack(track, localStream);
    });

    // ICE candidate event
    newPeerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            log('ICE Candidate を送信（ブロードキャスト）');
            signalingClient.sendIceCandidate(event.candidate);
        }
    };

    // ICE connection state change
    newPeerConnection.oniceconnectionstatechange = () => {
        log(`ICE Connection State: ${newPeerConnection.iceConnectionState}`);
        if (newPeerConnection.iceConnectionState === 'connected') {
            showStatus('success', 'Viewer との WebRTC 接続が確立しました！');
        } else if (newPeerConnection.iceConnectionState === 'failed') {
            showStatus('error', 'Viewer との WebRTC 接続に失敗しました');
        }
    };

    // Create and send offer
    const offer = await newPeerConnection.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
    });

    await newPeerConnection.setLocalDescription(offer);
    log('Local Description を設定');

    // Send offer as broadcast (no recipient client ID)
    log('送信する Offer:', JSON.stringify(newPeerConnection.localDescription));
    signalingClient.sendSdpOffer(newPeerConnection.localDescription);
    log('Offer を送信（ブロードキャスト - 全Viewerへ）');

    // Store peer connection
    if (!peerConnection) {
        peerConnection = newPeerConnection;
    }
}

async function sendOfferToViewer(remoteClientId) {
    if (!localStream) {
        log('警告: localStream が存在しません');
        return;
    }

    log(`Viewer ${remoteClientId} 用に Offer を作成中...`);

    // Create new peer connection for this viewer
    const newPeerConnection = new RTCPeerConnection(configuration);

    // Add local stream to peer connection
    localStream.getTracks().forEach(track => {
        newPeerConnection.addTrack(track, localStream);
    });

    // ICE candidate event
    newPeerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            log(`ICE Candidate を送信 (to: ${remoteClientId})`);
            signalingClient.sendIceCandidate(event.candidate, remoteClientId);
        }
    };

    // ICE connection state change
    newPeerConnection.oniceconnectionstatechange = () => {
        log(`ICE Connection State (${remoteClientId}): ${newPeerConnection.iceConnectionState}`);
        if (newPeerConnection.iceConnectionState === 'connected') {
            showStatus('success', `Viewer ${remoteClientId} との WebRTC 接続が確立しました！`);
        } else if (newPeerConnection.iceConnectionState === 'failed') {
            showStatus('error', `Viewer ${remoteClientId} との WebRTC 接続に失敗しました`);
        }
    };

    // Create and send offer
    const offer = await newPeerConnection.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
    });

    await newPeerConnection.setLocalDescription(offer);
    log('Local Description を設定');

    // Send offer to specific viewer
    signalingClient.sendSdpOffer(newPeerConnection.localDescription, remoteClientId);
    log(`Offer を送信 (to: ${remoteClientId})`);

    // Store peer connection by client ID
    peerConnectionByClientId[remoteClientId] = newPeerConnection;

    // Store first peer connection as main connection
    if (!peerConnection) {
        peerConnection = newPeerConnection;
    }
}

async function startViewer() {
    log('Viewer モードで起動中...');

    // Create peer connection
    createPeerConnection();

    // Viewer から Offer を送信する
    log('Viewer から Master に Offer を送信中...');
    const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
    });

    await peerConnection.setLocalDescription(offer);
    log('Local Description (Offer) を設定');

    signalingClient.sendSdpOffer(peerConnection.localDescription);
    log('Offer を Master に送信しました');

    showStatus('info', 'Master からの Answer を待っています...');
}

function createPeerConnection() {
    log('RTCPeerConnection を作成中...');
    peerConnection = new RTCPeerConnection(configuration);

    // ICE candidate event
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            log('ICE Candidate を送信');
            signalingClient.sendIceCandidate(event.candidate);
        }
    };

    // ICE connection state change
    peerConnection.oniceconnectionstatechange = () => {
        log(`ICE Connection State: ${peerConnection.iceConnectionState}`);
        if (peerConnection.iceConnectionState === 'connected') {
            showStatus('success', 'WebRTC 接続が確立しました');
        } else if (peerConnection.iceConnectionState === 'failed') {
            showStatus('error', 'WebRTC 接続に失敗しました');
        }
    };

    // Track event (for receiving remote stream)
    peerConnection.ontrack = (event) => {
        log('リモートトラックを受信');
        if (event.streams && event.streams[0]) {
            document.getElementById('remoteVideo').srcObject = event.streams[0];
            remoteStream = event.streams[0];
            log('リモートビデオストリームを表示');
        }
    };
}

async function handleOffer(offer, remoteClientId) {
    log(`Offer を受信しました (from: ${remoteClientId})`);

    if (role === 'master') {
        // Master として Viewer からの Offer を受信
        log(`✅ Viewer ${remoteClientId} からの Offer を処理中...`);

        // 新しい Peer Connection を作成
        const newPeerConnection = new RTCPeerConnection(configuration);

        // Add local stream to peer connection
        if (localStream) {
            localStream.getTracks().forEach(track => {
                newPeerConnection.addTrack(track, localStream);
            });
            log('ローカルストリームをPeer Connectionに追加');
        }

        // ICE candidate event
        newPeerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                log(`ICE Candidate を送信 (to: ${remoteClientId})`);
                signalingClient.sendIceCandidate(event.candidate, remoteClientId);
            }
        };

        // ICE connection state change
        newPeerConnection.oniceconnectionstatechange = () => {
            log(`ICE Connection State (${remoteClientId}): ${newPeerConnection.iceConnectionState}`);
            if (newPeerConnection.iceConnectionState === 'connected') {
                showStatus('success', `Viewer ${remoteClientId} との WebRTC 接続が確立しました！`);
            } else if (newPeerConnection.iceConnectionState === 'failed') {
                showStatus('error', `Viewer ${remoteClientId} との WebRTC 接続に失敗しました`);
            }
        };

        // Set remote description (Offer)
        await newPeerConnection.setRemoteDescription(offer);
        log('Remote Description (Offer) を設定');

        // Create answer
        const answer = await newPeerConnection.createAnswer();
        await newPeerConnection.setLocalDescription(answer);
        log('Local Description (Answer) を設定');

        // Send answer
        signalingClient.sendSdpAnswer(newPeerConnection.localDescription, remoteClientId);
        log(`Answer を送信 (to: ${remoteClientId})`);

        // Store peer connection by client ID
        peerConnectionByClientId[remoteClientId] = newPeerConnection;

        // Store first peer connection as main connection
        if (!peerConnection) {
            peerConnection = newPeerConnection;
        }

    } else if (role === 'viewer') {
        // Viewer として Master からの Offer を受信
        if (!peerConnection) {
            createPeerConnection();
        }

        await peerConnection.setRemoteDescription(offer);
        log('Remote Description (Offer) を設定');

        // Create answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        log('Local Description (Answer) を設定');

        // Send answer
        signalingClient.sendSdpAnswer(peerConnection.localDescription, remoteClientId);
        log(`Answer を送信 (to: ${remoteClientId})`);
    }
}

async function handleAnswer(answer, remoteClientId) {
    log(`Answer を受信しました (from: ${remoteClientId})`);

    // Master の場合、複数の Viewer に対応
    if (role === 'master') {
        const pc = peerConnectionByClientId[remoteClientId];
        if (pc) {
            await pc.setRemoteDescription(answer);
            log(`Remote Description (Answer) を設定 (Client: ${remoteClientId})`);
            showStatus('success', `Viewer ${remoteClientId} と接続確立中...`);
        } else {
            log(`警告: Client ID ${remoteClientId} の PeerConnection が見つかりません`);
        }
    } else {
        // Viewer の場合は単一接続
        if (peerConnection) {
            await peerConnection.setRemoteDescription(answer);
            log('Remote Description (Answer) を設定');
        }
    }
}

async function handleIceCandidate(candidate, remoteClientId) {
    log(`ICE Candidate を受信しました (from: ${remoteClientId || 'unknown'})`);

    // Master の場合、複数の Viewer に対応
    if (role === 'master' && remoteClientId) {
        const pc = peerConnectionByClientId[remoteClientId];
        if (pc) {
            await pc.addIceCandidate(candidate);
        } else {
            log(`警告: Client ID ${remoteClientId} の PeerConnection が見つかりません`);
        }
    } else if (peerConnection) {
        // Viewer の場合は単一接続
        await peerConnection.addIceCandidate(candidate);
    }
}

function stop() {
    log('停止中...');

    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        document.getElementById('localVideo').srcObject = null;
        log('ローカルストリームを停止');
    }

    // Stop remote stream
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
        remoteStream = null;
        document.getElementById('remoteVideo').srcObject = null;
        log('リモートストリームを停止');
    }

    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
        log('ピア接続をクローズ');
    }

    // Close signaling client
    if (signalingClient) {
        signalingClient.close();
        signalingClient = null;
        log('シグナリング接続をクローズ');
    }

    document.getElementById('startButton').disabled = false;
    document.getElementById('stopButton').disabled = true;
    showStatus('info', '停止しました');
}

// Load saved credentials on page load
window.addEventListener('DOMContentLoaded', () => {
    log('ページを読み込みました');
    loadCredentials();
});
