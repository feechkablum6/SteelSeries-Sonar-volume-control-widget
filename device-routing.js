const CHANNEL_IDS = ['game', 'chat', 'media', 'aux', 'mic'];

function getSelectableDevices(devices, channelId) {
    const expectedFlow = channelId === 'mic' ? 'capture' : 'render';

    return (devices || []).filter(device => (
        device.dataFlow === expectedFlow &&
        device.state === 'active' &&
        device.isVad === false
    ));
}

function buildDeviceRouting(devices, redirections) {
    const redirectionById = new Map(
        (redirections || []).map(redirection => [redirection.id, redirection])
    );
    const deviceById = new Map(
        (devices || []).map(device => [device.id, device])
    );

    return Object.fromEntries(CHANNEL_IDS.map(channelId => {
        const redirection = redirectionById.get(channelId);
        const selectedDeviceId = redirection?.deviceId || '';

        return [channelId, {
            selectedDeviceId,
            selectedDevice: deviceById.get(selectedDeviceId) || null,
            devices: getSelectableDevices(devices, channelId)
        }];
    }));
}

module.exports = {
    CHANNEL_IDS,
    getSelectableDevices,
    buildDeviceRouting
};
