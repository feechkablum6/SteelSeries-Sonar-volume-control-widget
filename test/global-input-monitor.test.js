const test = require('node:test');
const assert = require('node:assert/strict');

const koffi = require('koffi');
const {
    GlobalInputMonitor,
    createWindowsGlobalInputNative,
    VK_ESCAPE
} = require('../global-input-monitor');

function createNative() {
    const native = {
        pointerHandler: null,
        keyboardHandler: null,
        removed: [],
        installPointerMonitor(handler) {
            this.pointerHandler = handler;
            return { type: 'pointer' };
        },
        installKeyboardMonitor(handler) {
            this.keyboardHandler = handler;
            return { type: 'keyboard' };
        },
        uninstall(subscription) {
            this.removed.push(subscription.type);
        }
    };
    return native;
}

test('dismisses on a pointer press belonging to another process', () => {
    const native = createNative();
    const reasons = [];
    const monitor = new GlobalInputMonitor(native, {
        ownerProcessId: 100,
        onDismiss: reason => reasons.push(reason),
        defer: callback => callback()
    });

    assert.equal(monitor.start(), true);
    native.pointerHandler(200);

    assert.deepEqual(reasons, ['outside-click']);
    assert.deepEqual(native.removed.sort(), ['keyboard', 'pointer']);
    assert.equal(monitor.isActive(), false);
});

test('keeps monitoring when the pointer press belongs to the widget process', () => {
    const native = createNative();
    const reasons = [];
    const monitor = new GlobalInputMonitor(native, {
        ownerProcessId: 100,
        onDismiss: reason => reasons.push(reason),
        defer: callback => callback()
    });

    monitor.start();
    native.pointerHandler(100);

    assert.deepEqual(reasons, []);
    assert.equal(monitor.isActive(), true);
});

test('dismisses on Escape but ignores other keys', () => {
    const native = createNative();
    const reasons = [];
    const monitor = new GlobalInputMonitor(native, {
        ownerProcessId: 100,
        onDismiss: reason => reasons.push(reason),
        defer: callback => callback()
    });

    monitor.start();
    native.keyboardHandler(65);
    assert.deepEqual(reasons, []);

    native.keyboardHandler(VK_ESCAPE);
    assert.deepEqual(reasons, ['escape']);
    assert.equal(monitor.isActive(), false);
});

test('starts once and releases both native subscriptions on stop', () => {
    const native = createNative();
    const monitor = new GlobalInputMonitor(native, {
        ownerProcessId: 100,
        onDismiss: () => {},
        defer: callback => callback()
    });

    assert.equal(monitor.start(), true);
    const firstPointerHandler = native.pointerHandler;
    assert.equal(monitor.start(), true);
    assert.equal(native.pointerHandler, firstPointerHandler);

    monitor.stop();
    monitor.stop();
    assert.deepEqual(native.removed.sort(), ['keyboard', 'pointer']);
});

test('releases the pointer subscription when keyboard hook installation fails', () => {
    const native = createNative();
    native.installKeyboardMonitor = () => {
        throw new Error('keyboard hook failed');
    };
    const monitor = new GlobalInputMonitor(native, {
        ownerProcessId: 100,
        onDismiss: () => {},
        onError: () => {},
        defer: callback => callback()
    });

    assert.equal(monitor.start(), false);
    assert.deepEqual(native.removed, ['pointer']);
    assert.equal(monitor.isActive(), false);
});

test('reuses the Windows native adapter across window recovery', () => {
    const first = createWindowsGlobalInputNative(koffi);
    const second = createWindowsGlobalInputNative(koffi);

    assert.equal(second, first);
});

test('releases every subscription when one native uninstall fails', () => {
    const native = createNative();
    native.uninstall = subscription => {
        native.removed.push(subscription.type);
        if (subscription.type === 'pointer') throw new Error('unhook failed');
    };
    const errors = [];
    const monitor = new GlobalInputMonitor(native, {
        ownerProcessId: 100,
        onDismiss: () => {},
        onError: message => errors.push(message),
        defer: callback => callback()
    });

    monitor.start();
    assert.doesNotThrow(() => monitor.stop());
    assert.deepEqual(native.removed.sort(), ['keyboard', 'pointer']);
    assert.equal(errors.length, 1);
});
