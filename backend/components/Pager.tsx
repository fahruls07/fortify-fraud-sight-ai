"use client";
import { useState } from "react";

export const SIZES = [20, 50, 100];

// Client-side pagination shared by every table: returns the visible slice plus the pager bar.
export function usePager<T>(rows: T[]) {
  const [size, setSize] = useState(20), [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / size)), cur = Math.min(page, pages - 1);
  const bar = (
    <div className="filters pager">
      <label className="mute">Show <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }} aria-label="Rows per page">
        {SIZES.map((n) => <option key={n}>{n}</option>)}</select> per page</label>
      <span style={{ flex: 1 }} />
      <button disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹ Previous</button>
      <span className="mute">{rows.length ? `${cur * size + 1}–${Math.min(rows.length, (cur + 1) * size)} of ${rows.length}` : "0"} · page {cur + 1}/{pages}</span>
      <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next ›</button>
    </div>
  );
  return { shown: rows.slice(cur * size, (cur + 1) * size), bar, reset: () => setPage(0) };
}
