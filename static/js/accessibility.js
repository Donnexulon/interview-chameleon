(function () {
    'use strict';

    const routeNames = {
        hero: 'Home',
        setup: 'Prepare your rehearsal',
        session: 'Interview in progress',
        report: 'Interview report',
        history: 'Session history',
        calibration: 'Evaluation calibration',
        questions: 'Question library',
        achievements: 'Achievements',
        portfolio: 'Portfolio review',
        games: 'Practice games',
    };

    function applyPreferences(preferences) {
        const root = document.documentElement;
        const rawScale = Number(preferences?.text_scale) || 100;
        const scale = Math.min(2, Math.max(1, rawScale > 2 ? rawScale / 100 : rawScale));
        root.style.setProperty('--accessibility-text-scale', String(scale));
        root.classList.toggle('reduce-motion', Boolean(preferences?.reduced_motion));
        root.classList.toggle('high-contrast', Boolean(preferences?.high_contrast));
    }

    async function loadPreferences() {
        try {
            const response = await fetch('/api/preferences');
            if (!response.ok) return;
            const data = await response.json();
            applyPreferences(data.preferences || data);
        } catch (_) {
            // The UI remains fully usable with OS-level accessibility preferences.
        }
    }

    const dialogOverlaySelector = '.modal-overlay, .ss-modal-overlay, [data-modal], [data-dialog-overlay], #session-recovery-prompt';
    const dialogContentSelector = '.modal-content, .ss-modal, [data-dialog]';
    const focusableSelector = [
        'button:not([disabled])',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'a[href]',
        'summary',
        '[contenteditable="true"]',
        '[tabindex]:not([tabindex="-1"])',
    ].join(', ');
    const dialogStates = new WeakMap();
    let dialogSequence = 0;

    function dialogOverlays(scope) {
        const overlays = [];
        if (scope?.matches?.(dialogOverlaySelector)) overlays.push(scope);
        scope?.querySelectorAll?.(dialogOverlaySelector).forEach((overlay) => overlays.push(overlay));
        return overlays;
    }

    function isVisible(element) {
        return Boolean(
            element
            && element.isConnected
            && !element.hidden
            && element.getAttribute('aria-hidden') !== 'true'
            && element.getClientRects().length
        );
    }

    function focusableElements(dialog) {
        return [...dialog.querySelectorAll(focusableSelector)].filter(isVisible);
    }

    function ensureDialogName(dialog, overlay, explicitLabel = '') {
        if (dialog.hasAttribute('aria-label') || dialog.hasAttribute('aria-labelledby')) return;
        const heading = dialog.querySelector('h1, h2, h3, h4, h5, h6, [data-dialog-title]');
        if (heading) {
            if (!heading.id) {
                const prefix = overlay.id || 'app-dialog';
                heading.id = `${prefix}-title-${++dialogSequence}`;
            }
            dialog.setAttribute('aria-labelledby', heading.id);
            return;
        }
        dialog.setAttribute('aria-label', explicitLabel || 'Dialog');
    }

    function resolveInitialFocus(dialog, requested) {
        if (typeof requested === 'string') return dialog.querySelector(requested);
        if (requested instanceof Element && dialog.contains(requested)) return requested;
        return dialog.querySelector('[autofocus]') || focusableElements(dialog)[0] || dialog;
    }

    function restoreDialogFocus(state) {
        const previous = state.previousFocus;
        requestAnimationFrame(() => {
            const canRestorePrevious = previous?.isConnected
                && !previous.matches?.(':disabled')
                && !previous.closest?.('[inert]')
                && previous.getClientRects().length;
            const target = canRestorePrevious
                ? previous
                : document.getElementById('main-content');
            target?.focus?.({ preventScroll: true });
        });
    }

    function finishDialog(overlay, { remove = true, restoreFocus = true } = {}) {
        const state = dialogStates.get(overlay);
        if (!state || state.closed) {
            if (remove && overlay?.isConnected) overlay.remove();
            return;
        }
        state.closed = true;
        overlay.removeEventListener('click', state.onBackdropClick);
        dialogStates.delete(overlay);
        if (remove && overlay.isConnected) overlay.remove();
        if (restoreFocus) restoreDialogFocus(state);
    }

    function requestDialogDismiss(overlay, reason) {
        const state = dialogStates.get(overlay);
        if (!state || state.closed) return;
        if (typeof state.options.onDismiss === 'function') {
            const result = state.options.onDismiss(reason, overlay, state.dialog);
            if (result === false) return;
            if (!overlay.isConnected) return;
        }
        const close = state.dialog.querySelector('[data-close], .modal-close, .ss-modal-close, button[aria-label*="Close" i]');
        if (close && !state.options.onDismiss) {
            close.click();
            return;
        }
        finishDialog(overlay);
    }

    function enhanceDialog(overlay, options = {}, focus = false) {
        const dialog = overlay.querySelector(dialogContentSelector) || overlay.firstElementChild;
        if (!dialog) return null;

        let state = dialogStates.get(overlay);
        if (!state) {
            state = {
                overlay,
                dialog,
                previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
                options: {},
                closed: false,
                focusScheduled: false,
                onBackdropClick: null,
            };
            state.onBackdropClick = (event) => {
                if (event.target === overlay && state.options.closeOnBackdrop) {
                    requestDialogDismiss(overlay, 'backdrop');
                }
            };
            overlay.addEventListener('click', state.onBackdropClick);
            dialogStates.set(overlay, state);
        }

        state.options = {
            closeOnBackdrop: false,
            closeOnEscape: true,
            ...state.options,
            ...options,
        };
        overlay.dataset.a11yDialogOverlay = 'true';
        dialog.dataset.a11yReady = 'true';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
        ensureDialogName(dialog, overlay, state.options.label);

        if (focus && !state.focusScheduled) {
            state.focusScheduled = true;
            requestAnimationFrame(() => {
                state.focusScheduled = false;
                if (!state.closed && overlay.isConnected) {
                    resolveInitialFocus(dialog, state.options.initialFocus)?.focus({ preventScroll: true });
                }
            });
        }
        return state;
    }

    function enhanceDialogs(scope) {
        dialogOverlays(scope).forEach((overlay) => enhanceDialog(overlay, {}, true));
    }

    function openDialog(overlay, options = {}) {
        if (!(overlay instanceof Element)) return null;
        if (!overlay.isConnected) document.body.appendChild(overlay);
        const state = enhanceDialog(overlay, options, true);
        return state ? { overlay: state.overlay, dialog: state.dialog } : null;
    }

    function closeDialog(overlay, options = {}) {
        if (!(overlay instanceof Element)) return;
        const resolved = overlay.matches(dialogOverlaySelector)
            ? overlay
            : overlay.closest(dialogOverlaySelector);
        if (resolved) finishDialog(resolved, options);
    }

    function visibleDialog() {
        return [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
            .filter((element) => element.getClientRects().length)
            .pop();
    }

    document.addEventListener('keydown', (event) => {
        const dialog = visibleDialog();
        if (!dialog) return;
        const overlay = dialog.closest(dialogOverlaySelector);
        const state = overlay ? dialogStates.get(overlay) : null;
        if (event.key === 'Escape') {
            if (state?.options.closeOnEscape !== false) {
                event.preventDefault();
                event.stopPropagation();
                requestDialogDismiss(overlay, 'escape');
            }
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = focusableElements(dialog);
        if (!focusable.length) {
            event.preventDefault();
            dialog.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!dialog.contains(document.activeElement)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    const observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) enhanceDialogs(node);
            }
            for (const node of record.removedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                dialogOverlays(node).forEach((overlay) => finishDialog(overlay, { remove: false }));
            }
        }
    });

    function afterRender(route) {
        const name = routeNames[route] || 'Interview Chameleon';
        document.title = `${name} — Interview Chameleon`;
        const announcer = document.getElementById('route-announcer');
        if (announcer) announcer.textContent = `${name} loaded`;
        enhanceDialogs(document);
        requestAnimationFrame(() => {
            if (!visibleDialog()) document.getElementById('main-content')?.focus({ preventScroll: true });
        });
    }

    observer.observe(document.body, { childList: true, subtree: true });
    loadPreferences();
    window.AppAccessibility = {
        afterRender,
        applyPreferences,
        loadPreferences,
        openDialog,
        closeDialog,
    };
})();
