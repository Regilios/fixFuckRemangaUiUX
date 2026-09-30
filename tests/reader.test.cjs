const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const script = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/reader.js'), 'utf8');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/reader.html'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 45));

async function createReader(t, { width = 390, pathname = '/manga/example/123', native = true } = {}) {
    const messages = [];
    const mediaListeners = [];
    const dom = new JSDOM(fixture, {
        url: 'https://remanga.org' + pathname,
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    const { document } = window;
    const observers = [];
    const MutationObserver = window.MutationObserver;
    window.MutationObserver = class extends MutationObserver {
        constructor(callback) {
            super(callback);
            observers.push(this);
        }
    };
    t.after(() => {
        observers.forEach(observer => observer.disconnect());
        window.close();
    });
    const media = { matches: width < 768, addEventListener: (_, listener) => mediaListeners.push(listener) };
    window.matchMedia = () => media;
    if (native) window.RemangaNative = { postMessage: value => messages.push(JSON.parse(value)) };
    window.innerWidth = width;
    let counterWidth = 176;
    const row = document.querySelector('.no-wrap > .flex.flex-nowrap');
    row.style.columnGap = '4px';
    row.style.paddingInline = '8px';
    Object.defineProperty(row, 'clientWidth', { get: () => window.innerWidth });
    Object.defineProperty(row.parentElement, 'offsetHeight', { value: 56 });
    for (const child of row.children) {
        Object.defineProperty(child, 'offsetWidth', {
            get: () => child.matches('button') ? 40 : counterWidth
        });
        Object.defineProperty(child, 'offsetHeight', { value: 40 });
    }
    window.HTMLElement.prototype.getClientRects = function () {
        return this.hidden || this.style.display === 'none' ? [] : [{ width: 390, height: 56 }];
    };
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000 });
    window.innerHeight = 844;
    window.eval(script);
    await tick();

    return {
        window, document, messages,
        hidden: () => document.documentElement.getAttribute('data-rfx-hidden') === 'true',
        scroll: async y => {
            window.scrollY = y;
            window.dispatchEvent(new window.Event('scroll'));
            await tick();
        },
        resize: async nextWidth => {
            window.innerWidth = nextWidth;
            media.matches = nextWidth < 768;
            mediaListeners.forEach(listener => listener());
            window.dispatchEvent(new window.Event('resize'));
            await tick();
        },
        widenCounters: async value => {
            counterWidth = value;
            row.querySelector('.counters button').textContent = String(value);
            await tick();
        }
    };
}

test('patches only the two mobile chapter panels and appends one accessible button', async t => {
    const reader = await createReader(t);
    assert.equal(reader.document.querySelectorAll('[data-rfx-panel]').length, 2);
    assert.equal(reader.document.querySelectorAll('#rfx-fullscreen').length, 1);
    assert.equal(reader.document.querySelector('.fresnel-greaterThanOrEqual-md [data-rfx-panel]'), null);
    const button = reader.document.querySelector('#rfx-fullscreen');
    assert.equal(button.parentElement.classList.contains('flex-nowrap'), true);
    assert.equal(button.getAttribute('aria-label'), 'На весь экран');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
});

test('hides down, ignores a small reversal, and reveals after accumulated upward movement', async t => {
    const reader = await createReader(t);
    await reader.scroll(200);
    assert.equal(reader.hidden(), true);
    assert.equal(reader.document.querySelector('[data-rfx-panel]').inert, true);
    await reader.scroll(197);
    assert.equal(reader.hidden(), true);
    await reader.scroll(186);
    assert.equal(reader.hidden(), false);
    assert.equal(reader.document.querySelector('[data-rfx-panel]').inert, false);
    await reader.scroll(191);
    assert.equal(reader.hidden(), false);
    await reader.scroll(211);
    assert.equal(reader.hidden(), true);
});

function pointerEvent(window, target, type, { x = 100, y = 300, id = 1, primary = true } = {}) {
    const event = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, {
        pointerId: { value: id }, isPrimary: { value: primary }
    });
    target.dispatchEvent(event);
}

function shortTap(reader, target = reader.document.querySelector('main p')) {
    pointerEvent(reader.window, target, 'pointerdown');
    pointerEvent(reader.window, target, 'pointerup');
    target.dispatchEvent(new reader.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
}

test('short content taps toggle panels without scrolling or toggling fullscreen', async t => {
    const reader = await createReader(t);
    let scrollCalls = 0;
    reader.window.scrollTo = () => scrollCalls++;
    shortTap(reader);
    assert.equal(reader.hidden(), true);
    shortTap(reader);
    assert.equal(reader.hidden(), false);
    assert.equal(reader.window.scrollY, 0);
    assert.equal(scrollCalls, 0);
    assert.equal(reader.messages.filter(message => message.type === 'toggleFullscreen').length, 0);
});

test('tap handling leaves links, site buttons, long presses and movement alone', async t => {
    const reader = await createReader(t);
    shortTap(reader, reader.document.querySelector('.counters button'));
    assert.equal(reader.hidden(), false);
    const target = reader.document.querySelector('main p');
    pointerEvent(reader.window, target, 'pointerdown');
    pointerEvent(reader.window, target, 'pointermove', { y: 320 });
    pointerEvent(reader.window, target, 'pointerup');
    target.dispatchEvent(new reader.window.MouseEvent('click', { bubbles: true, detail: 1 }));
    assert.equal(reader.hidden(), false);
    pointerEvent(reader.window, target, 'pointerdown');
    await new Promise(resolve => setTimeout(resolve, 300));
    pointerEvent(reader.window, target, 'pointerup');
    target.dispatchEvent(new reader.window.MouseEvent('click', { bubbles: true, detail: 1 }));
    assert.equal(reader.hidden(), false);
    pointerEvent(reader.window, target, 'pointerdown');
    pointerEvent(reader.window, target, 'pointerdown', { id: 2, primary: false });
    pointerEvent(reader.window, target, 'pointerup');
    target.dispatchEvent(new reader.window.MouseEvent('click', { bubbles: true, detail: 1 }));
    assert.equal(reader.hidden(), false);
});

test('uses the existing row when it fits, otherwise floats above it without wrapping', async t => {
    const reader = await createReader(t);
    const button = reader.document.querySelector('#rfx-fullscreen');
    assert.equal(button.dataset.rfxPlacement, 'inline');
    assert.equal(button.style.getPropertyValue('--rfx-button-size'), '40px');
    await reader.resize(320);
    assert.equal(button.dataset.rfxPlacement, 'floating');
    assert.equal(button.parentElement.dataset.rfxPanel, 'bottom');
    assert.equal(button.style.getPropertyValue('--rfx-button-size'), '56px');
    assert.equal(button.style.getPropertyValue('--rfx-bar-height'), '56px');
    await reader.resize(390);
    assert.equal(button.dataset.rfxPlacement, 'inline');
    await reader.widenCounters(220);
    assert.equal(button.dataset.rfxPlacement, 'floating');
    assert.equal(reader.document.querySelectorAll('#rfx-fullscreen').length, 1);
    assert.equal(reader.document.querySelector('[data-rfx-controls]'), null);
});

test('a height-only resize or background DOM update does not reveal hidden panels', async t => {
    const reader = await createReader(t);
    await reader.scroll(200);
    reader.window.innerHeight = 800;
    reader.window.dispatchEvent(new reader.window.Event('resize'));
    const status = reader.document.createElement('span');
    status.textContent = 'Loaded';
    reader.document.querySelector('main').append(status);
    await tick();
    assert.equal(reader.hidden(), true);
    assert.equal(reader.window.scrollY, 200);
    await tick();
    assert.equal(reader.hidden(), true);
});

test('browser fullscreen requests hidden navigation and waits for actual fullscreen state', async t => {
    const reader = await createReader(t, { native: false });
    let options;
    reader.document.documentElement.requestFullscreen = async value => { options = value; };
    const button = reader.document.querySelector('#rfx-fullscreen');
    button.click();
    assert.equal(options.navigationUI, 'hide');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    Object.defineProperty(reader.document, 'fullscreenElement', { value: reader.document.documentElement });
    reader.document.dispatchEvent(new reader.window.Event('fullscreenchange'));
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    await reader.scroll(200);
    assert.equal(reader.hidden(), true);
    shortTap(reader);
    assert.equal(reader.hidden(), false);
});

test('shows navigation at both page boundaries including overscroll', async t => {
    const reader = await createReader(t);
    await reader.scroll(200);
    await reader.scroll(7000);
    assert.equal(reader.hidden(), false);
    await reader.scroll(-30);
    assert.equal(reader.hidden(), false);
});

test('open menus, dialogs and comment input keep controls available', async t => {
    const reader = await createReader(t);
    const menuButton = reader.document.querySelector('[aria-expanded]');
    menuButton.setAttribute('aria-expanded', 'true');
    await reader.scroll(200);
    assert.equal(reader.hidden(), false);
    menuButton.setAttribute('aria-expanded', 'false');
    await reader.scroll(300);
    assert.equal(reader.hidden(), true);
    const dialog = reader.document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    reader.document.body.append(dialog);
    await tick();
    assert.equal(reader.hidden(), false);
    dialog.remove();
    const input = reader.document.createElement('textarea');
    reader.document.body.append(input);
    input.focus();
    await reader.scroll(500);
    assert.equal(reader.hidden(), false);
});

test('nested comment scrolling does not hide the reader panels', async t => {
    const reader = await createReader(t);
    reader.window.scrollY = 200;
    reader.document.querySelector('main').dispatchEvent(new reader.window.Event('scroll'));
    await tick();
    assert.equal(reader.hidden(), false);
});

test('restores controls after the site replaces its mobile DOM', async t => {
    const reader = await createReader(t);
    await reader.scroll(200);
    const oldContainer = reader.document.querySelector('.fresnel-lessThan-md');
    const replacement = oldContainer.cloneNode(true);
    replacement.querySelector('#rfx-fullscreen').remove();
    oldContainer.replaceWith(replacement);
    await tick();
    assert.equal(reader.document.querySelectorAll('#rfx-fullscreen').length, 1);
    assert.equal(reader.hidden(), false);
    assert.equal(oldContainer.querySelector('[data-rfx-panel]'), null);
});

test('removes modifications when leaving a chapter and reapplies them on return', async t => {
    const reader = await createReader(t);
    await reader.scroll(200);
    reader.window.history.pushState({}, '', '/manga/example/main');
    reader.window.RemangaReaderFix.refresh();
    await tick();
    assert.equal(reader.document.querySelector('[data-rfx-panel]'), null);
    assert.equal(reader.document.querySelector('#rfx-fullscreen'), null);
    reader.window.history.pushState({}, '', '/manga/example/456');
    reader.window.RemangaReaderFix.refresh();
    await tick();
    assert.equal(reader.document.querySelectorAll('#rfx-fullscreen').length, 1);
});

test('native fullscreen uses confirmed state and query updates do not reveal hidden controls', async t => {
    const reader = await createReader(t);
    reader.document.querySelector('#rfx-fullscreen').click();
    assert.deepEqual(reader.messages.at(-1), { type: 'toggleFullscreen' });
    assert.equal(reader.document.querySelector('#rfx-fullscreen').getAttribute('aria-pressed'), 'false');
    reader.window.RemangaNative.onmessage({ data: '{"fullscreen":true}' });
    assert.equal(reader.document.querySelector('#rfx-fullscreen').getAttribute('aria-pressed'), 'true');
    await reader.scroll(200);
    reader.window.history.replaceState({}, '', '?page=2');
    reader.window.RemangaReaderFix.refresh();
    reader.window.RemangaReaderFix.setFullscreen(true);
    await tick();
    assert.equal(reader.hidden(), true);
    await reader.scroll(180);
    assert.equal(reader.hidden(), false);
    reader.window.RemangaReaderFix.setFullscreen(false);
    assert.equal(reader.document.querySelector('#rfx-fullscreen').getAttribute('aria-label'), 'На весь экран');
});

test('reinjection is idempotent and does not register duplicate native click handlers', async t => {
    const reader = await createReader(t);
    reader.window.eval(script);
    reader.window.eval(script);
    await tick();
    assert.equal(reader.document.querySelectorAll('#rfx-styles').length, 1);
    assert.equal(reader.document.querySelectorAll('#rfx-fullscreen').length, 1);
    reader.document.querySelector('#rfx-fullscreen').click();
    assert.equal(reader.messages.filter(message => message.type === 'toggleFullscreen').length, 1);
});

test('desktop layout stays unchanged and mobile controls recover after resizing', async t => {
    const reader = await createReader(t, { width: 1024 });
    assert.equal(reader.document.querySelector('[data-rfx-panel]'), null);
    await reader.resize(390);
    assert.equal(reader.document.querySelectorAll('[data-rfx-panel]').length, 2);
    await reader.resize(900);
    assert.equal(reader.document.querySelector('#rfx-fullscreen'), null);
    await reader.resize(320);
    assert.equal(reader.document.querySelectorAll('#rfx-fullscreen').length, 1);
});
