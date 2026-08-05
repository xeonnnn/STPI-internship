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

    const options = {
        roomName: roomName,
        width: '100%',
        height: '100%',
        parentNode: document.getElementById('jitsi-container'),
        jwt: config.jwt || undefined,
        configOverwrite: {
            prejoinPageEnabled: false,
            startWithAudioMuted: !isModerator,
            startWithVideoMuted: false,
            enableNoAudioDetection: false,
            enableNoisyMicDetection: false,
            disableDeepLinking: true,
            hideConferenceTimer: false,
            enableCalendarIntegration: false,
            roomPasswordNumberOfDigits: 0,
            doNotStoreRoomPassword: true,
            requireDisplayName: false,
            disableInviteFunctions: true,
            disableRemoteMute: false,
            localRecording: {
                enabled: false,
            },
            fileRecordingsEnabled: false,
            liveStreamingEnabled: false,
            welcomePageDisabled: true,
            remoteVideoMenu: {
                disabled: false,
            },
            disableSelfView: false,
            disable1On1Mode: true,
            disableModeratorIndicator: false,
            // Ensure toolbar is always visible on mobile
            toolbarConfig: {
                autoHideWhileChatIsOpen: false,
                alwaysVisible: true,
            },
            participantsPane: {
                enabled: true,
            },
            chat: {
                enabled: true,
            },
            raiseHand: {
                enabled: true,
            },
            reactions: {
                enabled: true,
            },
            noiseSuppression: {
                enabled: true,
            },
            backgroundAlpha: 1,
            startAudioMuted: 0,
            startVideoMuted: 0,
            enableClosePage: false,
            disableInitialGUM: false,
            notifications: [],
            disableNotifications: true,
            disableProfile: true,
            readOnlyName: true,
            enableWelcomePage: false,
            enableClosePage: false,
        },
        interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false,
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
            DISABLE_PRESENCE_STATUS: true,
            DEFAULT_REMOTE_DISPLAY_NAME: 'Guest',
            TOOLBAR_BUTTONS: [
                'microphone', 'camera', 'closedcaptions', 'desktop', 'fullscreen',
                'fodeviceselection', 'hangup', 'chat', 'settings', 'raisehand',
                'tileview', 'videobackgroundblur', 'participants-pane'
            ],
            SETTINGS_SECTIONS: ['devices', 'language', 'moderator', 'calendar'],
            SHOW_CHROME_EXTENSION_BANNER: false,
            SHOW_PROMOTIONAL_CLOSE_PAGE: false,
            SUPPORT_URL: '#',
            MOBILE_APP_PROMO: false,
        },
        userInfo: {
            displayName: displayName
        }
    };

    const script = document.createElement('script');
    script.src = 'https://meet.jit.si/external_api.js';
    script.onload = function() {
        const api = new JitsiMeetExternalAPI(domain, options);

        api.addListener('readyToClose', function() {
            window.location.href = config.return_url || config.room_url.replace('/room/', '/choose-role/');
        });
    };
    document.body.appendChild(script);
})();
