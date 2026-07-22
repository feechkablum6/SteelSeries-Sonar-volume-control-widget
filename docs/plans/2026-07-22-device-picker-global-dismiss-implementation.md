# Device Picker Global Dismiss Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Закрывать список устройств по клику вне виджета и по Escape, не активируя окно.

**Architecture:** Тестируемый `GlobalInputMonitor` управляет жизненным циклом подписок и решает, когда закрывать меню. Windows-адаптер на Koffi устанавливает временные `WH_MOUSE_LL`/`WH_KEYBOARD_LL`, а IPC включает монитор только на время открытого списка.

**Tech Stack:** Electron 28, CommonJS, Koffi, Windows User32, `node:test`.

---

### Task 1: Политика и жизненный цикл монитора

**Files:**
- Create: `global-input-monitor.js`
- Create: `test/global-input-monitor.test.js`

**Steps:**
1. Написать тесты внешнего/внутреннего клика, Escape, другой клавиши и очистки.
2. Запустить тест и подтвердить падение из-за отсутствующего модуля.
3. Реализовать минимальный монитор с внедряемым native-адаптером.
4. Запустить тесты и подтвердить прохождение.

### Task 2: Windows-хуки и IPC

**Files:**
- Modify: `global-input-monitor.js`
- Modify: `main.js`
- Modify: `renderer.js`
- Modify: `package.json`

**Steps:**
1. Реализовать Koffi-адаптер User32 с обязательным `CallNextHookEx`.
2. Добавить IPC открытия/закрытия списка и команду глобального закрытия.
3. Освобождать хуки при закрытии окна и выходе приложения.
4. Добавить файл в список сборки.

### Task 3: Проверка

**Steps:**
1. Запустить `npm test` и синтаксическую проверку.
2. Перезапустить виджет.
3. Проверить внешний клик и Escape на живом окне.
4. Собрать `win-unpacked` в `E:\DevCaches`.
