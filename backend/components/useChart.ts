"use client";
import { useEffect, useRef } from "react";
import type Chart from "chart.js/auto";

// Creates a Chart.js chart on the returned canvas ref and rebuilds it when deps change.
export function useChart(make: (el: HTMLCanvasElement) => Chart, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null), chart = useRef<Chart | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    chart.current?.destroy(); chart.current = make(ref.current);
    return () => { chart.current?.destroy(); chart.current = null; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}
