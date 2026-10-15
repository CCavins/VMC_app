import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function Section({ title, icon, children, defaultOpen = true, badge }: {
  title: string; icon?: ReactNode; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`panel-section ${open ? 'open' : ''}`}>
      <button className="section-header" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        <span className="section-title">{title}</span>
        {badge && <span className="section-badge">{badge}</span>}
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Row({ label, hint, children }: { label: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <label className="row" title={hint}>
      <span className="row-label">{label}</span>
      <span className="row-control">{children}</span>
    </label>
  );
}

export function Slider({ value, min, max, step = 0.01, onChange, format }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <span className="slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <span className="slider-value">{format ? format(value) : value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}</span>
    </span>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)} type="button" aria-pressed={value}>
      <span className="toggle-knob" />
      {label && <span className="toggle-label">{label}</span>}
    </button>
  );
}

export function Select<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
