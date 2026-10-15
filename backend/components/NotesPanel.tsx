"use client";
import { useEffect, useRef, useState } from "react";
import { Download, MessageSquare, Paperclip, Send } from "lucide-react";
import type { Attachment, Note } from "@/lib/cases";
import { ago } from "@/lib/format";
import { Skel } from "./Skeleton";

const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Analyst notes + attachments for one alert or case. entity = "alert:ALT-0001" | "case:CASE-0001".
export default function NotesPanel({ entity, canEdit }: { entity: string; canEdit: boolean }) {
  const [notes, setNotes] = useState<Note[] | null>(null), [files, setFiles] = useState<Attachment[] | null>(null);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const load = () => {
    fetch(`/api/notes?entity=${encodeURIComponent(entity)}`).then((r) => r.json()).then((d) => setNotes(Array.isArray(d) ? d : []));
    fetch(`/api/attachments?entity=${encodeURIComponent(entity)}`).then((r) => r.json()).then((d) => setFiles(Array.isArray(d) ? d : []));
  };
  useEffect(load, [entity]);
  async function add() {
    if (!text.trim()) return; setBusy(true);
    const r = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity, text }) });
    setBusy(false); if (r.ok) { setText(""); load(); }
  }
  async function upload(f: File) {
    setBusy(true); const b = new FormData(); b.append("entity", entity); b.append("file", f);
    const r = await fetch("/api/attachments", { method: "POST", body: b });
    setBusy(false); if (file.current) file.current.value = ""; if (r.ok) load();
  }
  return (
    <div className="notes-grid">
      <div className="card">
        <div className="hdr" style={{ margin: "0 0 10px" }}><MessageSquare size={16} /><b>Notes</b><span className="mute">{notes?.length ?? 0}</span></div>
        {canEdit && <div className="cp-input" style={{ marginBottom: 12 }}>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note: what you checked, who you called, what you found…" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add(); }} />
          <button className="btn icon-send" onClick={add} disabled={busy || !text.trim()} aria-label="Add note"><Send size={16} /></button>
        </div>}
        {!notes ? <Skel h={60} /> : !notes.length ? <p className="mute" style={{ margin: 0 }}>No notes yet.</p> : (
          <ul className="note-list">{[...notes].reverse().map((n) => <li key={n.id}><span className="avatar sm">{n.by[0]?.toUpperCase()}</span><div><b>{n.by}</b> <span className="mute">{ago(n.at)}</span><p>{n.text}</p></div></li>)}</ul>
        )}
      </div>
      <div className="card">
        <div className="hdr" style={{ margin: "0 0 10px" }}><Paperclip size={16} /><b>Attachments</b><span className="mute">{files?.length ?? 0}</span>
          {canEdit && <><input ref={file} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} accept=".pdf,.png,.jpg,.jpeg,.gif,.txt,.csv,.xls,.xlsx,.doc,.docx,.eml,.msg,.json,.zip" />
            <button className="ico-btn" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => file.current?.click()}><Paperclip size={14} /> Attach file</button></>}</div>
        {!files ? <Skel h={60} /> : !files.length ? <p className="mute" style={{ margin: 0 }}>No files. PDF, images, Office, CSV, EML up to 5 MB.</p> : (
          <ul className="file-list">{files.map((f) => <li key={f.id}><a href={`/api/attachments/${f.id}`} download><Download size={14} /> {f.name}</a><span className="mute">{size(f.size)} · {f.by} · {ago(f.at)}</span></li>)}</ul>
        )}
      </div>
    </div>
  );
}
