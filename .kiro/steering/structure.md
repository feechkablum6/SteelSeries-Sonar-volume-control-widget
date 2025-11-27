# Project Structure

```
StellGG/
├── main.js              # Electron Main Process
│                        # - Создание BrowserWindow
│                        # - IPC handlers для audio API
│                        # - Windows API через koffi (скрытие/показ)
│                        # - Сохранение позиции окна
│
├── renderer.js          # Electron Renderer Process
│                        # - UI интерактивность
│                        # - Обработка слайдеров и mute
│                        # - IPC вызовы к main process
│
├── audio-controller.js  # Модуль управления аудио
│                        # - Интеграция с native-sound-mixer
│                        # - Маппинг каналов на устройства Sonar
│                        # - DEVICE_MAPPING для 6 каналов
│
├── index.html           # UI разметка
│                        # - 6 каналов управления
│                        # - Drag-region для перемещения
│
├── styles.css           # Стили и glassmorphism
│                        # - backdrop-filter blur
│                        # - Вертикальные слайдеры (rotate -90deg)
│                        # - Цветовые темы каналов (preset-pill)
│
├── package.json         # npm конфигурация
├── Changelog.md         # История изменений (обязательно обновлять!)
└── README.md            # Краткое описание
```

## Соглашения
- Flat структура — все файлы в корне
- Changelog.md — обновлять при каждом изменении
- Русский язык для UI текста
- CommonJS модули (require/module.exports)
- IPC для связи main ↔ renderer
