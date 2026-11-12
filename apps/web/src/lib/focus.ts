const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Elements inside a dialog that can take keyboard focus, in document order. */
export function focusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
    );
}

/**
 * Keep Tab and Shift+Tab inside a dialog. Focus that has escaped the dialog is
 * pulled back to the first (or last) control, so a nested portal cannot make
 * the tab order jump to the page behind it.
 */
export function trapTab(event: KeyboardEvent, container: HTMLElement): void {
    if (event.key !== 'Tab') {
        return;
    }

    const focusable = focusableElements(container);
    if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
            event.preventDefault();
            last?.focus();
        }
        return;
    }

    if (active === last || !container.contains(active)) {
        event.preventDefault();
        first?.focus();
    }
}
