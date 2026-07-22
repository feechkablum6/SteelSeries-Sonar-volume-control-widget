const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const koffi = require('koffi')
const audioController = require('./audio-controller')
const { DesktopHost, createWindowsDesktopNative } = require('./desktop-host')
const { beginDrag, dragTarget } = require('./drag-position')

let mainWindow = null;
let desktopHost = null;
let desktopNative = null;
let desktopRefreshTimer = null;
let windowRecoveryTimer = null;
let dragSession = null;
let isQuitting = false;
const settingsPath = path.join(app.getPath('userData'), 'widget-settings.json');
const WIDGET_SIZE = { width: 450, height: 300 };
const DESKTOP_REFRESH_INTERVAL = 1500;
const WINDOW_RECOVERY_DELAY = 1500;
const ICON_GAP = 6;

// Автозапуск при старте Windows
const APP_NAME = 'SonarGlassWidget';
function setAutoLaunch(enable) {
    if (process.platform !== 'win32') return;
    
    const exePath = app.getPath('exe');
    const regKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`;
    
    if (enable) {
        require('child_process').exec(`reg add "${regKey}" /v "${APP_NAME}" /t REG_SZ /d "\\"${exePath}\\"" /f`);
    } else {
        require('child_process').exec(`reg delete "${regKey}" /v "${APP_NAME}" /f`);
    }
}

function isAutoLaunchEnabled() {
    if (process.platform !== 'win32') return false;
    
    try {
        const result = require('child_process').execSync(
            `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${APP_NAME}"`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        return result.includes(APP_NAME);
    } catch {
        return false;
    }
}

app.disableHardwareAcceleration()

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {}
    return null;
}

function saveSettings(settings) {
    try {
        const current = loadSettings() || {};
        fs.writeFileSync(settingsPath, JSON.stringify({ ...current, ...settings }, null, 2));
    } catch (e) {}
}

function isValidPoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function saveWidgetPosition() {
    const position = desktopHost?.getPosition();
    if (position) saveSettings(position);
}

function connectToDesktop() {
    if (!mainWindow || mainWindow.isDestroyed()) return false;

    const settings = loadSettings() || {};
    const desktop = desktopNative.findDesktop();
    if (!desktop) return false;

    const desiredPosition = {
        x: Number.isFinite(settings.x)
            ? settings.x
            : desktop.bounds.x + Math.round((desktop.bounds.width - WIDGET_SIZE.width) / 2),
        y: Number.isFinite(settings.y)
            ? settings.y
            : desktop.bounds.y + Math.round((desktop.bounds.height - WIDGET_SIZE.height) / 2)
    };

    mainWindow.showInactive();
    const connected = desktopHost.connect(
        mainWindow.getNativeWindowHandle(),
        desiredPosition,
        WIDGET_SIZE
    );
    if (!connected) {
        mainWindow.hide();
        return false;
    }

    const activeDesktop = desktopNative.findDesktop();
    const iconRects = activeDesktop ? desktopNative.readIconRects(activeDesktop) : null;
    const position = desktopHost.getPosition();
    console.log(
        `Desktop host initialized: parent=${activeDesktop ? `0x${activeDesktop.parent.toString(16)}` : 'unknown'}, ` +
        `icons=${iconRects?.length ?? 'unknown'}, ` +
        `position=${position.x},${position.y}`
    );
    saveWidgetPosition();
    return true;
}

function refreshDesktop() {
    if (!desktopHost || dragSession) return;

    const before = desktopHost.getPosition();
    if (!before) {
        connectToDesktop();
        return;
    }

    if (!desktopHost.refresh()) return;
    const after = desktopHost.getPosition();
    if (after && (after.x !== before.x || after.y !== before.y)) {
        saveWidgetPosition();
    }
}

function createWindow() {
    if (mainWindow || isQuitting) return;
    desktopNative = createWindowsDesktopNative(koffi);
    desktopHost = new DesktopHost(desktopNative, { gap: ICON_GAP });

    mainWindow = new BrowserWindow({
        width: WIDGET_SIZE.width,
        height: WIDGET_SIZE.height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: false,
        focusable: false,
        show: false,
        icon: path.join(__dirname, 'icon-256.ico'),
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    mainWindow.webContents.once('did-finish-load', () => {
        if (!connectToDesktop()) {
            console.error('Desktop host is not available; waiting for Explorer');
        }
        desktopRefreshTimer = setInterval(refreshDesktop, DESKTOP_REFRESH_INTERVAL);
    });

    mainWindow.on('closed', () => {
        if (desktopRefreshTimer) clearInterval(desktopRefreshTimer);
        desktopRefreshTimer = null;
        desktopHost = null;
        mainWindow = null;
        if (!isQuitting && !windowRecoveryTimer) {
            windowRecoveryTimer = setTimeout(() => {
                windowRecoveryTimer = null;
                createWindow();
            }, WINDOW_RECOVERY_DELAY);
        }
    });

    mainWindow.loadFile('index.html');
}

ipcMain.on('desktop:drag-start', (_, point) => {
    if (!isValidPoint(point) || !desktopHost?.getPosition()) return;
    desktopHost.refresh();
    dragSession = beginDrag(point, desktopHost.getPosition());
});

ipcMain.on('desktop:drag-move', (_, point) => {
    if (!dragSession || !isValidPoint(point) || !desktopHost) return;
    desktopHost.moveTowards(dragTarget(point, dragSession));
});

ipcMain.on('desktop:drag-end', () => {
    if (!dragSession) return;
    dragSession = null;
    saveWidgetPosition();
});

// IPC Handlers — Sonar API (async)
ipcMain.handle('audio:set-volume', async (_, id, vol) => {
    try { 
        const success = await audioController.setVolume(id, vol); 
        return { success }; 
    }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('audio:get-volume', async (_, id) => {
    try { 
        const v = await audioController.getVolume(id); 
        return { success: v !== null, volume: v }; 
    }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('audio:set-mute', async (_, id, muted) => {
    try { 
        const success = await audioController.setMute(id, muted); 
        return { success }; 
    }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('audio:get-mute', async (_, id) => {
    try { 
        const m = await audioController.getMute(id); 
        return { success: m !== null, muted: m }; 
    }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('audio:check-availability', async () => {
    try { 
        const available = await audioController.checkSonarAvailability(); 
        return { success: true, available }; 
    }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('audio:get-volume-data', async () => {
    try { 
        const data = await audioController.getVolumeData(); 
        return { success: data !== null, data }; 
    }
    catch (e) { return { success: false, error: e.message }; }
});

// Получить полное состояние для синхронизации
ipcMain.handle('audio:get-full-state', async () => {
    try { 
        const state = await audioController.getFullState(); 
        return { success: state !== null, state }; 
    }
    catch (e) { return { success: false, error: e.message }; }
});

app.whenReady().then(() => {
    // Включить автозапуск по умолчанию при первом запуске
    const settings = loadSettings() || {};
    if (settings.autoLaunchSet === undefined) {
        setAutoLaunch(true);
        settings.autoLaunchSet = true;
        saveSettings(settings);
    }
    
    createWindow();
});

app.on('before-quit', () => {
    isQuitting = true;
    if (windowRecoveryTimer) clearTimeout(windowRecoveryTimer);
    windowRecoveryTimer = null;
});
