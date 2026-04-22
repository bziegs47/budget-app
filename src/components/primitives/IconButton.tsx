import type { ReactNode } from "react";
import "./IconButton.css";

export function IconButton({
  label,
  onClick,
  variant,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
  active?: boolean;
  children: ReactNode;
}) {
  const cls = [
    "icon-btn",
    variant === "danger" ? "danger" : "",
    active ? "active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
