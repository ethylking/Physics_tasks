// ui/projectManager/DiagnosticsPanel.tsx — schema/reference validation results.

import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Diagnostic } from "../../core/types";

export function DiagnosticsPanel({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  if (diagnostics.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-600">
        <CheckCircle2 className="h-10 w-10 text-emerald-500" />
        <p className="text-sm font-medium text-emerald-500">Schema OK</p>
        <p className="max-w-sm text-center text-xs leading-relaxed">
          All entity id references resolve and every kind is a valid Tier 1 built-in or preserved Tier 2 plugin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs font-semibold text-red-300">
          <AlertCircle className="h-4 w-4" />
          {errors.length} error{errors.length === 1 ? "" : "s"}
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs font-semibold text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          {warnings.length} warning{warnings.length === 1 ? "" : "s"}
        </div>
      </div>
      <ul className="space-y-2">
        {diagnostics.map((d, i) => (
          <li
            key={i}
            className={`rounded-lg border p-3 ${
              d.severity === "error" ? "border-red-900/60 bg-red-950/20" : "border-amber-900/50 bg-amber-950/20"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {d.severity === "error" ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code
                    className={`font-mono text-[11px] font-semibold ${
                      d.severity === "error" ? "text-red-300" : "text-amber-300"
                    }`}
                  >
                    {d.code}
                  </code>
                  {d.line !== undefined && (
                    <span className="text-[11px] text-zinc-500">line {d.line}</span>
                  )}
                  {d.path && <code className="font-mono text-[11px] text-zinc-500">{d.path}</code>}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-zinc-300">{d.message}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
