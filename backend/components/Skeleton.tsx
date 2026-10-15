// Shimmer placeholders shown while a page or its data loads.
export const Skel = ({ w = "100%", h = 14 }: { w?: number | string; h?: number }) => <span className="skel" style={{ width: w, height: h }} aria-hidden />;

export function SkelTable({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="card tablewrap" aria-busy="true" aria-label="Loading">
      <table>
        <thead><tr>{Array.from({ length: cols }, (_, i) => <th key={i}><Skel w={70} h={10} /></th>)}</tr></thead>
        <tbody>{Array.from({ length: rows }, (_, r) => <tr key={r}>{Array.from({ length: cols }, (_, c) => <td key={c}><Skel w={c === 0 ? 80 : `${50 + ((r * 7 + c * 13) % 40)}%`} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function SkelCards({ n = 4 }: { n?: number }) {
  return <div className="kpis">{Array.from({ length: n }, (_, i) => <div key={i} className="card kpi"><Skel w={36} h={36} /><Skel w="60%" h={12} /><Skel w="40%" h={26} /></div>)}</div>;
}

export function SkelPage() {
  return <main aria-busy="true"><Skel w={220} h={26} /><div style={{ height: 16 }} /><SkelCards /><SkelTable /></main>;
}
