(() => {
    'use strict';

    if (window.top !== window) return;
    if (window.RemangaReaderFix) {
        window.RemangaReaderFix.refresh();
        return;
    }

    const PANEL_SELECTOR = '.fresnel-container.fresnel-lessThan-md';
    const CHAPTER_PATH = /^\/manga\/[^/]+\/\d+\/?$/;
    const mobileViewport = window.matchMedia('(max-width: 767px)');
    const panels = new Map();
    let button = null;
    let controls = null;
    let hidden = false;
    let fullscreen = false;
    let previousY = window.scrollY;
    let direction = 0;
    let distance = 0;
    let scrollFrame = 0;
    let refreshFrame = 0;
    let lastPath = location.pathname;
    let viewportWidth = window.innerWidth;
    let layoutObserver = null;
    let pointer = null;
    let pendingTap = null;

    const styles = `
        [data-rfx-panel] {
            transform: translate3d(0, 0, 0) !important;
            opacity: 1 !important;
            visibility: visible !important;
            z-index: 999 !important;
            transition: transform 320ms cubic-bezier(.22,.61,.36,1), opacity 260ms ease, visibility 0s !important;
            will-change: transform;
            overflow-anchor: none;
        }
        [data-rfx-panel="top"] { z-index: 1000 !important; }
        [data-rfx-hidden="true"] [data-rfx-panel] {
            opacity: 0 !important;
            pointer-events: none !important;
            visibility: hidden !important;
            transition: transform 320ms cubic-bezier(.22,.61,.36,1), opacity 260ms ease, visibility 0s 320ms !important;
        }
        [data-rfx-hidden="true"] [data-rfx-panel="top"] {
            transform: translate3d(0, calc(-100% - 16px), 0) !important;
        }
        [data-rfx-hidden="true"] [data-rfx-panel="bottom"] {
            transform: translate3d(0, calc(100% + 80px), 0) !important;
        }
        #rfx-fullscreen {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            flex: 0 0 var(--rfx-button-size, 40px);
            width: var(--rfx-button-size, 40px);
            height: var(--rfx-button-size, 40px);
            min-width: var(--rfx-button-size, 40px);
            min-height: 0;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: var(--secondary, #303038);
            color: inherit;
            cursor: pointer;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
        }
        #rfx-fullscreen[data-rfx-placement="floating"] {
            position: absolute;
            right: max(8px, env(safe-area-inset-right));
            bottom: calc(var(--rfx-bar-height, 56px) + env(safe-area-inset-bottom) + 8px);
            box-shadow: 0 2px 8px #0005;
        }
        #rfx-fullscreen:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
        #rfx-fullscreen[aria-pressed="true"] { box-shadow: inset 0 0 0 1px currentColor; }
        #rfx-fullscreen svg { width: 22px; height: 22px; pointer-events: none; }
        @media (prefers-reduced-motion: reduce) {
            [data-rfx-panel], [data-rfx-hidden="true"] [data-rfx-panel] {
                transition: none !important;
            }
        }
    `;

    function resetScroll() {
        previousY = Math.max(0, window.scrollY);
        direction = 0;
        distance = 0;
    }

    function setHidden(value) {
        hidden = value;
        const attribute = String(value);
        if (document.documentElement.getAttribute('data-rfx-hidden') !== attribute) {
            document.documentElement.setAttribute('data-rfx-hidden', attribute);
        }
        for (const [panel, originalInert] of panels) {
            const nextInert = value || originalInert;
            if (panel.inert !== nextInert) panel.inert = nextInert;
        }
    }

    function isVisible(element) {
        return element.getClientRects().length > 0
            && getComputedStyle(element).visibility !== 'hidden';
    }

    function interactionIsOpen() {
        const focused = document.activeElement;
        if (focused && focused.matches('input, textarea, select, [contenteditable="true"]')) {
            return true;
        }
        const overlays = document.querySelectorAll(
            '[role="dialog"], [role="alertdialog"], [role="menu"], '
            + '[data-rfx-panel] [aria-expanded="true"]'
        );
        return [...overlays].some(isVisible);
    }

    function onScroll() {
        scrollFrame = 0;
        if (!panels.size) return;
        const scrollRoot = document.scrollingElement || document.documentElement;
        const maximumY = Math.max(0, scrollRoot.scrollHeight - window.innerHeight);
        const currentY = Math.min(maximumY, Math.max(0, window.scrollY));
        const change = currentY - previousY;
        previousY = currentY;

        if (currentY <= 4 || currentY >= maximumY - 4 || interactionIsOpen()) {
            setHidden(false);
            distance = 0;
            direction = 0;
            return;
        }
        if (Math.abs(change) < 2) return;
        const nextDirection = Math.sign(change);
        distance = nextDirection === direction ? distance + Math.abs(change) : Math.abs(change);
        direction = nextDirection;
        if (distance >= (direction > 0 ? 24 : 12)) {
            setHidden(direction > 0);
            distance = 0;
        }
    }

    function scheduleScroll() {
        if (!scrollFrame) scrollFrame = requestAnimationFrame(onScroll);
    }

    function updateButton() {
        if (!button) return;
        const label = fullscreen ? 'Выйти из полного экрана' : 'На весь экран';
        const path = fullscreen
            ? 'M9 3v6H3m12-6v6h6M3 15h6v6m6 0v-6h6'
            : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6';
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(fullscreen));
        button.title = label;
        button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<path d="' + path + '"></path></svg>';
    }

    function setFullscreen(value) {
        const nextFullscreen = Boolean(value);
        if (nextFullscreen === fullscreen) return;
        fullscreen = nextFullscreen;
        updateButton();
        setHidden(false);
        resetScroll();
    }

    async function toggleFullscreen() {
        if (window.RemangaNative) {
            window.RemangaNative.postMessage(JSON.stringify({ type: 'toggleFullscreen' }));
            return;
        }
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
            }
        } catch (error) {
            button.title = 'Полный экран недоступен в этом браузере.';
            console.warn('Remanga Reader: fullscreen is unavailable', error);
        }
    }

    function attachButton(bottom) {
        // This is the existing row with chapter, comment, like and bookmark buttons.
        const row = bottom.querySelector('.no-wrap > .flex.flex-nowrap');
        if (controls !== row) {
            layoutObserver?.disconnect();
            controls = row;
            button?.remove();
            if (row) {
                layoutObserver?.observe(row);
                layoutObserver?.observe(row.parentElement);
            }
        }
        if (!button) {
            button = document.createElement('button');
            button.id = 'rfx-fullscreen';
            button.type = 'button';
            button.addEventListener('click', toggleFullscreen);
            updateButton();
        }
        placeButton(bottom, row);
    }

    function placeButton(bottom, row) {
        const bar = row?.parentElement;
        const children = row ? [...row.children].filter(child => child !== button) : [];
        const rowStyle = row && getComputedStyle(row);
        const gap = parseFloat(rowStyle?.columnGap) || 0;
        const padding = (parseFloat(rowStyle?.paddingLeft) || 0)
            + (parseFloat(rowStyle?.paddingRight) || 0);
        const controlHeight = children.find(child => child.matches('button'))?.offsetHeight || 40;
        const usedWidth = children.reduce((width, child) => {
            const style = getComputedStyle(child);
            return width + Math.max(child.offsetWidth, child.scrollWidth)
                + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
        }, 0);
        const barHeight = bar?.offsetHeight || 56;
        const fits = row && row.clientWidth - padding >= usedWidth + gap * children.length + controlHeight + 2;
        const placement = fits ? 'inline' : 'floating';
        const size = Math.min(controlHeight, barHeight);
        const parent = fits ? row : bottom;
        if (button.getAttribute('data-rfx-placement') !== placement) {
            button.setAttribute('data-rfx-placement', placement);
        }
        for (const [property, value] of [['--rfx-button-size', size + 'px'], ['--rfx-bar-height', barHeight + 'px']]) {
            if (button.style.getPropertyValue(property) !== value) button.style.setProperty(property, value);
        }
        if (button.parentElement !== parent) parent.append(button);
    }

    function isReadingSurface(target) {
        return target instanceof Element
            && target.closest('.reader-container-width, main')
            && !target.closest('[data-rfx-panel], a, button, input, textarea, select, label, '
                + '[contenteditable], [role="button"], [role="link"], [role="dialog"], '
                + '[role="menu"], video, audio, iframe, summary');
    }

    function onPointerDown(event) {
        pendingTap = null;
        if (event.isPrimary === false || event.button !== 0 || !panels.size
                || !isReadingSurface(event.target) || interactionIsOpen()) {
            pointer = null;
            return;
        }
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
    }

    function onPointerMove(event) {
        if (pointer && (pointer.id !== event.pointerId
                || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10)) {
            pointer = null;
        }
    }

    function onPointerUp(event) {
        onPointerMove(event);
        if (pointer && performance.now() - pointer.time <= 280) {
            pendingTap = { target: event.target, time: performance.now() };
        }
        pointer = null;
    }

    function onReadingClick(event) {
        const tap = pendingTap;
        pendingTap = null;
        if (!tap || event.detail !== 1 || event.defaultPrevented
                || performance.now() - tap.time > 400 || tap.target !== event.target
                || !isReadingSurface(event.target) || !panels.size
                || interactionIsOpen() || !window.getSelection()?.isCollapsed) return;
        // Own only short taps on content; leave links, gestures and text selection to the site.
        event.preventDefault();
        event.stopPropagation();
        setHidden(!hidden);
        resetScroll();
    }

    function releasePanel(panel, originalInert) {
        panel.removeAttribute('data-rfx-panel');
        panel.inert = originalInert;
    }

    function refresh() {
        refreshFrame = 0;
        const chapter = CHAPTER_PATH.test(location.pathname);
        const container = chapter && mobileViewport.matches
            ? [...document.querySelectorAll(PANEL_SELECTOR)].find(isVisible) : null;
        const top = container?.querySelector(':scope > .fixed.top-0');
        const bottom = container?.querySelector(':scope > .fixed.bottom-0');
        const nextPanels = [top, bottom].filter(Boolean);
        let changed = lastPath !== location.pathname;
        lastPath = location.pathname;

        for (const [panel, originalInert] of panels) {
            if (!nextPanels.includes(panel)) {
                releasePanel(panel, originalInert);
                panels.delete(panel);
                changed = true;
            }
        }
        for (const panel of nextPanels) {
            if (!panels.has(panel)) {
                panels.set(panel, panel.inert === true);
                panel.setAttribute('data-rfx-panel', panel === top ? 'top' : 'bottom');
                changed = true;
            }
        }
        if (bottom) {
            attachButton(bottom);
        } else {
            button?.remove();
            layoutObserver?.disconnect();
            controls = null;
        }
        if (!panels.size) {
            document.documentElement.removeAttribute('data-rfx-hidden');
            hidden = false;
        } else if (changed || interactionIsOpen()) {
            setHidden(false);
            resetScroll();
        }
    }

    function scheduleRefresh() {
        if (!refreshFrame) refreshFrame = requestAnimationFrame(refresh);
    }

    function start() {
        const style = document.createElement('style');
        style.id = 'rfx-styles';
        style.textContent = styles;
        document.head.append(style);
        if (window.ResizeObserver) layoutObserver = new ResizeObserver(scheduleRefresh);
        const observer = new MutationObserver(scheduleRefresh);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-expanded', 'data-state']
        });
        window.addEventListener('scroll', scheduleScroll, { passive: true });
        window.addEventListener('resize', () => {
            if (window.innerWidth !== viewportWidth) {
                viewportWidth = window.innerWidth;
                setHidden(false);
            }
            resetScroll();
            scheduleRefresh();
        }, { passive: true });
        window.addEventListener('popstate', scheduleRefresh);
        document.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
        document.addEventListener('pointermove', onPointerMove, { passive: true, capture: true });
        document.addEventListener('pointerup', onPointerUp, { passive: true, capture: true });
        document.addEventListener('pointercancel', () => { pointer = null; pendingTap = null; }, { passive: true });
        document.addEventListener('click', onReadingClick, true);
        mobileViewport.addEventListener('change', scheduleRefresh);
        document.addEventListener('focusin', () => {
            if (panels.size) {
                setHidden(false);
                resetScroll();
            }
        });
        document.addEventListener('fullscreenchange', () => setFullscreen(Boolean(document.fullscreenElement)));
        if (window.RemangaNative) {
            window.RemangaNative.onmessage = event => {
                try {
                    const state = JSON.parse(event.data);
                    if (typeof state.fullscreen === 'boolean') setFullscreen(state.fullscreen);
                } catch (error) {
                    console.warn('Remanga Reader: invalid fullscreen state', error);
                }
            };
            window.RemangaNative.postMessage(JSON.stringify({ type: 'ready' }));
        }
        refresh();
    }

    window.RemangaReaderFix = { refresh: scheduleRefresh, setFullscreen };
    if (document.readyState === 'complete') {
        start();
    } else {
        window.addEventListener('load', start, { once: true });
    }
})();
