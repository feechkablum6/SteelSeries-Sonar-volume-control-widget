# Tech Stack

## Runtime & Framework
- Electron ^28.0.0 — desktop framework
- Node.js (v16+)
- Vanilla JavaScript (ES6+, CommonJS modules)

## Dependencies
- native-sound-mixer ^3.4.6-win — управление Windows Audio API
- koffi ^2.8.0 — FFI для вызова Windows API (user32.dll)
- Material Icons Round — иконки UI

## Frontend
- HTML5, CSS3
- Glassmorphism через `backdrop-filter: blur()`
- Шрифты: Segoe UI, Roboto

## Архитектура Electron
- Main Process (`main.js`) — создание окна, IPC handlers, Windows API
- Renderer Process (`renderer.js`) — UI логика
- Audio Controller (`audio-controller.js`) — интеграция с Sonar
- `nodeIntegration: true`, `contextIsolation: false`

## Команды

```bash
# Установка зависимостей
npm install

# Запуск приложения
npm start
```

## Особенности Windows
- `app.disableHardwareAcceleration()` — фикс прозрачности
- `transparent: true`, `frame: false` — безрамочное окно
- `backgroundColor: '#00000000'` — полная прозрачность
- koffi для EnumWindows, SetWindowPos — умное скрытие виджета
