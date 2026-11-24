// ui/inspector/fields.tsx — small form field primitives for the inspector.

import { useMemo } from "react";
import type { Vec3 } from "../../core/types";
import { compileExpression } from "../../math/expr";

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}

export function NumberField({ label, value, onChange, step = 0.1, min, max }: NumberFieldProps) {
  const display = Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        aria-label={label}
        value={display}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        }}
        className="input-dark font-mono text-xs"
      />
    </label>
  );
}

interface Vec3FieldProps {
  groupLabel: string;
  labels: [string, string, string];
  values: Vec3;
  onChange: (value: Vec3) => void;
  step?: number;
}

export function Vec3Field({ groupLabel, labels, values, onChange, step = 0.1 }: Vec3FieldProps) {
  return (
    <div>
      <span className="field-label">{groupLabel}</span>
      <div className="grid grid-cols-3 gap-1.5">
        {labels.map((l, i) => (
          <input
            key={l}
            type="number"
            step={step}
            aria-label={`${groupLabel} ${l}`}
            value={Number.isFinite(values[i] ?? 0) ? Number((values[i] ?? 0).toFixed(6)) : 0}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (!Number.isFinite(n)) return;
              const next = [...values] as Vec3;
              next[i] = n;
              onChange(next);
            }}
            className="input-dark font-mono text-xs"
          />
        ))}
      </div>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        type="text"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="input-dark font-mono text-xs"
      />
    </label>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-cyan-500"
      />
      <span className="text-xs text-zinc-300">{label}</span>
    </label>
  );
}

/**
 * mathjs expression input with instant, live validation: syntax errors and
 * disallowed symbols show a red border + inline message via `compileExpression`
 * — the entity keeps working (bad expressions evaluate to 0 at runtime).
 */
export function ExprField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const result = useMemo(() => compileExpression(value), [value]);
  const error = result.ok ? null : result.error;
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        type="text"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`input-dark font-mono text-xs ${
          error ? "border-red-500 focus:border-red-500 focus:ring-red-500/40" : ""
        }`}
      />
      {error && <span className="mt-1 block text-[10px] leading-snug text-red-400">{error}</span>}
    </label>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="input-dark text-xs">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-10 cursor-pointer rounded border border-zinc-700 bg-transparent"
      />
      <span className="text-xs text-zinc-300">{label}</span>
    </label>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <h3 className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] leading-relaxed text-zinc-600">{children}</p>;
}
