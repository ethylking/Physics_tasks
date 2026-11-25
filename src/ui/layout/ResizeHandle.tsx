// ui/layout/ResizeHandle.tsx — reusable vertical drag handle for side panels.
//
// The handle owns the pointer capture and reports a new width on every move;
// clamping lives in the uiStore setters. Pointer events (not React state) drive
// the drag loop: a ref holds the drag origin so each pointermove is O(1) and no
// stale state can leak into the calculation. Keyboard support mirrors the drag:
// ←/→ widen or narrow by 16 px, Home resets.

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

const KEYBOARD_STEP = 16;

interface ResizeHandleProps {
  /** Which side the panel being resized is on (governs the drag/arrow direction). */
  direction: "left" | "right";
  value: number;
  min: number;
  max: number;
  label: string; // aria-label, e.g. "Resize spawn palette"
  onResize: (width: number) => void;
  onReset: () => void;
}

interface DragOrigin {
  startX: number;
  startWidth: number;
}

export default function ResizeHandle({
  direction,
  value,
  min,
  max,
  label,
  onResize,
  onReset,
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragOrigin | null>(null);

  /** Remove the global drag affordance and the local drag state. */
  const stopDrag = useCallback(() => {
    dragRef.current = null;
    document.body.classList.remove("resizing-panels");
    setDragging(false);
  }, []);

  // Defensive cleanup if the component unmounts mid-drag (project closed, etc.).
  useEffect(
    () => () => {
      dragRef.current = null;
      document.body.classList.remove("resizing-panels");
    },
    [],
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // preventDefault() keeps the drag from selecting text/starting a native
    // drag, but it also suppresses the implicit focus on mousedown — focus the
    // divider explicitly so click-then-arrow-keys works for mouse users too.
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: value };
    document.body.classList.add("resizing-panels");
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !dragging) return;
    const delta = event.clientX - drag.startX;
    // A left panel grows when the divider moves right; a right panel grows when
    // it moves left. Raw value is passed through — the store clamps.
    const next = direction === "left" ? drag.startWidth + delta : drag.startWidth - delta;
    onResize(next);
  };

  const finishPointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    stopDrag();
    const element = event.currentTarget;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
  };

  const handleLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    stopDrag();
    const element = event.currentTarget;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Increasing the panel width always means "grow"; the arrow that performs
    // it depends on which edge of the viewport the panel sits against.
    const grow = direction === "left" ? KEYBOARD_STEP : -KEYBOARD_STEP;
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        onResize(value + grow);
        break;
      case "ArrowLeft":
        event.preventDefault();
        onResize(value - grow);
        break;
      case "Home":
        event.preventDefault();
        onReset();
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      tabIndex={0}
      className="resize-handle"
      data-dragging={dragging ? "true" : "false"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    />
  );
}
