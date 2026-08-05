const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('path')
const { screen, powerMonitor } = require('electron')
const fs = require('fs')
const koffi = require('koffi')
const audioController = require('./audio-controller')
const { DesktopHost, createWindowsDesktopNative } = require('./desktop-host')
const { beginDrag, dragTarget } = require('./drag-position')
const {
    GlobalInputMonitor,
    createWindowsGlobalInputNative
} = require('./global-input-monitor')
const {
    createAutoLaunchController,
    createWidgetMenuTemplate
} = require('./widget-actions')

let mainWindow = null;
let desktopHost = null;
let desktopNative = null;
let desktopRefreshTimer = null;
let windowRecoveryTimer = null;
let dragSession = null;
let globalInputMonitor = null;
let autoLaunchController = null;
let desktopRefreshPromise = null;
let isQuitting = false;
const settingsPath = path.join(app.getPath('userData'), 'widget-settings.json');
const WIDGET_SIZE = { width: 450, height: 300 };
const DESKTOP_REFRESH_INTERVAL = 1500;
const WINDOW_RECOVERY_DELAY = 1500;
const ICON_GAP = 6;

app.disableHardwareAcceleration()

// Виджет лежит в слое рабочего стола и почти всегда перекрыт другими окнами.
// Без этих ключей Chromium считает его скрытым: таймеры синхронизации
// замедляются до одного срабатывания в минуту, а requestAnimationFrame,
// на котором держится перетаскивание, останавливается совсем.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

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

async function connectToDesktop() {
    const window = mainWindow;
    const host = desktopHost;
    const native = desktopNative;
    if (!window || window.isDestroyed() || !host || !native) return false;

    const settings = loadSettings() || {};
    const desktop = native.findDesktop();
    if (!desktop) return false;

    const desiredPosition = {
        x: Number.isFinite(settings.x)
            ? settings.x
            : desktop.bounds.x + Math.round((desktop.bounds.width - WIDGET_SIZE.width) / 2),
        y: Number.isFinite(settings.y)
            ? settings.y
            : desktop.bounds.y + Math.round((desktop.bounds.height - WIDGET_SIZE.height) / 2)
    };

    const connected = await host.connect(
        window.getNativeWindowHandle(),
        desiredPosition,
        WIDGET_SIZE
    );
    if (!connected) {
        if (!window.isDestroyed()) window.hide();
        return false;
    }
    if (window !== mainWindow || host !== desktopHost || window.isDestroyed()) return false;

    window.showInactive();
    const position = host.getPosition();
    console.log(`Desktop host initialized: position=${position.x},${position.y}`);
    saveSettings(position);
    return true;
}

function requestIconRescan() {
    desktopHost?.requestIconRescan();
}

function refreshDesktop() {
    if (desktopRefreshPromise) return desktopRefreshPromise;
    if (!desktopHost || dragSession) return Promise.resolve(false);

    const host = desktopHost;

    desktopRefreshPromise = (async () => {
        const before = host.getPosition();
        if (!before) return connectToDesktop();

        // Неудачный снимок не повторяется немедленно: занятый Explorer иначе
        // получал бы новый обход каждые полторы секунды. Привязка виджета при
        // этом продолжает проверяться, а снимок повторится по расписанию хоста.
        if (!await host.refresh()) return false;
        if (host !== desktopHost) return false;

        const after = host.getPosition();
        if (after && (after.x !== before.x || after.y !== before.y)) {
            saveSettings(after);
        }
        return true;
    })().finally(() => {
        desktopRefreshPromise = null;
    });
    return desktopRefreshPromise;
}

function createWindow() {
    if (mainWindow || isQuitting) return;
    // Нативный адаптер переживает пересоздание окна: повторный koffi.load
    // регистрировал бы весь набор функций user32/kernel32 заново.
    if (!desktopNative) {
        desktopNative = createWindowsDesktopNative(koffi, {
            getDisplays: () => screen.getAllDisplays()
        });
    }
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
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false
        }
    });
    globalInputMonitor = new GlobalInputMonitor(
        createWindowsGlobalInputNative(koffi),
        {
            ownerProcessId: process.pid,
            onDismiss: reason => {
                if (!mainWindow || mainWindow.isDestroyed()) return;
                mainWindow.webContents.send('device-picker:dismiss', reason);
            }
        }
    );

    mainWindow.webContents.on('context-menu', event => {
        event.preventDefault();
        if (!autoLaunchController || !mainWindow || mainWindow.isDestroyed()) return;

        mainWindow.webContents.send('device-picker:dismiss', 'context-menu');
        globalInputMonitor?.stop();
        const menu = Menu.buildFromTemplate(createWidgetMenuTemplate({
            autoLaunch: autoLaunchController,
            quit: () => app.quit()
        }));
        menu.popup({ window: mainWindow });
    });

    mainWindow.webContents.once('did-finish-load', async () => {
        const loadedWindow = mainWindow;
        if (!await connectToDesktop()) {
            console.error('Desktop host is not available; waiting for Explorer');
        }
        if (
            loadedWindow !== mainWindow ||
            !loadedWindow ||
            loadedWindow.isDestroyed()
        ) {
            return;
        }
        desktopRefreshTimer = setInterval(
            () => void refreshDesktop(),
            DESKTOP_REFRESH_INTERVAL
        );
    });

    mainWindow.on('closed', () => {
        globalInputMonitor?.stop();
        globalInputMonitor = null;
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

ipcMain.on('device-picker:opened', event => {
    if (event.sender !== mainWindow?.webContents) return;
    globalInputMonitor?.start();
});

ipcMain.on('device-picker:closed', event => {
    if (event.sender !== mainWindow?.webContents) return;
    globalInputMonitor?.stop();
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

ipcMain.handle('audio:set-device', async (_, channelId, deviceId) => {
    try {
        const success = await audioController.setClassicRedirection(channelId, deviceId);
        return { success };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Получить полное состояние для синхронизации
ipcMain.handle('audio:get-full-state', async () => {
    try { 
        const state = await audioController.getFullState(); 
        return { success: state !== null, state }; 
    }
    catch (e) { return { success: false, error: e.message }; }
});

// Добавление и удаление ярлыков хост замечает сам по числу значков. Здесь
// остаются поводы, при которых Explorer переставляет значки, не меняя их
// количества: смена конфигурации экранов и возвращение из сна.
function watchDesktopChanges() {
    screen.on('display-added', requestIconRescan);
    screen.on('display-removed', requestIconRescan);
    screen.on('display-metrics-changed', requestIconRescan);
    powerMonitor.on('resume', requestIconRescan);
    powerMonitor.on('unlock-screen', requestIconRescan);
}

app.whenReady().then(() => {
    autoLaunchController = createAutoLaunchController(app);
    watchDesktopChanges();
    // Включить автозапуск по умолчанию при первом запуске
    const settings = loadSettings() || {};
    if (settings.autoLaunchSet === undefined) {
        autoLaunchController.setEnabled(true);
        settings.autoLaunchSet = true;
        saveSettings(settings);
    }
    
    createWindow();
});

app.on('before-quit', () => {
    isQuitting = true;
    globalInputMonitor?.stop();
    if (desktopRefreshTimer) clearInterval(desktopRefreshTimer);
    desktopRefreshTimer = null;
    if (windowRecoveryTimer) clearTimeout(windowRecoveryTimer);
    windowRecoveryTimer = null;
});
