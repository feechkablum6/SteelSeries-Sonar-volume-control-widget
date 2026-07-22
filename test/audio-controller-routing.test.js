const test = require('node:test');
const assert = require('node:assert/strict');

const { createRoutingClient } = require('../audio-controller');

test('loads classic redirections from Sonar', async () => {
    const requests = [];
    const client = createRoutingClient({
        initialize: async () => true,
        getAddress: () => 'http://127.0.0.1:53338',
        request: async (url, method = 'GET') => {
            requests.push({ url, method });
            return {
                status: 200,
                data: JSON.stringify([{ id: 'game', deviceId: 'headphones' }])
            };
        }
    });

    assert.deepEqual(await client.getClassicRedirections(), [
        { id: 'game', deviceId: 'headphones' }
    ]);
    assert.deepEqual(requests, [{
        url: 'http://127.0.0.1:53338/classicRedirections',
        method: 'GET'
    }]);
});

test('sets a classic redirection through the Sonar deviceId endpoint', async () => {
    const requests = [];
    const client = createRoutingClient({
        initialize: async () => true,
        getAddress: () => 'http://127.0.0.1:53338',
        request: async (url, method = 'GET') => {
            requests.push({ url, method });
            return { status: 200, data: '{}' };
        }
    });

    assert.equal(await client.setClassicRedirection('chat', '{device-id}'), true);
    assert.deepEqual(requests, [{
        url: 'http://127.0.0.1:53338/classicRedirections/chat/deviceId/{device-id}',
        method: 'PUT'
    }]);
});

test('rejects an unknown channel without sending a request', async () => {
    let called = false;
    const client = createRoutingClient({
        initialize: async () => true,
        getAddress: () => 'http://127.0.0.1:53338',
        request: async () => {
            called = true;
            return { status: 200, data: '{}' };
        }
    });

    assert.equal(await client.setClassicRedirection('master', 'device-id'), false);
    assert.equal(called, false);
});
