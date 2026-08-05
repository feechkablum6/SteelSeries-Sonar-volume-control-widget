const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audioController = require('../audio-controller');

test('reuses one connection per protocol instead of opening a socket per request', () => {
    const secure = audioController.requestOptions('https://127.0.0.1:1234/state', 'GET');
    const plain = audioController.requestOptions('http://127.0.0.1:1234/state', 'PUT');

    assert.equal(secure.agent.keepAlive, true);
    assert.equal(plain.agent.keepAlive, true);
    assert.notEqual(secure.agent, plain.agent);
    assert.equal(secure.method, 'GET');
    assert.equal(plain.method, 'PUT');
    assert.ok(
        secure.agent.maxSockets <= 8,
        'the Sonar client must not fan out into unbounded sockets'
    );
});

test('limits the relaxed certificate check to the Sonar client', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'audio-controller.js'),
        'utf8'
    );

    assert.doesNotMatch(
        source,
        /NODE_TLS_REJECT_UNAUTHORIZED/,
        'certificate validation must not be disabled for the whole process'
    );
    assert.equal(
        audioController.requestOptions('https://127.0.0.1:1234/state').rejectUnauthorized,
        false
    );
});
