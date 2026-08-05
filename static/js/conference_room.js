(function () {
    const configElement = document.getElementById('room-config');
    if (!configElement) {
        console.error("Error: No room-config element found");
        return;
    }

    const config = JSON.parse(configElement.textContent);

    const roomName = config.room_name;
    const domain = config.jitsi_domain || 'meet.jit.si';
    const displayName = config.participant_name || config.display_name || config.user_name || '';
    const isModerator = Boolean(config.is_moderator);
    const container = document.getElementById('jitsi-container');

    if (!container) {
        console.error('Error: No jitsi-container element found');
        return;
    }

    const iframe = document.createElement('iframe');
    iframe.src = buildJitsiUrl(domain, roomName, config, displayName, isModerator);
    iframe.allow = 'camera; microphone; fullscreen; display-capture; autoplay; clipboard-read; clipboard-write';
    iframe.style.border = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.display = 'block';
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('title', config.conference_name || 'Jitsi meeting');

    const loadingOverlay = document.createElement('div');
    loadingOverlay.textContent = 'Connecting to the conference...';
    loadingOverlay.style.position = 'absolute';
    loadingOverlay.style.inset = '0';
    loadingOverlay.style.display = 'flex';
    loadingOverlay.style.alignItems = 'center';
    loadingOverlay.style.justifyContent = 'center';
    loadingOverlay.style.background = 'rgba(0, 0, 0, 0.6)';
    loadingOverlay.style.color = '#fff';
    loadingOverlay.style.fontSize = '1rem';
    loadingOverlay.style.zIndex = '2';

    iframe.addEventListener('load', function () {
        loadingOverlay.style.display = 'none';
    });

    container.style.position = 'relative';
    container.appendChild(loadingOverlay);
    container.appendChild(iframe);
})();

function buildJitsiUrl(domain, roomName, config, displayName, isModerator) {
    const url = new URL(`https://${domain}/${roomName}`);

    if (config.jwt) {
        url.searchParams.set('jwt', config.jwt);
    }

    const hashParams = new URLSearchParams();
    hashParams.set('config.prejoinPageEnabled', 'false');
    hashParams.set('config.startWithAudioMuted', String(!isModerator));
    hashParams.set('config.startWithVideoMuted', 'false');
    hashParams.set('config.disableDeepLinking', 'true');
    hashParams.set('config.enableNoAudioDetection', 'false');
    hashParams.set('config.enableNoisyMicDetection', 'false');
    hashParams.set('config.hideConferenceTimer', 'false');
    hashParams.set('config.enableCalendarIntegration', 'false');
    hashParams.set('config.requireDisplayName', 'false');
    hashParams.set('config.disableInviteFunctions', 'true');
    hashParams.set('config.disableRemoteMute', 'false');
    hashParams.set('config.fileRecordingsEnabled', 'false');
    hashParams.set('config.liveStreamingEnabled', 'false');
    hashParams.set('config.welcomePageDisabled', 'true');
    hashParams.set('config.disableSelfView', 'false');
    hashParams.set('config.disable1On1Mode', 'true');
    hashParams.set('config.disableModeratorIndicator', 'false');
    hashParams.set('config.enableClosePage', 'false');
    hashParams.set('config.disableNotifications', 'true');
    hashParams.set('config.disableProfile', 'true');
    hashParams.set('config.readOnlyName', 'true');
    hashParams.set('interfaceConfig.SHOW_JITSI_WATERMARK', 'false');
    hashParams.set('interfaceConfig.SHOW_WATERMARK_FOR_GUESTS', 'false');
    hashParams.set('interfaceConfig.SHOW_BRAND_WATERMARK', 'false');
    hashParams.set('interfaceConfig.SHOW_POWERED_BY', 'false');
    hashParams.set('interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS', 'true');
    hashParams.set('interfaceConfig.DISABLE_PRESENCE_STATUS', 'true');
    hashParams.set('interfaceConfig.DEFAULT_REMOTE_DISPLAY_NAME', 'Guest');
    hashParams.set('interfaceConfig.SHOW_CHROME_EXTENSION_BANNER', 'false');
    hashParams.set('interfaceConfig.SHOW_PROMOTIONAL_CLOSE_PAGE', 'false');
    hashParams.set('interfaceConfig.SUPPORT_URL', '#');
    hashParams.set('interfaceConfig.MOBILE_APP_PROMO', 'false');
    hashParams.set('userInfo.displayName', displayName);

    url.hash = hashParams.toString();
    return url.toString();
}
