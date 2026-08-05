const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('does not render static equalizer preset pills', () => {
    const projectRoot = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');

    assert.doesNotMatch(html, /preset-pill/);
    assert.doesNotMatch(css, /\.preset-pill/);
});

test('opens the device list without a heading and with a fade-in', () => {
    const projectRoot = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');
    const renderer = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');

    assert.doesNotMatch(html, /device-picker-title/);
    assert.doesNotMatch(renderer, /device-picker-title/);
    assert.doesNotMatch(
        css,
        /\.device-picker\s*\{[^}]*display:\s*none/,
        'a hidden picker must stay in the layout so the reveal can animate'
    );
    assert.match(css, /\.device-picker\s*\{[^}]*transition:/);
    assert.match(css, /prefers-reduced-motion/);
});

test('shows device names without leading link icons', () => {
    const projectRoot = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');

    assert.doesNotMatch(html, /small-icon/);
    assert.doesNotMatch(css, /\.device-info \.small-icon/);
});
