import { useEffect, useState } from "react";
import type { ExpenseBucketDto } from "../../types";
import { useModalFocusTrap } from "./useModalFocusTrap";
import "./BucketReorderModal.css";

export function BucketReorderModal({
  open,
  buckets,
  onClose,
  onCommit,
}: {
  open: boolean;
  buckets: ExpenseBucketDto[];
  onClose: () => void;
  onCommit: (orderedIds: number[]) => void;
}) {
  const [pending, setPending] = useState<number[]>([]);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setPending(buckets.map((b) => b.id));
      setDraggingId(null);
      setDropTargetId(null);
    }
  }, [open, buckets]);

  const trapRef = useModalFocusTrap<HTMLDivElement>(open, onClose);

  if (!open) return null;

  const nameFor = (id: number) => buckets.find((b) => b.id === id)?.name ?? `#${id}`;

  const handleDrop = (targetId: number) => {
    const dragged = draggingId;
    setDraggingId(null);
    setDropTargetId(null);
    if (dragged == null || dragged === targetId) return;
    setPending((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragged);
      const to = next.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragged);
      return next;
    });
  };

  const done = () => {
    onCommit(pending);
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={trapRef}
        className="modal-card bucket-reorder-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bucket-reorder-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="bucket-reorder-title" className="modal-title">
          Reorder buckets
        </h2>
        <p className="modal-hint">
          Drag a row to reorder. Click <strong>Done</strong> to apply changes to the budget.
        </p>
        <ul className="bucket-reorder-list" role="list">
          {pending.map((id) => {
            const isDragging = draggingId === id;
            const isDropTarget = dropTargetId === id && draggingId !== id;
            const cls = [
              "bucket-reorder-row",
              isDragging ? "dragging" : "",
              isDropTarget ? "drop-target" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li
                key={id}
                className={cls}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(id));
                  setDraggingId(id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropTargetId(null);
                }}
                onDragOver={(e) => {
                  if (draggingId == null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropTargetId !== id) setDropTargetId(id);
                }}
                onDragLeave={() => {
                  if (dropTargetId === id) setDropTargetId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(id);
                }}
              >
                <span className="bucket-reorder-handle" aria-hidden="true">
                  ⋮⋮
                </span>
                <span className="bucket-reorder-name">{nameFor(id)}</span>
              </li>
            );
          })}
          {pending.length === 0 && (
            <li className="muted">No buckets to reorder.</li>
          )}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={done}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
