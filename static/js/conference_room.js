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
    const remoteStageShell = document.getElementById('remote-stage-shell');
    const localStageTile = document.getElementById('local-stage-tile');
    const roomClock = document.getElementById('room-clock');
    const participantList = document.getElementById('participant-list');
    const participantCount = document.getElementById('participant-count');
    const chatFeed = document.getElementById('chat-feed');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatSubmitButton = document.getElementById('chat-submit-btn');

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
        setButtonIcon(joinButton, 'fa-lock', 'Room closed');
        joinButton.disabled = true;
    }

    function setStatus(text, tone) {
        const statusText = text.replace(/\.$/, '');
        statusBadge.innerHTML = `<span class="h-2 w-2 rounded-full"></span>${escapeHtml(statusText)}`;
        statusBadge.className = 'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-bold uppercase';
        const dot = statusBadge.querySelector('span');
        if (tone === 'error') {
            statusBadge.classList.add('border-rose-400/25', 'bg-rose-500/15', 'text-rose-200');
            dot.className = 'h-2 w-2 rounded-full bg-rose-300';
        } else if (tone === 'warning') {
            statusBadge.classList.add('border-amber-300/25', 'bg-amber-400/15', 'text-amber-100');
            dot.className = 'h-2 w-2 rounded-full bg-amber-300';
        } else if (tone === 'success') {
            statusBadge.classList.add('border-emerald-300/25', 'bg-emerald-400/15', 'text-emerald-100');
            dot.className = 'h-2 w-2 rounded-full bg-emerald-300';
        } else {
            statusBadge.classList.add('border-zinc-500/25', 'bg-zinc-800', 'text-zinc-100');
            dot.className = 'h-2 w-2 rounded-full bg-zinc-400';
        }
    }

    function setButtonIcon(button, iconClass, label) {
        button.innerHTML = `<i class="fas ${iconClass}"></i>`;
        button.setAttribute('aria-label', label);
        button.dataset.tooltip = label;
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
        chatInput.disabled = !enabled;
        if (chatSubmitButton) {
            chatSubmitButton.disabled = !enabled;
        }
        chatInput.placeholder = enabled ? 'Type a message...' : 'Join the room to chat...';
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function participantInitials(participant) {
        const displayValue = participant.name || participant.username || 'Guest';
        const words = displayValue.trim().split(/\s+/).filter(Boolean);
        if (words.length >= 2) {
            return `${words[0][0]}${words[1][0]}`.toUpperCase();
        }
        return displayValue.slice(0, 2).toUpperCase();
    }

    function formatTimestamp(value) {
        const date = value ? new Date(value) : new Date();
        if (Number.isNaN(date.getTime())) {
            return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function renderParticipants() {
        const list = Array.from(state.participants.values());
        participantCount.textContent = String(list.length);
        if (!list.length) {
            participantList.innerHTML = `
                <div class="rounded-lg border border-dashed border-white/10 bg-zinc-950/50 px-4 py-5 text-center text-sm text-zinc-500">
                    No participants yet
                </div>
            `;
            return;
        }

        participantList.innerHTML = list
            .map((participant) => {
                const isSelf = participant.id === state.selfParticipantId;
                return `
                    <div class="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-3">
                        <div class="flex min-w-0 items-center gap-3">
                            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${isSelf ? 'bg-emerald-400 text-zinc-950' : 'bg-zinc-800 text-zinc-100'} text-sm font-black">
                                ${escapeHtml(participantInitials(participant))}
                            </div>
                            <div class="min-w-0">
                                <div class="truncate font-semibold text-white">${escapeHtml(participant.name || 'Guest')}</div>
                                <div class="truncate text-xs text-zinc-500">@${escapeHtml(participant.username || 'guest')}</div>
                            </div>
                        </div>
                        <span class="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ${isSelf ? 'bg-emerald-400/15 text-emerald-200' : 'bg-zinc-800 text-zinc-300'}">${isSelf ? 'You' : 'Guest'}</span>
                    </div>
                `;
            })
            .join('');
    }

    function renderChat(message, isSelf = false) {
        const bubbleClass = isSelf ? 'ml-auto bg-emerald-400 text-zinc-950' : 'mr-auto bg-zinc-800 text-zinc-100';
        const metaClass = isSelf ? 'text-zinc-800/70' : 'text-zinc-400';
        const item = document.createElement('div');
        item.className = `max-w-[88%] rounded-lg px-3 py-2 shadow-sm ${bubbleClass}`;
        item.innerHTML = `
            <div class="flex items-center justify-between gap-3 text-[11px] font-bold ${metaClass}">
                <span class="truncate">${escapeHtml(message.name || 'Guest')}</span>
                <time class="shrink-0">${escapeHtml(formatTimestamp(message.timestamp))}</time>
            </div>
            <div class="mt-1 break-words text-sm leading-5">${escapeHtml(message.message)}</div>
        `;
        chatFeed.appendChild(item);
        chatFeed.scrollTop = chatFeed.scrollHeight;
    }

    function syncStageEmptyState() {
        const hasRemoteTiles = remoteGrid.children.length > 0;
        if (remoteStageShell) {
            remoteStageShell.classList.toggle('hidden', !hasRemoteTiles);
            remoteStageShell.classList.toggle('grid', hasRemoteTiles);
        }
        if (localStageTile) {
            localStageTile.classList.toggle('max-w-[1228px]', !hasRemoteTiles);
            localStageTile.classList.toggle('absolute', hasRemoteTiles);
            localStageTile.classList.toggle('right-4', hasRemoteTiles);
            localStageTile.classList.toggle('bottom-28', hasRemoteTiles);
            localStageTile.classList.toggle('z-30', hasRemoteTiles);
            localStageTile.classList.toggle('h-32', hasRemoteTiles);
            localStageTile.classList.toggle('w-52', hasRemoteTiles);
            localStageTile.classList.toggle('sm:h-44', hasRemoteTiles);
            localStageTile.classList.toggle('sm:w-72', hasRemoteTiles);
            localStageTile.classList.toggle('ring-1', hasRemoteTiles);
            localStageTile.classList.toggle('ring-white/15', hasRemoteTiles);
        }
    }

    function ensureRemoteTile(peerId, label) {
        let wrapper = remoteGrid.querySelector(`[data-peer-id="${peerId}"]`);
        if (wrapper) {
            return wrapper.querySelector('video');
        }

        wrapper = document.createElement('div');
        wrapper.dataset.peerId = peerId;
        wrapper.className = 'relative h-full max-h-full w-full overflow-hidden rounded-[22px] bg-black shadow-2xl shadow-black/60';
        wrapper.innerHTML = `
            <video autoplay playsinline class="h-full min-h-[280px] w-full bg-black object-cover"></video>
            <div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-4">
                <div class="inline-flex max-w-full items-center gap-2 rounded-lg bg-black/35 px-3 py-2 text-sm font-bold text-white backdrop-blur">
                    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xs font-black">${escapeHtml(participantInitials({ name: label }))}</span>
                    <span class="truncate">${escapeHtml(label)}</span>
                </div>
            </div>
        `;
        remoteGrid.appendChild(wrapper);
        syncStageEmptyState();
        return wrapper.querySelector('video');
    }

    function removeRemoteTile(peerId) {
        const tile = remoteGrid.querySelector(`[data-peer-id="${peerId}"]`);
        if (tile) {
            tile.remove();
        }
        syncStageEmptyState();
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
        setStatus('Connecting', 'warning');

        try {
            state.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
            });
            state.mediaReady = true;
            localVideo.srcObject = state.localStream;

            state.socket = new WebSocket(socketUrl());
            state.socket.onopen = () => {
                setStatus('Connected', 'success');
                state.joined = true;
                setControlState(true);
                setButtonIcon(joinButton, 'fa-check', 'Connected');
                joinButton.disabled = true;
            };
            state.socket.onclose = () => {
                setStatus('Disconnected', 'error');
                state.joined = false;
                setControlState(false);
            };
            state.socket.onerror = () => {
                setStatus('Connection failed', 'error');
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
                    chatFeed.innerHTML = '';
                    (message.chat || []).forEach((item) => renderChat(item, item.participant_id === state.selfParticipantId));
                    for (const participant of message.participants || []) {
                        createOffer(participant).catch((error) => console.error('Offer creation failed', error));
                    }
                    setStatus('Connected', 'success');
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
            setStatus('Camera or microphone blocked', 'error');
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
        syncStageEmptyState();

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
        state.participants.clear();
        state.selfParticipantId = null;
        joinButton.disabled = false;
        setButtonIcon(joinButton, 'fa-phone', 'Start and join');
        setControlState(false);
        setStatus('Disconnected', 'error');
        localVideo.srcObject = null;
        renderParticipants();
    }

    function toggleMic() {
        if (!state.localStream) {
            return;
        }
        state.micEnabled = !state.micEnabled;
        state.localStream.getAudioTracks().forEach((track) => {
            track.enabled = state.micEnabled;
        });
        micButton.classList.toggle('bg-rose-500', !state.micEnabled);
        micButton.classList.toggle('border-rose-400/30', !state.micEnabled);
        setButtonIcon(
            micButton,
            state.micEnabled ? 'fa-microphone' : 'fa-microphone-slash',
            state.micEnabled ? 'Mute microphone' : 'Unmute microphone'
        );
    }

    function toggleCamera() {
        if (!state.localStream) {
            return;
        }
        state.cameraEnabled = !state.cameraEnabled;
        state.localStream.getVideoTracks().forEach((track) => {
            track.enabled = state.cameraEnabled;
        });
        cameraButton.classList.toggle('bg-rose-500', !state.cameraEnabled);
        cameraButton.classList.toggle('border-rose-400/30', !state.cameraEnabled);
        setButtonIcon(
            cameraButton,
            state.cameraEnabled ? 'fa-video' : 'fa-video-slash',
            state.cameraEnabled ? 'Turn camera off' : 'Turn camera on'
        );
    }

    function updateClock() {
        if (!roomClock) {
            return;
        }
        roomClock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
    syncStageEmptyState();
    updateClock();
    window.setInterval(updateClock, 30000);
    setControlState(false);
    if (config.room_state === 'closed') {
        setStatus('Room ended', 'warning');
    } else {
        setStatus(config.room_state === 'live' ? 'Disconnected' : 'Connecting', config.room_state === 'live' ? 'error' : 'warning');
    }
})();
