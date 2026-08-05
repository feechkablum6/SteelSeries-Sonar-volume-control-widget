const test = require('node:test');
const assert = require('node:assert/strict');

const desktopHostModule = require('../desktop-host');
const { DesktopHost, createWindowsDesktopNative } = desktopHostModule;

function createNative(overrides = {}) {
    const calls = [];
    const desktop = {
        parent: 'progman-1',
        listView: 'list-1',
        bounds: { x: 0, y: 0, width: 300, height: 100 }
    };

    return {
        calls,
        desktop,
        findDesktop: () => desktop,
        readIconRects: () => [{ x: 0, y: 0, width: 100, height: 100 }],
        readReservedRects: () => [],
        attachWindow: (windowHandle, foundDesktop, position, size) => {
            calls.push(['attach', windowHandle, foundDesktop.parent, position, size]);
            return true;
        },
        moveWindow: (windowHandle, foundDesktop, position, size) => {
            calls.push(['move', windowHandle, foundDesktop.parent, position, size]);
            return true;
        },
        sameHandle: (left, right) => left === right,
        ...overrides
    };
}

test('connects to the desktop and relocates away from an icon', async () => {
    const native = createNative();
    const host = new DesktopHost(native, { gap: 0 });

    const connected = await host.connect(
        'widget',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
    );

    assert.equal(connected, true);
    assert.deepEqual(host.getPosition(), { x: 100, y: 0 });
    assert.deepEqual(native.calls[0], [
        'attach',
        'widget',
        'progman-1',
        { x: 100, y: 0 },
        { width: 100, height: 100 }
    ]);
});

test('moves the widget against icon walls', async () => {
    const native = createNative({
        readIconRects: () => [{ x: 150, y: 0, width: 50, height: 100 }]
    });
    const host = new DesktopHost(native);
    await host.connect('widget', { x: 0, y: 0 }, { width: 100, height: 100 });

    const position = host.moveTowards({ x: 250, y: 0 });

    assert.deepEqual(position, { x: 50, y: 0 });
    assert.deepEqual(native.calls.at(-1).slice(0, 4), [
        'move', 'widget', 'progman-1', { x: 50, y: 0 }
    ]);
});

test('reattaches when Explorer replaces the desktop window', async () => {
    let activeDesktop = {
        parent: 'progman-1',
        listView: 'list-1',
        bounds: { x: 0, y: 0, width: 300, height: 100 }
    };
    const native = createNative({
        findDesktop: () => activeDesktop,
        readIconRects: () => []
    });
    const host = new DesktopHost(native);
    await host.connect('widget', { x: 100, y: 0 }, { width: 100, height: 100 });

    activeDesktop = {
        parent: 'progman-2',
        listView: 'list-2',
        bounds: { x: 0, y: 0, width: 300, height: 100 }
    };
    const refreshed = await host.refresh();

    assert.equal(refreshed, true);
    assert.deepEqual(native.calls.at(-1).slice(0, 3), [
        'attach', 'widget', 'progman-2'
    ]);
});

test('moves to a free position when a new icon overlaps the widget', async () => {
    let iconRects = [];
    const native = createNative({
        readIconRects: () => iconRects,
        readIconCount: () => iconRects.length
    });
    const host = new DesktopHost(native);
    await host.connect('widget', { x: 100, y: 0 }, { width: 100, height: 100 });

    iconRects = [{ x: 100, y: 0, width: 100, height: 100 }];
    await host.refresh();

    assert.deepEqual(host.getPosition(), { x: 0, y: 0 });
    assert.deepEqual(native.calls.at(-1).slice(0, 4), [
        'move', 'widget', 'progman-1', { x: 0, y: 0 }
    ]);
});

test('converts the taskbar outside the work area into a desktop obstacle', () => {
    assert.equal(typeof desktopHostModule.reservedRectsFromDisplays, 'function');
    assert.deepEqual(
        desktopHostModule.reservedRectsFromDisplays([{
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1032 }
        }]),
        [{ x: 0, y: 1032, width: 1920, height: 48 }]
    );
});

test('restores a saved position above the taskbar', async () => {
    const native = createNative({
        readIconRects: () => [],
        readReservedRects: () => [{ x: 0, y: 180, width: 300, height: 20 }]
    });
    native.desktop.bounds = { x: 0, y: 0, width: 300, height: 200 };
    const host = new DesktopHost(native);

    await host.connect('widget', { x: 100, y: 150 }, { width: 100, height: 100 });

    assert.deepEqual(host.getPosition(), { x: 100, y: 80 });
});

test('stops the widget above the taskbar while dragging down', async () => {
    const native = createNative({
        readIconRects: () => [],
        readReservedRects: () => [{ x: 0, y: 180, width: 300, height: 20 }]
    });
    native.desktop.bounds = { x: 0, y: 0, width: 300, height: 200 };
    const host = new DesktopHost(native);
    await host.connect('widget', { x: 100, y: 0 }, { width: 100, height: 100 });

    const position = host.moveTowards({ x: 100, y: 150 });

    assert.deepEqual(position, { x: 100, y: 80 });
});

function createFakeExplorer() {
    const definitions = [];
    const messages = [];
    const released = [];
    const callbacks = [];
    const sendMessageTimeout = () => {
        throw new Error('SendMessageTimeoutA must not run synchronously');
    };
    sendMessageTimeout.async = (
        _,
        message,
        wParam,
        lParam,
        flags,
        timeout,
        resultBuffer,
        callback
    ) => {
        messages.push({ message, wParam, lParam, flags, timeout });
        callbacks.push((sent, messageResult = 0) => {
            resultBuffer.writeBigInt64LE(BigInt(messageResult), 0);
            callback(null, sent);
        });
    };
    const functions = {
        IsWindow: () => 1,
        GetWindowThreadProcessId: (_, processIdBuffer) => {
            processIdBuffer.writeUInt32LE(42, 0);
            return 1;
        },
        OpenProcess: () => 2n,
        VirtualAllocEx: () => 3n,
        VirtualFreeEx: () => {
            released.push('memory');
            return 1;
        },
        CloseHandle: () => {
            released.push('process');
            return 1;
        },
        WriteProcessMemory: () => 1,
        ReadProcessMemory: () => 1,
        MapWindowPoints: () => 1,
        SendMessageTimeoutA: sendMessageTimeout
    };
    const fakeKoffi = {
        load: () => ({
            func(name) {
                definitions.push(name);
                return functions[name] || (() => 0);
            }
        }),
        address: value => BigInt(value)
    };

    return { definitions, messages, released, callbacks, fakeKoffi };
}

test('reads Explorer messages on a worker and releases resources after completion', async () => {
    const explorer = createFakeExplorer();

    const native = createWindowsDesktopNative(explorer.fakeKoffi);
    const resultPromise = native.readIconRects({ listView: 1n });

    assert.equal(typeof resultPromise?.then, 'function');
    assert.equal(explorer.definitions.includes('SendMessageTimeoutA'), true);
    assert.equal(explorer.messages.length, 1);
    assert.deepEqual(explorer.released, []);

    explorer.callbacks.shift()(1, 1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(explorer.messages.length, 2);
    assert.deepEqual(explorer.released, []);

    explorer.callbacks.shift()(1, 1);
    const result = await resultPromise;

    assert.deepEqual(result, []);
    assert.deepEqual(explorer.released, ['memory', 'process']);
});

test('bounds every Explorer message and aborts when the shell hangs', async () => {
    const explorer = createFakeExplorer();

    const native = createWindowsDesktopNative(explorer.fakeKoffi);
    const resultPromise = native.readIconRects({ listView: 1n });

    const [request] = explorer.messages;
    assert.ok(request.timeout > 0, 'the message must carry a timeout');
    assert.equal(request.flags & 0x2, 0x2, 'SMTO_ABORTIFHUNG must be set');

    explorer.callbacks.shift()(0);

    assert.equal(await resultPromise, null);
    assert.deepEqual(
        explorer.released,
        ['process'],
        'remote memory must stay allocated while Explorer may still write to it'
    );
});

test('gives up on a snapshot that a slow Explorer drags out', async () => {
    const explorer = createFakeExplorer();
    let clock = 0;

    const native = createWindowsDesktopNative(explorer.fakeKoffi, {
        now: () => clock
    });
    const resultPromise = native.readIconRects({ listView: 1n });

    explorer.callbacks.shift()(1, 5);
    await new Promise(resolve => setImmediate(resolve));

    clock += 60000;
    explorer.callbacks.shift()(1, 1);

    assert.equal(await resultPromise, null);
    assert.equal(
        explorer.messages.length,
        2,
        'the remaining icons must not be queried after the deadline'
    );
    assert.deepEqual(
        explorer.released,
        ['memory', 'process'],
        'every message finished, so the remote buffer is safe to release'
    );
});

test('asks Explorer for the icon count with a single message', async () => {
    const explorer = createFakeExplorer();

    const native = createWindowsDesktopNative(explorer.fakeKoffi);
    const countPromise = native.readIconCount({ listView: 1n });

    assert.equal(explorer.messages.length, 1);
    assert.equal(explorer.messages[0].message, 0x1004, 'LVM_GETITEMCOUNT');

    explorer.callbacks.shift()(1, 7);

    assert.equal(await countPromise, 7);
    assert.equal(
        explorer.messages.length,
        1,
        'counting icons must not walk the icon list'
    );
});

test('connect waits asynchronously for the icon snapshot before attaching', async () => {
    let finishRead;
    const native = createNative({
        readIconRects: () => new Promise(resolve => {
            finishRead = resolve;
        })
    });
    const host = new DesktopHost(native);

    const connectPromise = host.connect(
        'widget',
        { x: 100, y: 0 },
        { width: 100, height: 100 }
    );

    assert.equal(typeof connectPromise?.then, 'function');
    assert.deepEqual(native.calls, []);

    await new Promise(resolve => setImmediate(resolve));
    finishRead([]);
    assert.equal(await connectPromise, true);
    assert.equal(native.calls[0][0], 'attach');
});

test('keeps the attachment alive without polling Explorer for icons', async () => {
    let reads = 0;
    const native = createNative({
        readIconRects: () => { reads += 1; return []; },
        readIconCount: () => 0
    });
    const host = new DesktopHost(native);
    await host.connect('widget', { x: 100, y: 0 }, { width: 100, height: 100 });
    reads = 0;

    assert.equal(await host.refresh(), true);
    assert.equal(reads, 0, 'an unchanged desktop must not be walked again');
    assert.deepEqual(host.getPosition(), { x: 100, y: 0 });

    host.requestIconRescan();
    assert.equal(await host.refresh(), true);
    assert.equal(reads, 1);
});

test('drops removed icons as soon as the desktop icon count changes', async () => {
    let iconRects = [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 100, y: 0, width: 100, height: 100 }
    ];
    const native = createNative({
        readIconRects: () => iconRects,
        readIconCount: () => iconRects.length
    });
    const host = new DesktopHost(native);
    await host.connect('widget', { x: 200, y: 0 }, { width: 100, height: 100 });

    iconRects = [];
    assert.equal(await host.refresh(), true);

    assert.deepEqual(
        host.moveTowards({ x: 0, y: 0 }),
        { x: 0, y: 0 },
        'a deleted shortcut must stop blocking the widget'
    );
});

test('repeats a snapshot Explorer refused without walking the list every tick', async () => {
    let clock = 0;
    let reads = 0;
    let iconRects = [];
    const native = createNative({
        readIconRects: () => { reads += 1; return iconRects; },
        readIconCount: () => 1
    });
    const host = new DesktopHost(native, {
        now: () => clock,
        iconRescanInterval: 60000,
        iconRescanRetryInterval: 5000
    });
    await host.connect('widget', { x: 100, y: 0 }, { width: 100, height: 100 });

    iconRects = null;
    reads = 0;
    host.requestIconRescan();
    assert.equal(await host.refresh(), false, 'a refused snapshot fails the refresh');
    assert.equal(reads, 1);

    clock += 1500;
    await host.refresh();
    assert.equal(reads, 1, 'a busy Explorer must not be walked again immediately');

    clock += 5000;
    iconRects = [];
    assert.equal(await host.refresh(), true);
    assert.equal(reads, 2, 'the snapshot must be retried well before the safety interval');
});

test('rescans icons on a quiet desktop when the safety interval elapses', async () => {
    let clock = 0;
    let reads = 0;
    const native = createNative({
        readIconRects: () => { reads += 1; return []; },
        readIconCount: () => 0
    });
    const host = new DesktopHost(native, { now: () => clock, iconRescanInterval: 60000 });
    await host.connect('widget', { x: 100, y: 0 }, { width: 100, height: 100 });
    reads = 0;

    clock += 59000;
    await host.refresh();
    assert.equal(reads, 0);

    clock += 1000;
    await host.refresh();
    assert.equal(reads, 1);
});

test('rescans icons even on a quiet desktop when the desktop window changed', async () => {
    let activeDesktop = {
        parent: 'progman-1',
        listView: 'list-1',
        bounds: { x: 0, y: 0, width: 300, height: 100 }
    };
    const order = [];
    const native = createNative({
        findDesktop: () => activeDesktop,
        readIconRects: () => { order.push('readIconRects'); return []; },
        readIconCount: () => 0,
        attachWindow: (_windowHandle, foundDesktop) => {
            order.push(`attach:${foundDesktop.parent}`);
            return true;
        }
    });
    const host = new DesktopHost(native);
    await host.connect('widget', { x: 100, y: 0 }, { width: 100, height: 100 });

    order.length = 0;
    activeDesktop = {
        parent: 'progman-2',
        listView: 'list-2',
        bounds: { x: 0, y: 0, width: 300, height: 100 }
    };

    assert.equal(await host.refresh(), true);
    assert.deepEqual(order, ['attach:progman-2', 'readIconRects']);
});

test('refresh reattaches to the new desktop before re-reading icon rects', async () => {
    let activeDesktop = {
        parent: 'progman-1',
        listView: 'list-1',
        bounds: { x: 0, y: 0, width: 300, height: 100 }
    };
    const order = [];
    const native = createNative({
        findDesktop: () => activeDesktop,
        readIconRects: () => { order.push('readIconRects'); return []; },
        attachWindow: (_windowHandle, foundDesktop) => {
            order.push(`attach:${foundDesktop.parent}`);
            return true;
        }
    });
    const host = new DesktopHost(native);
    await host.connect('widget', { x: 100, y: 0 }, { width: 100, height: 100 });

    order.length = 0;
    activeDesktop = {
        parent: 'progman-2',
        listView: 'list-2',
        bounds: { x: 0, y: 0, width: 300, height: 100 }
    };

    const refreshed = await host.refresh();

    assert.equal(refreshed, true);
    assert.deepEqual(order, ['attach:progman-2', 'readIconRects']);
});
