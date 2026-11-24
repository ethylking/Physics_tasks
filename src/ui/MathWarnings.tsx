// ui/MathWarnings.tsx — compact non-blocking badge for rate-limited math
// expression warnings forwarded from the physics worker (§4.1). Shows the
// latest warning; click (or ✕) dismisses the queue.

import { AlertTriangle } from "lucide-react";
import { useTelemetryStore } from "../stores/telemetryStore";

export default function MathWarnings() {
  const warnings = useTelemetryStore((s) => s.warnings);
  const clearWarnings = useTelemetryStore((s) => s.clearWarnings);
  if (warnings.length === 0) return null;
  const latest = warnings[warnings.length - 1] ?? "";
  return (
    <button
      type="button"
      aria-label="Dismiss math expression warnings"
      title={`${warnings.length} warning(s): ${latest}`}
      onClick={clearWarnings}
      className="flex max-w-64 items-center gap-1.5 rounded-md bg-amber-950/70 px-2 py-1 text-[10px] font-medium text-amber-300 ring-1 ring-amber-800/60 transition-colors hover:bg-amber-950 hover:text-amber-200"
    >
      <AlertTriangle className="h-3 w-3 shrink-0" />
      <span className="truncate">{latest}</span>
      {warnings.length > 1 && (
        <span className="shrink-0 rounded bg-amber-900/70 px-1 text-[9px] font-bold text-amber-200">
          {warnings.length}
        </span>
      )}
    </button>
  );
}
