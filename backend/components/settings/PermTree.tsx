"use client";
import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { ALL_PERMS, PERM_TREE, type Perm } from "@/lib/perms";

function GroupBox({ checked, partial, disabled, onChange, label }: { checked: boolean; partial: boolean; disabled: boolean; onChange: (v: boolean) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = partial; }, [partial]);
  return <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={`All ${label} permissions`} />;
}

// Menu → action permission tree. Ticking a menu ticks all its actions; a partly ticked menu shows as indeterminate.
export function PermTree({ value, onChange, disabled = false }: { value: Perm[]; onChange: (v: Perm[]) => void; disabled?: boolean }) {
  const set = new Set(value);
  const toggle = (keys: Perm[], on: boolean) => { const n = new Set(set); keys.forEach((k) => (on ? n.add(k) : n.delete(k))); onChange(ALL_PERMS.filter((p) => n.has(p))); };
  return (
    <ul className="tree">
      {PERM_TREE.map((g) => {
        const keys = g.children.map((c) => c.key) as Perm[], n = keys.filter((k) => set.has(k)).length;
        return (
          <li key={g.key}>
            <details open>
              <summary><ChevronRight size={14} className="caret" />
                <label onClick={(e) => e.stopPropagation()}><GroupBox checked={n === keys.length} partial={n > 0 && n < keys.length} disabled={disabled} onChange={(v) => toggle(keys, v)} label={g.label} /> <b>{g.label}</b></label>
                <span className="mute" style={{ marginLeft: "auto" }}>{n}/{keys.length}</span>
              </summary>
              <ul>
                {g.children.map((c) => (
                  <li key={c.key}><label><input type="checkbox" checked={set.has(c.key)} disabled={disabled} onChange={(e) => toggle([c.key], e.target.checked)} /> {c.label} <code className="mute">{c.key}</code></label></li>
                ))}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
