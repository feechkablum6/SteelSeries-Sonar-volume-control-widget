const testModule = require('node:test');
const assertModule = require('node:assert/strict');
const { orderDevicesForPicker } = require('../device-routing');

testModule('lists the selected device first and keeps the rest in order', () => {
    const route = {
        selectedDeviceId: 'b',
        devices: [
            { id: 'a', friendlyName: 'A' },
            { id: 'b', friendlyName: 'B' },
            { id: 'c', friendlyName: 'C' }
        ]
    };

    assertModule.deepEqual(
        orderDevicesForPicker(route).map(device => device.id),
        ['b', 'a', 'c']
    );
});

testModule('keeps the original order when nothing is selected', () => {
    const route = {
        selectedDeviceId: '',
        devices: [{ id: 'a' }, { id: 'b' }]
    };

    assertModule.deepEqual(
        orderDevicesForPicker(route).map(device => device.id),
        ['a', 'b']
    );
    assertModule.deepEqual(orderDevicesForPicker(null), []);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getSelectableDevices,
    buildDeviceRouting
} = require('../device-routing');

const devices = [
    { id: 'vad-game', friendlyName: 'Sonar Gaming', dataFlow: 'render', state: 'active', isVad: true },
    { id: 'headphones', friendlyName: 'Headphones', dataFlow: 'render', state: 'active', isVad: false },
    { id: 'disabled-output', friendlyName: 'Disabled output', dataFlow: 'render', state: 'disabled', isVad: false },
    { id: 'microphone', friendlyName: 'Microphone', dataFlow: 'capture', state: 'active', isVad: false }
];

test('returns only active physical output devices for an output channel', () => {
    assert.deepEqual(
        getSelectableDevices(devices, 'game').map(device => device.id),
        ['headphones']
    );
});

test('returns only active physical input devices for the microphone channel', () => {
    assert.deepEqual(
        getSelectableDevices(devices, 'mic').map(device => device.id),
        ['microphone']
    );
});

test('maps classic redirections to selected physical devices', () => {
    const routing = buildDeviceRouting(devices, [
        { id: 'game', deviceId: 'headphones', isRunning: true },
        { id: 'mic', deviceId: '', isRunning: false }
    ]);

    assert.equal(routing.game.selectedDeviceId, 'headphones');
    assert.equal(routing.game.selectedDevice.friendlyName, 'Headphones');
    assert.deepEqual(routing.game.devices.map(device => device.id), ['headphones']);
    assert.equal(routing.mic.selectedDeviceId, '');
    assert.equal(routing.mic.selectedDevice, null);
    assert.deepEqual(routing.mic.devices.map(device => device.id), ['microphone']);
});
