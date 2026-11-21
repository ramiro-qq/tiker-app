import { useEffect } from 'react';

// Native dialogs isolate pointer interaction, but Chromium can place focus on
// the browser chrome at the last Tab stop. Keep keyboard navigation in the panel.
export function useDialogKeyboard() {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const panels = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))
        .filter(panel => panel.getClientRects().length && !panel.closest('[inert]'));
      const panel = panels[panels.length-1];
      if (!panel) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex],[contenteditable="true"]'))
        .filter(node => !node.matches(':disabled,[tabindex="-1"],input[type="hidden"]') && !node.closest('[inert]') && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
      const first = controls[0], last = controls[controls.length-1];
      if (!first) { event.preventDefault(); panel.focus(); return; }
      const current = document.activeElement;
      if (!panel.contains(current) || current === panel || (!event.shiftKey && current === last) || (event.shiftKey && current === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, []);
}
