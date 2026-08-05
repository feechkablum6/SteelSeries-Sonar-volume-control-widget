const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readMainSource() {
    return fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
}

test('presents the Electron window after connecting it to the desktop', () => {
    const mainSource = readMainSource();
    const connectIndex = mainSource.indexOf(
        'const connected = await host.connect('
    );
    const connectedGuardIndex = mainSource.indexOf(
        'if (window !== mainWindow',
        connectIndex
    );
    const showIndex = mainSource.indexOf(
        'window.showInactive();',
        connectedGuardIndex
    );

    assert.notEqual(connectIndex, -1);
    assert.notEqual(connectedGuardIndex, -1);
    assert.ok(
        showIndex > connectedGuardIndex,
        'the BrowserWindow must be presented after the native desktop connection'
    );
});

test('keeps the desktop widget running while Chromium considers it hidden', () => {
    const mainSource = readMainSource();

    assert.match(
        mainSource,
        /backgroundThrottling:\s*false/,
        'the renderer must keep its timers while the window is covered'
    );
    for (const switchName of [
        'disable-renderer-backgrounding',
        'disable-background-timer-throttling',
        'disable-backgrounding-occluded-windows'
    ]) {
        assert.ok(
            mainSource.includes(switchName),
            `Chromium switch ${switchName} must be enabled before the app starts`
        );
    }
    assert.match(
        mainSource,
        /appendSwitch\(\s*'disable-features',\s*'CalculateNativeWinOcclusion'\s*\)/,
        'native occlusion detection must stay off for the desktop layer window'
    );

    const readyIndex = mainSource.indexOf('app.whenReady()');
    const lastSwitchIndex = mainSource.lastIndexOf('appendSwitch(');
    assert.ok(
        lastSwitchIndex !== -1 && lastSwitchIndex < readyIndex,
        'command line switches must be applied before the app is ready'
    );
});

test('rescans desktop icons on events instead of polling Explorer constantly', () => {
    const mainSource = readMainSource();
    const hostSource = fs.readFileSync(
        path.join(__dirname, '..', 'desktop-host.js'),
        'utf8'
    );

    const attachmentInterval = mainSource.match(
        /const DESKTOP_REFRESH_INTERVAL = (\d+)/
    );
    const rescanInterval = hostSource.match(
        /const ICON_RESCAN_INTERVAL = (\d+)/
    );

    assert.ok(attachmentInterval, 'the cheap attachment check keeps its interval');
    assert.ok(rescanInterval, 'a safety interval must back the icon snapshot');
    assert.ok(
        Number(rescanInterval[1]) >= 30000,
        'the full icon snapshot must not run on a schedule tighter than 30 seconds'
    );
    assert.match(
        hostSource,
        /readIconCount/,
        'the icon count is the cheap signal that the desktop shortcuts changed'
    );
    assert.match(
        mainSource,
        /desktopHost\?\.requestIconRescan\(\)/,
        'desktop events must ask the host for a fresh icon snapshot'
    );
    assert.match(
        mainSource,
        /powerMonitor\.on\('resume'/,
        'waking up from sleep must trigger a fresh icon snapshot'
    );
    assert.match(
        mainSource,
        /screen\.on\('display-metrics-changed'/,
        'display changes must trigger a fresh icon snapshot'
    );
});
