# Device Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Превратить подписи устройств в интерактивные переключатели реальных маршрутов SteelSeries Sonar.

**Architecture:** Главный процесс остаётся единственной точкой доступа к локальному API Sonar. Чистый модуль формирует доступные варианты и выбранные назначения, `audio-controller.js` читает и меняет redirection, IPC связывает это с renderer, а renderer отображает компактное меню выбора.

**Tech Stack:** Electron 28, CommonJS, Node.js `http`, встроенный `node:test`, HTML/CSS/JavaScript.

---

### Task 1: Чистая модель маршрутизации

**Files:**
- Create: `device-routing.js`
- Create: `test/device-routing.test.js`

**Steps:**
1. Написать падающие тесты фильтрации физических `render`/`capture` устройств и сопоставления назначений.
2. Запустить `npm test` и подтвердить ожидаемое падение из-за отсутствующего модуля.
3. Реализовать минимальные чистые функции.
4. Запустить тесты и подтвердить прохождение.

### Task 2: API Sonar и IPC

**Files:**
- Modify: `audio-controller.js`
- Modify: `main.js`
- Modify: `package.json`
- Test: `test/audio-controller-routing.test.js`

**Steps:**
1. Написать падающие тесты чтения `/classicRedirections` и PUT-пути переключения.
2. Добавить внедрение HTTP-функции для теста без обращения к реальному Sonar.
3. Расширить полную синхронизацию назначениями и добавить `setClassicRedirection`.
4. Добавить IPC `set-audio-device` и включить новый модуль в сборку.
5. Запустить все тесты.

### Task 3: Меню выбора в интерфейсе

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `renderer.js`

**Steps:**
1. Добавить единственное переиспользуемое меню устройств.
2. Обновлять реальные подписи из модели маршрутизации.
3. Открывать меню кликом, закрывать по Escape/внешнему клику, блокировать начало drag из интерактивной области.
4. Применять выбор через IPC и синхронизировать состояние после ответа.

### Task 4: Проверка на живом Sonar

**Files:**
- Modify if needed: `README.md`

**Steps:**
1. Запустить все автотесты.
2. Собрать приложение с артефактами в `E:\DevCaches`.
3. Перезапустить виджет из текущего исходного кода.
4. Выполнить обратимую проверку: переключить один канал, подтвердить GET `/classicRedirections`, вернуть исходное устройство.
5. Проверить видимость, кликабельность и отсутствие регрессии перетаскивания.
