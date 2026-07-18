(function () {
    const configElement = document.getElementById('room-config');
    if (!configElement) {
        return;
    }

    const config = JSON.parse(configElement.textContent);
    const domain = 'meet.jit.si';
    const options = {
        roomName: config.conference_acronym.replace(/\s+/g, '-') + '-' + config.conference_id,
        width: '100%',
        height: '100%',
        parentNode: document.querySelector('#jitsi-container'),
        userInfo: {
            displayName: config.participant_name
        },
        configOverwrite: {
            prejoinPageEnabled: false,
            startWithAudioMuted: false,
            startWithVideoMuted: false,
        },
        interfaceConfigOverwrite: {
            filmStripOnly: false,
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
        }
    };

    const api = new JitsiMeetExternalAPI(domain, options);

    api.addListener('readyToClose', () => {
        api.dispose();
        window.location.href = config.room_url.replace('/room/', '/choose-role/');
    });
})();
