(function () {
    const configElement = document.getElementById('room-config');
    if (!configElement) {
        return;
    }

    const config = JSON.parse(configElement.textContent);
    const joinButton = document.getElementById('join-btn');
    const leaveButton = document.getElementById('leave-btn');
    const micButton = document.getElementById('toggle-mic-btn');
    const cameraButton = document.getElementById('toggle-camera-btn');
    const shareButton = document.getElementById('share-screen-btn');
    const statusBadge = document.getElementById('connection-status');
    const localVideo = document.getElementById('local-video');
    const remoteGrid = document.getElementById('remote-grid');
    const participantList = document.getElementById('participant-list');
    const participantCount = document.getElementById('participant-count');
    const chatFeed = document.getElementById('chat-feed');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');

    const state = {
        socket: null,
        localStream: null,
        screenStream: null,
        selfParticipantId: null,
        participants: new Map(),
        peerConnections: new Map(),
        remoteStreams: new Map(),
        mediaReady: false,
        joined: false,
        micEnabled: true,
        cameraEnabled: true,
        joining: false,
    };

    if (!window.RTCPeerConnection || !navigator.mediaDevices) {
        setStatus('This browser does not support WebRTC.', 'error');
        joinButton.disabled = true;
        return;
    }

    if (config.room_state === 'closed') {
        setStatus('This room has ended.', 'warning');
        joinButton.textContent = 'Room Closed';
        joinButton.disabled = true;
    }

    function setStatus(text, tone) {
        statusBadge.textContent = text;
        statusBadge.className = 'rounded-full px-3 py-1 text-xs font-semibold';
        if (tone === 'error') {
            statusBadge.classList.add('bg-rose-500/20', 'text-rose-200');
        } else if (tone === 'warning') {
            statusBadge.classList.add('bg-amber-400/20', 'text-amber-200');
        } else if (tone === 'success') {
            statusBadge.classList.add('bg-emerald-500/20', 'text-emerald-200');
        } else {
            statusBadge.classList.add('bg-slate-700', 'text-slate-100');
        }
    }

    function socketUrl() {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        return `${protocol}://${window.location.host}${config.websocket_path}`;
    }

    function setControlState(enabled) {
        leaveButton.disabled = !enabled;
        micButton.disabled = !enabled;
        cameraButton.disabled = !enabled;
        shareButton.disabled = !enabled;
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function renderParticipants() {
        const list = Array.from(state.participants.values());
        participantCount.textContent = String(list.length);
        participantList.innerHTML = list
            .map((participant) => {
                const isSelf = participant.id === state.selfParticipantId;
                return `
                    <div class="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <div>
                            <div class="font-semibold text-white">${escapeHtml(participant.name)}</div>
                            <div class="text-xs text-slate-400">@${escapeHtml(participant.username)}</div>
                        </div>
                        <span class="rounded-full px-2 py-1 text-[11px] font-semibold ${isSelf ? 'bg-cyan-500/20 text-cyan-200' : 'bg-slate-700 text-slate-200'}">${isSelf ? 'You' : 'Guest'}</span>
                    </div>
                `;
            })
            .join('');
    }

    function renderChat(message, isSelf = false) {
        const bubbleClass = isSelf ? 'ml-auto bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-100';
        const nameClass = isSelf ? 'text-cyan-200' : 'text-slate-400';
        const item = document.createElement('div');
        item.className = `max-w-[85%] rounded-2xl px-4 py-3 ${bubbleClass}`;
        item.innerHTML = `
            <div class="text-[11px] font-semibold uppercase tracking-wide ${nameClass}">${escapeHtml(message.name)}</div>
            <div class="mt-1 text-sm">${escapeHtml(message.message)}</div>
        `;
        chatFeed.appendChild(item);
        chatFeed.scrollTop = chatFeed.scrollHeight;
    }

    function ensureRemoteTile(peerId, label) {
        let wrapper = remoteGrid.querySelector(`[data-peer-id="${peerId}"]`);
        if (wrapper) {
            return wrapper.querySelector('video');
        }

        wrapper = document.createElement('div');
        wrapper.dataset.peerId = peerId;
        wrapper.className = 'rounded-2xl border border-white/10 bg-black/30 p-3';
        wrapper.innerHTML = `
            <video autoplay playsinline class="h-56 w-full rounded-xl bg-black object-cover"></video>
            <div class="mt-2 flex items-center justify-between text-sm">
                <span class="font-semibold text-white">${escapeHtml(label)}</span>
                <span class="text-slate-400">Remote</span>
            </div>
        `;
        remoteGrid.appendChild(wrapper);
        return wrapper.querySelector('video');
    }

    function removeRemoteTile(peerId) {
        const tile = remoteGrid.querySelector(`[data-peer-id="${peerId}"]`);
        if (tile) {
            tile.remove();
        }
    }

    function closePeer(peerId) {
        const connection = state.peerConnections.get(peerId);
        if (connection) {
            connection.close();
            state.peerConnections.delete(peerId);
        }
        state.remoteStreams.delete(peerId);
        removeRemoteTile(peerId);
    }

    function refreshRemoteTracks(track) {
        for (const connection of state.peerConnections.values()) {
            const sender = connection.getSenders().find((item) => item.track && item.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(track);
            }
        }
    }

    function createPeerConnection(peer) {
        if (!state.localStream) {
            return null;
        }

        if (state.peerConnections.has(peer.id)) {
            return state.peerConnections.get(peer.id);
        }

        const peerConnection = new RTCPeerConnection({ iceServers: config.ice_servers });
        state.peerConnections.set(peer.id, peerConnection);

        state.localStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, state.localStream);
        });

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal(peer.id, 'candidate', event.candidate);
            }
        };

        peerConnection.ontrack = (event) => {
            const stream = event.streams[0] || state.remoteStreams.get(peer.id) || new MediaStream();
            if (event.streams[0]) {
                state.remoteStreams.set(peer.id, event.streams[0]);
            } else {
                stream.addTrack(event.track);
                state.remoteStreams.set(peer.id, stream);
            }
            const video = ensureRemoteTile(peer.id, peer.name);
            video.srcObject = state.remoteStreams.get(peer.id);
        };

        peerConnection.onconnectionstatechange = () => {
            if (['failed', 'closed', 'disconnected'].includes(peerConnection.connectionState)) {
                closePeer(peer.id);
            }
        };

        return peerConnection;
    }

    async function createOffer(peer) {
        const peerConnection = createPeerConnection(peer);
        if (!peerConnection) {
            return;
        }

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal(peer.id, 'offer', peerConnection.localDescription);
    }

    function sendSignal(target, signalType, data) {
        if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        state.socket.send(JSON.stringify({ type: 'signal', to: target, signal_type: signalType, data }));
    }

    async function handleSignal(message) {
        const sender = state.participants.get(message.from);
        if (!sender) {
            return;
        }

        const peerConnection = createPeerConnection(sender);
        if (!peerConnection) {
            return;
        }

        if (message.signal_type === 'offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.data));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            sendSignal(sender.id, 'answer', peerConnection.localDescription);
        } else if (message.signal_type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.data));
        } else if (message.signal_type === 'candidate' && message.data) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(message.data));
            } catch (error) {
                console.warn('Unable to add ICE candidate', error);
            }
        }
    }

    function handleParticipantJoined(participant) {
        state.participants.set(participant.id, participant);
        renderParticipants();
        if (state.joined && participant.id !== state.selfParticipantId) {
            createOffer(participant).catch((error) => console.error('Offer creation failed', error));
        }
    }

    function handleParticipantLeft(participantId) {
        state.participants.delete(participantId);
        renderParticipants();
        closePeer(participantId);
    }

    async function startScreenShare() {
        if (!state.localStream) {
            return;
        }
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const [screenTrack] = screenStream.getVideoTracks();
        if (!screenTrack) {
            return;
        }

        state.screenStream = screenStream;
        refreshRemoteTracks(screenTrack);
        localVideo.srcObject = screenStream;

        screenTrack.onended = () => {
            state.screenStream = null;
            const [cameraTrack] = state.localStream.getVideoTracks();
            if (cameraTrack) {
                refreshRemoteTracks(cameraTrack);
            }
            localVideo.srcObject = state.localStream;
        };
    }

    async function joinRoom() {
        if (state.joining || state.joined || config.room_state === 'closed') {
            return;
        }

        state.joining = true;
        joinButton.disabled = true;
        setStatus('Requesting camera and microphone...', 'warning');

        try {
            state.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
            });
            state.mediaReady = true;
            localVideo.srcObject = state.localStream;

            state.socket = new WebSocket(socketUrl());
            state.socket.onopen = () => {
                setStatus('Connected to room.', 'success');
                state.joined = true;
                setControlState(true);
                joinButton.textContent = 'Connected';
                joinButton.disabled = true;
                state.socket.send(JSON.stringify({ type: 'room.sync' }));
            };
            state.socket.onclose = () => {
                setStatus('Disconnected from room.', 'warning');
                state.joined = false;
                setControlState(false);
            };
            state.socket.onerror = () => {
                setStatus('WebSocket connection failed.', 'error');
            };
            state.socket.onmessage = async (event) => {
                const message = JSON.parse(event.data);
                if (message.type === 'room.initial_state') {
                    state.selfParticipantId = message.self && message.self.id;
                    state.participants.clear();
                    if (message.self) {
                        state.participants.set(message.self.id, message.self);
                    }
                    (message.participants || []).forEach((participant) => {
                        state.participants.set(participant.id, participant);
                    });
                    renderParticipants();
                    (message.chat || []).forEach((item) => renderChat(item, item.participant_id === state.selfParticipantId));
                    for (const participant of message.participants || []) {
                        createOffer(participant).catch((error) => console.error('Offer creation failed', error));
                    }
                    setStatus('Ready to present.', 'success');
                } else if (message.type === 'participant.joined') {
                    handleParticipantJoined(message.participant);
                } else if (message.type === 'participant.left') {
                    handleParticipantLeft(message.participant_id);
                } else if (message.type === 'signal.message') {
                    await handleSignal(message);
                } else if (message.type === 'chat.message') {
                    renderChat(message.message, message.message.participant_id === state.selfParticipantId);
                }
            };
        } catch (error) {
            console.error(error);
            setStatus('Unable to access camera or microphone.', 'error');
            joinButton.disabled = false;
        } finally {
            state.joining = false;
        }
    }

    function leaveRoom() {
        for (const peerConnection of state.peerConnections.values()) {
            peerConnection.close();
        }
        state.peerConnections.clear();
        state.remoteStreams.clear();
        remoteGrid.innerHTML = '';

        if (state.socket) {
            state.socket.close();
            state.socket = null;
        }

        if (state.localStream) {
            state.localStream.getTracks().forEach((track) => track.stop());
            state.localStream = null;
        }

        state.joined = false;
        state.mediaReady = false;
        joinButton.disabled = false;
        joinButton.textContent = 'Start & Join';
        setControlState(false);
        setStatus('Left the room.', 'warning');
        localVideo.srcObject = null;
    }

    function toggleMic() {
        if (!state.localStream) {
            return;
        }
        state.micEnabled = !state.micEnabled;
        state.localStream.getAudioTracks().forEach((track) => {
            track.enabled = state.micEnabled;
        });
        micButton.textContent = state.micEnabled ? 'Mute' : 'Unmute';
    }

    function toggleCamera() {
        if (!state.localStream) {
            return;
        }
        state.cameraEnabled = !state.cameraEnabled;
        state.localStream.getVideoTracks().forEach((track) => {
            track.enabled = state.cameraEnabled;
        });
        cameraButton.textContent = state.cameraEnabled ? 'Camera Off' : 'Camera On';
    }

    joinButton.addEventListener('click', () => {
        joinRoom().catch((error) => {
            console.error(error);
            setStatus('Unable to join the room.', 'error');
        });
    });

    leaveButton.addEventListener('click', leaveRoom);
    micButton.addEventListener('click', toggleMic);
    cameraButton.addEventListener('click', toggleCamera);
    shareButton.addEventListener('click', () => {
        startScreenShare().catch((error) => {
            console.error(error);
            setStatus('Screen sharing failed.', 'error');
        });
    });

    chatForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const message = chatInput.value.trim();
        if (!message || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
            return;
        }

        state.socket.send(JSON.stringify({ type: 'chat.message', message }));
        chatInput.value = '';
    });

    renderParticipants();
    setControlState(false);
    setStatus(config.room_state === 'live' ? 'Room is live.' : 'Waiting for the session to begin.', 'warning');
})();