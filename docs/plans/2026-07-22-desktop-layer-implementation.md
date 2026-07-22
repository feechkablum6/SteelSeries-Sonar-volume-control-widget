# Desktop Layer Widget Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Перевести виджет в интерактивный слой рабочего стола без мерцания и запретить пересечение с ярлыками.

**Architecture:** Чистый модуль геометрии рассчитывает допустимое перемещение и ближайшее свободное место. Win32-модуль на Koffi находит `Progman`/`SysListView32`, встраивает HWND Electron и читает прямоугольники ярлыков; главный и renderer-процессы обмениваются событиями собственного перетаскивания.

**Tech Stack:** Electron 28, Node.js, `node:test`, Koffi, Win32 User32/Kernel32.

---

### Task 1: Геометрия столкновений

**Files:**
- Create: `test/desktop-layout.test.js`
- Create: `desktop-layout.js`
- Modify: `package.json`

**Step 1:** Написать падающие тесты для пересечений, ограничения рабочей областью, движения со скольжением и поиска свободной позиции.

**Step 2:** Запустить `npm test` и убедиться, что тесты падают из-за отсутствующего модуля.

**Step 3:** Реализовать минимальные чистые функции `rectsOverlap`, `moveWithCollisions`, `findNearestFreePosition`.

**Step 4:** Повторно запустить `npm test`; ожидается успешное выполнение всех тестов.

### Task 2: Win32-слой рабочего стола

**Files:**
- Create: `desktop-host.js`
- Modify: `main.js`

**Step 1:** Добавить тестируемую через внедрение зависимостей оболочку состояния рабочего стола.

**Step 2:** Реализовать поиск окна `Progman`, `SHELLDLL_DefView` и `SysListView32`, чтение `LVM_GETITEMRECT`, преобразование координат и освобождение нативной памяти.

**Step 3:** Сохранить окно верхнеуровневым, установить `WS_POPUP`, `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE`, убрать `WS_CHILD`/`WS_EX_APPWINDOW`, назначить `Progman` владельцем через `GWLP_HWNDPARENT` и разместить виджет непосредственно над владельцем в Z-порядке.

**Step 4:** Заменить старый цикл видимости на сторожевую синхронизацию рабочего стола без `hide()`/`show()`.

### Task 3: Управляемое перетаскивание

**Files:**
- Modify: `renderer.js`
- Modify: `styles.css`
- Modify: `main.js`

**Step 1:** Добавить тест поведения координат перетаскивания в главный процесс.

**Step 2:** Удалить `-webkit-app-region: drag`, добавить pointer capture и IPC-события начала, движения и окончания перетаскивания.

**Step 3:** На каждом движении рассчитывать позицию через модуль геометрии и применять её через координаты родительского окна.

**Step 4:** После завершения сохранять подтверждённые экранные координаты.

### Task 4: Проверка приложения

**Files:**
- Modify: `README.md`

**Step 1:** Запустить `npm test`.

**Step 2:** Запустить `npm start` и проверить отсутствие ошибок нативного подключения.

**Step 3:** Проверить HWND: родитель `Progman`, стиль tool/no-activate, отсутствие topmost и процесса в Alt+Tab.

**Step 4:** Проверить Alt+Tab, Win+D, кликабельность слайдеров, столкновения с ярлыками и восстановление после перезапуска Explorer.

**Step 5:** Обновить README фактическим поведением и командами проверки.
