import { useEffect, useMemo, useRef, useState } from "react";
import "./PopoverCalendar.css";

function isoOfDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DOW_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function PopoverCalendar({
  value,
  onSelect,
  onClose,
  anchorRef,
}: {
  value: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const popRef = useRef<HTMLDivElement>(null);

  const initialView = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (m) return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) - 1 };
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [value]);

  const [view, setView] = useState(initialView);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const reposition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popWidth = 252;
      const popHeight = 280;
      const margin = 8;
      let top = rect.bottom + 6;
      if (top + popHeight > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - popHeight - 6);
      }
      let left = rect.right - popWidth;
      left = Math.max(margin, Math.min(window.innerWidth - popWidth - margin, left));
      setPos({ top, left });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [anchorRef]);

  useEffect(() => {
    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (popRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, anchorRef]);

  const cells = useMemo(() => {
    const firstWeekday = new Date(view.year, view.month, 1).getDay();
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const out: { date: Date; current: boolean }[] = [];
    for (let i = 0; i < firstWeekday; i++) {
      out.push({
        date: new Date(view.year, view.month, i - firstWeekday + 1),
        current: false,
      });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ date: new Date(view.year, view.month, d), current: true });
    }
    while (out.length < 42) {
      const last = out[out.length - 1].date;
      const next = new Date(last);
      next.setDate(next.getDate() + 1);
      out.push({ date: next, current: false });
    }
    return out;
  }, [view]);

  const monthLabel = new Date(view.year, view.month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
  const todayIso = isoOfDate(new Date());

  const goPrev = () =>
    setView((v) =>
      v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 },
    );
  const goNext = () =>
    setView((v) =>
      v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 },
    );

  const style: React.CSSProperties = pos
    ? { position: "fixed", top: pos.top, left: pos.left, zIndex: 80 }
    : { position: "fixed", visibility: "hidden", top: 0, left: 0, zIndex: 80 };

  return (
    <div className="cal-popover" ref={popRef} style={style} role="dialog" aria-label="Date picker">
      <div className="cal-header">
        <button
          type="button"
          className="cal-nav"
          onClick={goPrev}
          title="Previous month"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="cal-title">{monthLabel}</span>
        <button
          type="button"
          className="cal-nav"
          onClick={goNext}
          title="Next month"
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="cal-dow">
        {DOW_LABELS.map((d) => (
          <span key={d} className="cal-dow-cell">
            {d}
          </span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((cell, i) => {
          const iso = isoOfDate(cell.date);
          const cls = ["cal-day"];
          if (!cell.current) cls.push("muted");
          if (iso === value) cls.push("selected");
          if (iso === todayIso) cls.push("today");
          return (
            <button
              key={i}
              type="button"
              className={cls.join(" ")}
              onClick={() => {
                onSelect(iso);
                onClose();
              }}
            >
              {cell.date.getDate()}
            </button>
          );
        })}
      </div>
      <div className="cal-footer">
        <button
          type="button"
          className="cal-foot-btn"
          onClick={() => {
            onSelect(todayIso);
            onClose();
          }}
        >
          Today
        </button>
        <button
          type="button"
          className="cal-foot-btn"
          onClick={() => {
            onSelect("");
            onClose();
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
