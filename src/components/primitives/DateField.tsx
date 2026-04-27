import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarIcon } from "../icons";
import { PopoverCalendar } from "./PopoverCalendar";
import "./DateField.css";

type DateParts = { mm: string; dd: string; yyyy: string };

function isoToParts(iso: string): DateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return { mm: "", dd: "", yyyy: "" };
  return { mm: m[2], dd: m[3], yyyy: m[1] };
}

function partsToIso(p: DateParts): string {
  if (p.mm.length !== 2 || p.dd.length !== 2 || p.yyyy.length !== 4) return "";
  const y = parseInt(p.yyyy, 10);
  const mo = parseInt(p.mm, 10);
  const d = parseInt(p.dd, 10);
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return "";
  }
  return `${p.yyyy}-${p.mm}-${p.dd}`;
}

export function DateField({
  value,
  onChange,
  ariaLabel = "Date",
  defaultYear,
  fixedMonthYear,
}: {
  value: string;
  onChange: (iso: string) => void;
  ariaLabel?: string;
  defaultYear?: string;
  /** When set, MM and YYYY are shown as static text and only DD is editable. */
  fixedMonthYear?: { mm: string; yyyy: string };
}) {
  const [parts, setParts] = useState<DateParts>(() => isoToParts(value));
  const partsRef = useRef<DateParts>(parts);
  const mmRef = useRef<HTMLInputElement>(null);
  const ddRef = useRef<HTMLInputElement>(null);
  const yyRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const calBtnRef = useRef<HTMLButtonElement>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const justAdvancedRef = useRef(false);

  useEffect(() => {
    if (fixedMonthYear) {
      if (!value) {
        partsRef.current = { mm: fixedMonthYear.mm, dd: "", yyyy: fixedMonthYear.yyyy };
        setParts(partsRef.current);
      }
      return;
    }
    const next = isoToParts(value);
    partsRef.current = next;
    setParts(next);
  }, [value, fixedMonthYear]);

  const emit = useCallback(
    (next: DateParts) => {
      if (next.mm === "" && next.dd === "" && next.yyyy === "") {
        if (value !== "") onChange("");
        return;
      }
      const iso = partsToIso(next);
      if (iso && iso !== value) onChange(iso);
    },
    [onChange, value],
  );

  const update = useCallback(
    (next: DateParts) => {
      partsRef.current = next;
      setParts(next);
      emit(next);
    },
    [emit],
  );

  const onSegChange = (
    seg: keyof DateParts,
    raw: string,
    maxLen: number,
    nextRef: React.RefObject<HTMLInputElement | null> | null,
  ) => {
    const digits = raw.replace(/\D/g, "").slice(0, maxLen);
    let next = { ...partsRef.current, [seg]: digits };
    if (seg === "dd" && digits.length === maxLen && defaultYear && next.yyyy === "") {
      next = { ...next, yyyy: defaultYear };
    }
    update(next);
    if (digits.length === maxLen && nextRef?.current) {
      justAdvancedRef.current = true;
      nextRef.current.focus();
      nextRef.current.select();
    }
  };

  const onSegKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    seg: keyof DateParts,
    prevRef: React.RefObject<HTMLInputElement | null> | null,
    nextRef: React.RefObject<HTMLInputElement | null> | null,
  ) => {
    const target = e.currentTarget;
    if (e.key === "Backspace" && target.value === "" && prevRef?.current) {
      e.preventDefault();
      prevRef.current.focus();
      const len = prevRef.current.value.length;
      prevRef.current.setSelectionRange(len, len);
      return;
    }
    if (e.key === "ArrowLeft" && target.selectionStart === 0 && prevRef?.current) {
      e.preventDefault();
      prevRef.current.focus();
      const len = prevRef.current.value.length;
      prevRef.current.setSelectionRange(len, len);
      return;
    }
    if (
      e.key === "ArrowRight" &&
      target.selectionStart === target.value.length &&
      nextRef?.current
    ) {
      e.preventDefault();
      nextRef.current.focus();
      nextRef.current.setSelectionRange(0, 0);
      return;
    }
    if ((e.key === "/" || e.key === "-" || e.key === " ") && nextRef?.current) {
      e.preventDefault();
      const cur = partsRef.current[seg];
      const padded = seg !== "yyyy" && cur.length === 1 ? `0${cur}` : cur;
      let next = { ...partsRef.current, [seg]: padded };
      if (seg === "dd" && defaultYear && next.yyyy === "") {
        next = { ...next, yyyy: defaultYear };
      }
      update(next);
      nextRef.current.focus();
      nextRef.current.select();
    }
  };

  const padOnBlur = (seg: "mm" | "dd") => {
    if (justAdvancedRef.current) {
      justAdvancedRef.current = false;
      return;
    }
    const cur = partsRef.current[seg];
    if (cur.length === 1) {
      update({ ...partsRef.current, [seg]: `0${cur}` });
    }
  };

  const closePopover = useCallback(() => setPopoverOpen(false), []);

  const togglePopover = () => {
    setPopoverOpen((open) => !open);
  };

  const onPickDate = (iso: string) => {
    if (iso === "") {
      update({ mm: "", dd: "", yyyy: "" });
    } else {
      update(isoToParts(iso));
    }
  };

  const clear = () => {
    update({ mm: "", dd: "", yyyy: "" });
    ddRef.current?.focus();
  };

  const onFixedDdChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    const display: DateParts = { mm: fixedMonthYear!.mm, dd: digits, yyyy: fixedMonthYear!.yyyy };
    partsRef.current = display;
    setParts(display);
    if (digits === "") {
      if (value !== "") onChange("");
    } else {
      const padded = digits.length === 1 ? `0${digits}` : digits;
      const iso = partsToIso({ mm: fixedMonthYear!.mm, dd: padded, yyyy: fixedMonthYear!.yyyy });
      if (iso && iso !== value) onChange(iso);
    }
  };

  if (fixedMonthYear) {
    const displayDd = parts.dd;
    const hasDay = displayDd !== "";
    return (
      <div className="date-field date-field-fixed" role="group" aria-label={ariaLabel} ref={rootRef}>
        <span className="date-seg date-seg-fixed">{fixedMonthYear.mm}</span>
        <span className="date-sep" aria-hidden="true">/</span>
        <input
          ref={ddRef}
          className="date-seg date-seg-dd"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD"
          aria-label="Day"
          maxLength={2}
          value={displayDd}
          onChange={(e) => onFixedDdChange(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        <span className="date-sep" aria-hidden="true">/</span>
        <span className="date-seg date-seg-fixed">{fixedMonthYear.yyyy}</span>
        {hasDay && (
          <button
            type="button"
            className="date-clear"
            onClick={clear}
            title="Clear date"
            aria-label="Clear date"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  const hasAny = parts.mm !== "" || parts.dd !== "" || parts.yyyy !== "";

  return (
    <div className="date-field" role="group" aria-label={ariaLabel} ref={rootRef}>
      <input
        ref={mmRef}
        className="date-seg date-seg-mm"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM"
        aria-label="Month"
        maxLength={2}
        value={parts.mm}
        onChange={(e) => onSegChange("mm", e.target.value, 2, ddRef)}
        onKeyDown={(e) => onSegKeyDown(e, "mm", null, ddRef)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => padOnBlur("mm")}
      />
      <span className="date-sep" aria-hidden="true">/</span>
      <input
        ref={ddRef}
        className="date-seg date-seg-dd"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD"
        aria-label="Day"
        maxLength={2}
        value={parts.dd}
        onChange={(e) => onSegChange("dd", e.target.value, 2, yyRef)}
        onKeyDown={(e) => onSegKeyDown(e, "dd", mmRef, yyRef)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => padOnBlur("dd")}
      />
      <span className="date-sep" aria-hidden="true">/</span>
      <input
        ref={yyRef}
        className="date-seg date-seg-yyyy"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYY"
        aria-label="Year"
        maxLength={4}
        value={parts.yyyy}
        onChange={(e) => onSegChange("yyyy", e.target.value, 4, null)}
        onKeyDown={(e) => onSegKeyDown(e, "yyyy", ddRef, null)}
        onFocus={(e) => e.currentTarget.select()}
      />
      {hasAny && (
        <button
          type="button"
          className="date-clear"
          onClick={clear}
          title="Clear date"
          aria-label="Clear date"
        >
          ×
        </button>
      )}
      <button
        ref={calBtnRef}
        type="button"
        className={`date-picker-btn${popoverOpen ? " active" : ""}`}
        onClick={togglePopover}
        title="Pick a date"
        aria-label="Open date picker"
        aria-expanded={popoverOpen}
      >
        <CalendarIcon />
      </button>
      {popoverOpen && (
        <PopoverCalendar
          value={partsToIso(parts)}
          onSelect={onPickDate}
          onClose={closePopover}
          anchorRef={calBtnRef}
        />
      )}
    </div>
  );
}
