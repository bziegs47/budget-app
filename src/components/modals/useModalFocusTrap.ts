import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function useModalFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape: () => void,
): React.RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previousFocusRef.current =
      (document.activeElement as HTMLElement | null) ?? null;

    const focusFrame = requestAnimationFrame(() => {
      const node = containerRef.current;
      if (!node) return;
      if (!node.contains(document.activeElement)) {
        const focusables = getFocusableWithin(node);
        const target = focusables[0] ?? node;
        if (target === node && !node.hasAttribute("tabindex")) {
          node.setAttribute("tabindex", "-1");
        }
        target.focus();
      }
    });

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      const node = containerRef.current;
      if (!node) return;
      const focusables = getFocusableWithin(node);
      if (focusables.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (current === first || !node.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handler);
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous && document.body.contains(previous)) {
        previous.focus();
      }
    };
  }, [active, onEscape]);

  return containerRef;
}

export const preventFocusSteal = (e: ReactMouseEvent<HTMLButtonElement>) => {
  e.preventDefault();
};
