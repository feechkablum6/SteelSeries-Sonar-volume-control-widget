const { app, BrowserWindow, ipcMain, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const audioController = require('./audio-controller')

let mainWindow = null;
const settingsPath = path.join(app.getPath('userData'), 'widget-settings.json');

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

// Windows API через koffi
let user32 = null;
let RECT = null;
let koffi = null;
try {
    koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    
    RECT = koffi.struct('RECT', {
        left: 'int', top: 'int', right: 'int', bottom: 'int'
    });
    
    const WNDENUMPROC = koffi.proto('int WNDENUMPROC(void* hwnd, int64 lParam)');
    
    user32 = {
        GetForegroundWindow: lib.func('GetForegroundWindow', 'void*', []),
        GetClassNameA: lib.func('GetClassNameA', 'int', ['void*', 'char*', 'int']),
        GetWindowRect: lib.func('GetWindowRect', 'int', ['void*', koffi.out(koffi.pointer(RECT))]),
        IsWindowVisible: lib.func('IsWindowVisible', 'int', ['void*']),
        GetWindowLongA: lib.func('GetWindowLongA', 'long', ['void*', 'int']),
        EnumWindows: lib.func('EnumWindows', 'int', [koffi.pointer(WNDENUMPROC), 'int64']),
        SetWindowPos: lib.func('SetWindowPos', 'int', ['void*', 'void*', 'int', 'int', 'int', 'int', 'uint'])
    };
} catch (e) {}

app.disableHardwareAcceleration()

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {}
    return null;
}

function saveSettings(settings) {
    try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); } catch (e) {}
}

function getDisplayForRect(rect) {
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    for (const d of screen.getAllDisplays()) {
        const b = d.bounds;
        if (cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height) return d;
    }
    return screen.getPrimaryDisplay();
}

function rectsOverlap(r1, r2) {
    return !(r1.right <= r2.left || r1.left >= r2.right || r1.bottom <= r2.top || r1.top >= r2.bottom);
}

const IGNORE_CLASSES = [
    'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd',
    'NotifyIconOverflowWindow', 'Windows.UI.Core.CoreWindow',
    'Xaml_WindowedPopupClass', 'PopupHost', 'TaskListThumbnailWnd',
    'MSTaskSwWClass', 'MSTaskListWClass', 'ToolbarWindow32',
    'TrayNotifyWnd', 'SysPager', 'ReBarWindow32', 'Button',
    'tooltips_class32', 'SysShadow', '#32768', 'TaskManagerWindow',
    'CROSVM_1', 'CROSVM_0' // WSL/Android subsystem
];

// Нормальная позиция виджета (для проверки когда он скрыт)
let widgetNormalPosition = null;

// Проверяет, перекрыто ли окно виджета любым окном на том же мониторе
function isWidgetAreaCovered() {
    if (!user32 || !mainWindow || mainWindow.isDestroyed()) return false;
    
    // Используем сохранённую позицию, если окно скрыто
    const wb = mainWindow.isVisible() ? mainWindow.getBounds() : 
        (widgetNormalPosition ? { x: widgetNormalPosition.x, y: widgetNormalPosition.y, width: 450, height: 300 } : mainWindow.getBounds());
    const widgetRect = { left: wb.x, top: wb.y, right: wb.x + wb.width, bottom: wb.y + wb.height };
    const widgetDisplay = getDisplayForRect(widgetRect);
    
    let ourHwndNum = 0;
    try { ourHwndNum = mainWindow.getNativeWindowHandle().readUInt32LE(0); } catch (e) {}
    
    let isCovered = false;
    const GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
    
    try {
        // Перебираем все окна в Z-order (сверху вниз)
        user32.EnumWindows((hwnd) => {
            if (isCovered) return 1; // Уже нашли перекрывающее окно
            
            try {
                let hwndNum = typeof hwnd === 'number' ? hwnd : (hwnd?.address !== undefined ? Number(hwnd.address) : 0);
                
                // Пропускаем наше окно
                if (hwndNum === ourHwndNum) return 1;
                
                // Пропускаем невидимые окна
                if (!user32.IsWindowVisible(hwnd)) return 1;
                
                // Проверяем класс окна
                const buf = Buffer.alloc(256);
                user32.GetClassNameA(hwnd, buf, 256);
                const className = buf.toString('utf8').split('\0')[0];
                
                // Пропускаем системные окна
                if (IGNORE_CLASSES.includes(className)) return 1;
                
                // Пропускаем WPF служебные окна
                if (className.startsWith('HwndWrapper[')) return 1;
                
                // Пропускаем tool windows (без кнопки на панели задач)
                const exStyle = user32.GetWindowLongA(hwnd, GWL_EXSTYLE);
                if ((exStyle & WS_EX_TOOLWINDOW) && !(exStyle & WS_EX_APPWINDOW)) return 1;
                
                // Получаем размеры окна
                const rect = {};
                if (!user32.GetWindowRect(hwnd, rect)) return 1;
                
                // Пропускаем слишком маленькие окна
                if ((rect.right - rect.left) < 100 || (rect.bottom - rect.top) < 100) return 1;
                
                // Пропускаем Chrome/Electron popup окна (tooltips, dropdowns и т.д.)
                // Основные окна браузера обычно больше 500x400
                if (className === 'Chrome_WidgetWin_1' || className === 'Chrome_WidgetWin_0') {
                    if ((rect.right - rect.left) < 500 || (rect.bottom - rect.top) < 400) return 1;
                }
                
                // Пропускаем окна на других мониторах
                const windowDisplay = getDisplayForRect(rect);
                if (windowDisplay.id !== widgetDisplay.id) return 1;
                
                // Проверяем перекрытие
                if (rectsOverlap(rect, widgetRect)) {
                    isCovered = true;
                }
            } catch (e) {}
            return 1;
        }, 0);
    } catch (e) {}
    
    return isCovered;
}

function shouldWidgetBeVisible() {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return !isWidgetAreaCovered();
}

function createWindow() {
    const settings = loadSettings();
    const opts = {
        width: 450, height: 300, frame: false, transparent: true,
        backgroundColor: '#00000000', hasShadow: false, resizable: false,
        skipTaskbar: true, alwaysOnTop: true, show: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    };
    if (settings?.x !== undefined) { opts.x = settings.x; opts.y = settings.y; }
    
    mainWindow = new BrowserWindow(opts);
    mainWindow.loadFile('index.html');
    
    // Отключить анимацию окна через Windows API
    if (user32) {
        try {
            const hwnd = mainWindow.getNativeWindowHandle();
            const GWL_EXSTYLE = -20;
            const WS_EX_NOACTIVATE = 0x08000000;
            const currentStyle = user32.GetWindowLongA(hwnd, GWL_EXSTYLE);
            // Добавляем WS_EX_NOACTIVATE чтобы окно не активировалось
            if (koffi) {
                const lib = koffi.load('user32.dll');
                const SetWindowLongA = lib.func('SetWindowLongA', 'long', ['void*', 'int', 'long']);
                SetWindowLongA(hwnd, GWL_EXSTYLE, currentStyle | WS_EX_NOACTIVATE);
            }
        } catch (e) {}
    }
    
    let currentVisible = true; // Окно показывается сразу (show: true)
    
    // Сохранить начальную позицию (проверить что она на видимом мониторе)
    const initBounds = mainWindow.getBounds();
    const primaryDisplay = screen.getPrimaryDisplay();
    const pb = primaryDisplay.bounds;
    
    // Если позиция за пределами основного монитора — сбросить в центр
    if (initBounds.x < pb.x || initBounds.x > pb.x + pb.width - 100 ||
        initBounds.y < pb.y || initBounds.y > pb.y + pb.height - 100) {
        const centerX = pb.x + Math.round((pb.width - initBounds.width) / 2);
        const centerY = pb.y + Math.round((pb.height - initBounds.height) / 2);
        mainWindow.setPosition(centerX, centerY);
        widgetNormalPosition = { x: centerX, y: centerY };
        console.log(`Reset position to center: ${centerX}, ${centerY}`);
    } else {
        widgetNormalPosition = { x: initBounds.x, y: initBounds.y };
    }
    
    const CHECK_INTERVAL = 50;
    const STABILITY_THRESHOLD = 5; // Сколько проверок подряд нужно для смены состояния
    
    let stableCount = 0;      // Счётчик стабильных проверок
    let lastState = null;     // Последнее состояние (true = показать, false = скрыть)
    
    // Автоскрытие при перекрытии окнами (с задержкой старта)
    setTimeout(() => {
        setInterval(() => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            
            const shouldShow = shouldWidgetBeVisible();
            
            // Если состояние изменилось — сбрасываем счётчик
            if (shouldShow !== lastState) {
                lastState = shouldShow;
                stableCount = 1;
                return;
            }
            
            // Состояние стабильно — увеличиваем счётчик
            stableCount++;
            
            // Применяем изменение только после достижения порога стабильности
            if (stableCount === STABILITY_THRESHOLD) {
                if (shouldShow && !currentVisible) {
                    currentVisible = true;
                    mainWindow.showInactive();
                } else if (!shouldShow && currentVisible) {
                    currentVisible = false;
                    mainWindow.hide();
                }
            }
        }, CHECK_INTERVAL);
    }, 1000); // Задержка 1 сек перед включением автоскрытия
    
    // Обновлять нормальную позицию при перемещении (только когда видим)
    mainWindow.on('moved', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const b = mainWindow.getBounds();
            if (b.x > -5000) {
                widgetNormalPosition = { x: b.x, y: b.y };
                saveSettings({ x: b.x, y: b.y });
            }
        }
    });
    
    // Восстановить после Win+D (minimize)
    mainWindow.on('restore', () => {
        currentVisible = true;
    });
    
    mainWindow.on('show', () => {
        currentVisible = true;
    });
}

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

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
