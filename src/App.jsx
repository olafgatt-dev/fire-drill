import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  "Brands", "Business", "Credit", "Customer Care", "ESG",
  "Finance", "Management", "Marketing", "PSG", "Retail", "Technical",
];

const STATUS_META = {
  unaccounted: { icon: "?", label: "Unaccounted", bg: "#64748b", ring: "#94a3b8", text: "#f8fafc" },
  present:     { icon: "✓", label: "Present",     bg: "#16a34a", ring: "#4ade80", text: "#f0fdf4" },
  missing:     { icon: "✗", label: "Missing",     bg: "#dc2626", ring: "#f87171", text: "#fff1f2" },
  excused:     { icon: "∅", label: "Off-site",    bg: "#d97706", ring: "#fbbf24", text: "#fffbeb" },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function calcStats(empList, att) {
  const counts = { total: empList.length, present: 0, missing: 0, excused: 0, unaccounted: 0 };
  empList.forEach(e => { counts[att[e.id]?.status || "unaccounted"]++; });
  return counts;
}

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function elapsed(startIso, endIso) {
  if (!startIso) return "0m 0s";
  const secs = Math.floor((new Date(endIso || Date.now()).getTime() - new Date(startIso).getTime()) / 1000);
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}m ${s}s`;
}

function initials(name) {
  return (name || "").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; }
  button { font-family: inherit; cursor: pointer; }
  input, select, textarea { font-family: inherit; outline: none; }
  .inp:focus { border-color: #f97316 !important; }
  .inp-light:focus { border-color: #2563eb !important; }
  .emp-row { transition: box-shadow .15s; }
  .emp-row:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.1) !important; }
  @keyframes syncFlash { 0%{opacity:0;transform:scale(0.7)} 100%{opacity:1;transform:scale(1)} }
  .sync-anim { animation: syncFlash .4s ease; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  .fade-in { animation: fadeIn .2s ease; }
  @keyframes slideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
  .slide-up { animation: slideUp .2s ease; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .pulse { animation: pulse 1.2s ease infinite; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
`;

// ─── CONNECTION BAR ───────────────────────────────────────────────────────────

function ConnBar({ status }) {
  if (status === "online") return null;
  const cfg = status === "offline"
    ? { bg: "#450a0a", border: "#dc2626", dot: "#f87171", label: "⚠ No connection — reconnecting in background", pulse: false }
    : { bg: "#1e3a5f", border: "#2563eb", dot: "#60a5fa", label: "↻ Back online — syncing latest data…", pulse: true };
  return (
    <div style={{ background: cfg.bg, borderBottom: `2px solid ${cfg.border}`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "white", fontWeight: 700, position: "sticky", top: 0, zIndex: 100, letterSpacing: "0.01em" }}>
      <div className={cfg.pulse ? "pulse" : ""} style={{ width: 10, height: 10, borderRadius: "50%", background: cfg.dot, flexShrink: 0 }} />
      {cfg.label}
    </div>
  );
}

// ─── EMPLOYEE ROW ─────────────────────────────────────────────────────────────

function EmpRow({ emp, rec, onStatus, onNote, disabled, offline }) {
  const status = rec?.status || "unaccounted";
  const sm = STATUS_META[status];
  const hasNote = !!rec?.note;

  // When offline: allow present/excused freely (optimistic), block moving TO missing
  // (marking someone missing offline could overwrite a "found" update from someone else)
  const canChange = (toStatus) => {
    if (disabled) return false;
    if (!offline) return true;
    return toStatus !== "missing";
  };

  return (
    <div className="emp-row fade-in" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7, background: "white", borderRadius: 12, padding: "10px 12px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: status === "missing" ? "2px solid #fca5a5" : "2px solid transparent", opacity: offline ? 0.75 : 1 }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, background: sm.bg, color: sm.text, fontSize: 20, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 0 0 3px ${sm.ring}33` }}>
        {sm.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{emp.name}</span>
          {emp.is_marshal && <span style={{ background: "#fff7ed", color: "#c2410c", borderRadius: 4, padding: "1px 5px", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>🧑‍🚒</span>}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 1, display: "flex", alignItems: "center", gap: 5 }}>
          {emp.dept || "—"}
          {emp.is_temp && <span style={{ background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "1px 5px", fontSize: 10, fontWeight: 700 }}>TEMP</span>}
        </div>
        {hasNote && (
          <div style={{ fontSize: 11, color: "#78350f", background: "#fef3c7", borderRadius: 5, padding: "2px 7px", marginTop: 3, display: "inline-flex", gap: 3 }}>
            <span>📝</span><span>{rec.note}</span>
          </div>
        )}
        {rec?.marshal_name && (
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
            {rec.marshal_name} · {rec.updated_at ? new Date(rec.updated_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {["present", "missing", "excused"].map(s => {
            const ok = canChange(s);
            const active = status === s;
            const colors = { present: { on: "#16a34a", off: "#f0fdf4", border: "#86efac", text: "#16a34a" }, missing: { on: "#dc2626", off: "#fef2f2", border: "#fca5a5", text: "#dc2626" }, excused: { on: "#d97706", off: "#fffbeb", border: "#fcd34d", text: "#d97706" } }[s];
            const icons = { present: "✓", missing: "✗", excused: "∅" };
            return (
              <button key={s} onClick={() => ok && onStatus(emp.id, s)}
                style={{ width: 36, height: 36, borderRadius: 8, background: active ? colors.on : colors.off, border: `2px solid ${active ? colors.on : colors.border}`, color: active ? "white" : colors.text, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", cursor: ok ? "pointer" : "default", opacity: ok || active ? 1 : 0.3, transition: "opacity .15s" }}>
                {icons[s]}
              </button>
            );
          })}
        </div>
        <button onClick={() => !disabled && !offline && onNote(emp.id, rec?.note)}
          style={{ background: hasNote ? "#fef3c7" : "#f8fafc", border: `1px solid ${hasNote ? "#fcd34d" : "#e2e8f0"}`, borderRadius: 6, padding: "3px 8px", fontSize: 11, color: hasNote ? "#92400e" : "#94a3b8", fontWeight: 600, cursor: (disabled || offline) ? "default" : "pointer", opacity: offline ? 0.4 : 1 }}>
          📝 {hasNote ? "Edit" : "Note"}
        </button>
      </div>
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {

  // ── Navigation ────────────────────────────────────────────────────────────
  const [page, setPage] = useState("setup");

  useEffect(() => {
    window.history.replaceState({ page: "setup" }, "");
    const handlePop = () => setPage(window.history.state?.page || "setup");
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const navigate = (newPage) => {
    window.history.pushState({ page: newPage }, "");
    setPage(newPage);
  };

  // ── Identity ──────────────────────────────────────────────────────────────
  const [myMarshal, setMyMarshal] = useState(null);

  // ── Employees ─────────────────────────────────────────────────────────────
  const [employees, setEmployees] = useState([]);
  const [newEmp, setNewEmp]       = useState({ name: "", dept: "", marshal_id: "", is_marshal: false });
  const [empSearch, setEmpSearch] = useState("");
  const [editEmp, setEditEmp]     = useState(null);

  // ── Sessions ──────────────────────────────────────────────────────────────
  const [sessions, setSessions]             = useState([]);
  const [session, setSession]               = useState(null);
  const [activeSessions, setActiveSessions] = useState([]);

  // ── Attendance ────────────────────────────────────────────────────────────
  const [att, setAtt] = useState({});

  // ── UI ────────────────────────────────────────────────────────────────────
  const [tab, setTab]                     = useState("mine");
  const [search, setSearch]               = useState("");
  const [noteFor, setNoteFor]             = useState(null);
  const [noteText, setNoteText]           = useState("");
  const [elapsedStr, setElapsedStr]       = useState("0m 0s");
  const [syncPulse, setSyncPulse]         = useState(false);
  const [loading, setLoading]             = useState(true);
  const [dbReady, setDbReady]             = useState(false);
  const [confirmStop, setConfirmStop]     = useState(false);
  const [showSwitcher, setShowSwitcher]   = useState(false);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [connStatus, setConnStatus]       = useState("online"); // "online" | "offline" | "syncing"
  const [, setTick]                       = useState(0);

  // ── Derived ───────────────────────────────────────────────────────────────
  const marshals = employees.filter(e => e.is_marshal && !e.is_temp);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: eData, error: eErr } = await supabase.from("employees").select("*").order("name");
        if (eErr) { console.error(eErr.message); setLoading(false); return; }
        setDbReady(true);
        setEmployees(eData || []);
        const { data: sData } = await supabase
          .from("drill_sessions").select("*").order("started_at", { ascending: false }).limit(50);
        setSessions(sData || []);
        setActiveSessions((sData || []).filter(s => s.active));
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  // ── Elapsed timer (drill page) ────────────────────────────────────────────
  useEffect(() => {
    if (!session?.active) return;
    const t = setInterval(() => setElapsedStr(elapsed(session.started_at)), 1000);
    return () => clearInterval(t);
  }, [session]);

  // ── Tick (setup page live timers) ─────────────────────────────────────────
  useEffect(() => {
    if (activeSessions.length === 0) return;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [activeSessions.length]);

  // ── Load attendance ───────────────────────────────────────────────────────
  const loadAttendance = useCallback(async (sessionId) => {
    const { data } = await supabase.from("attendance").select("*").eq("session_id", sessionId);
    if (data) {
      const map = {};
      data.forEach(r => { map[r.employee_id] = r; });
      setAtt(map);
    }
  }, []);

  // ── Connection status ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.onLine) setConnStatus("offline");

    const goOffline = () => setConnStatus("offline");
    const goOnline  = async () => {
      setConnStatus("syncing");
      try {
        if (session) {
          const { data: sData } = await supabase.from("drill_sessions").select("*").eq("id", session.id).single();
          if (sData) setSession(sData);
          await loadAttendance(session.id);
        }
        const { data: aData } = await supabase.from("drill_sessions").select("*").eq("active", true);
        if (aData) setActiveSessions(aData);
      } catch (e) { console.error(e); }
      setConnStatus("online");
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online",  goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online",  goOnline);
    };
  }, [session?.id, loadAttendance]);

  // ── Real-time: attendance ─────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    const attCh = supabase.channel("att-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance", filter: `session_id=eq.${session.id}` },
        payload => {
          if (payload.eventType === "DELETE") return;
          setSyncPulse(true); setTimeout(() => setSyncPulse(false), 600);
          setAtt(prev => ({ ...prev, [payload.new.employee_id]: payload.new }));
        })
      .subscribe();
    const sessCh = supabase.channel("sess-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "drill_sessions", filter: `id=eq.${session.id}` },
        payload => {
          setSession(payload.new);
          if (!payload.new.active) {
            setActiveSessions(prev => prev.filter(s => s.id !== payload.new.id));
            setSessions(prev => prev.map(s => s.id === payload.new.id ? payload.new : s));
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(attCh); supabase.removeChannel(sessCh); };
  }, [session?.id]);

  // ── Real-time: new sessions ───────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel("new-sess-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "drill_sessions" },
        payload => {
          if (payload.new.active) {
            setActiveSessions(prev => prev.find(s => s.id === payload.new.id) ? prev : [payload.new, ...prev]);
            setSessions(prev => prev.find(s => s.id === payload.new.id) ? prev : [payload.new, ...prev]);
          }
        })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // ── Start drill ───────────────────────────────────────────────────────────
  const startDrill = async () => {
    if (!myMarshal) return;
    const { data, error } = await supabase
      .from("drill_sessions").insert({ started_by: myMarshal.name, active: true }).select().single();
    if (error || !data) return;
    setSession(data);
    setActiveSessions(prev => [data, ...prev]);
    setSessions(prev => [data, ...prev]);
    setAtt({}); setSearch(""); setTab("mine"); navigate("drill");
  };

  // ── Join session ──────────────────────────────────────────────────────────
  const joinSession = async (sess) => {
    setSession(sess);
    await loadAttendance(sess.id);
    setSearch(""); setTab("mine"); navigate("drill");
  };

  // ── Switch session ────────────────────────────────────────────────────────
  const switchSession = async (sess) => {
    setSession(sess); setAtt({});
    await loadAttendance(sess.id);
    setSearch(""); setShowSwitcher(false); setTab("mine");
  };

  // ── Stop drill ────────────────────────────────────────────────────────────
  const stopDrill = async () => {
    if (!session) return;
    const { data } = await supabase
      .from("drill_sessions")
      .update({ active: false, ended_at: new Date().toISOString(), ended_by: myMarshal?.name })
      .eq("id", session.id).select().single();
    if (data) {
      setSession(data);
      setActiveSessions(prev => prev.filter(s => s.id !== data.id));
      setSessions(prev => prev.map(s => s.id === data.id ? data : s));
    }
    setConfirmStop(false);
  };

  // ── Delete session ────────────────────────────────────────────────────────
  const deleteSession = async (id) => {
    await supabase.from("drill_sessions").delete().eq("id", id);
    setSessions(prev => prev.filter(s => s.id !== id));
    setActiveSessions(prev => prev.filter(s => s.id !== id));
  };

  // ── Upsert attendance ─────────────────────────────────────────────────────
  const upsertAtt = useCallback(async (employeeId, updates) => {
    if (!session) return;
    const existing = att[employeeId];
    const row = {
      session_id: session.id,
      employee_id: employeeId,
      marshal_name: myMarshal?.name,
      updated_at: new Date().toISOString(),
      status: existing?.status || "unaccounted",
      note: existing?.note || null,
      ...updates,
    };
    // Optimistic update — apply immediately so UI responds even when offline
    setAtt(prev => ({ ...prev, [employeeId]: { ...prev[employeeId], ...row } }));
    if (!navigator.onLine) return; // skip DB write, will sync on reconnect
    const { data, error } = await supabase
      .from("attendance").upsert(row, { onConflict: "session_id,employee_id" }).select().single();
    if (!error && data) setAtt(prev => ({ ...prev, [employeeId]: data }));
  }, [session, myMarshal, att]);

  const setStatus = (id, newStatus) => {
    const current = att[id]?.status || "unaccounted";
    upsertAtt(id, { status: current === newStatus ? "unaccounted" : newStatus });
  };

  const saveNote = async () => {
    if (!noteFor) return;
    await upsertAtt(noteFor, { note: noteText });
    setNoteFor(null); setNoteText("");
  };

  // ── Add employee ──────────────────────────────────────────────────────────
  const addEmployee = async () => {
    if (!newEmp.name.trim()) return;
    const { data } = await supabase.from("employees").insert({
      name: newEmp.name.trim(),
      dept: newEmp.dept || null,
      marshal_id: newEmp.marshal_id || null,
      is_marshal: newEmp.is_marshal,
    }).select().single();
    if (data) setEmployees(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewEmp({ name: "", dept: "", marshal_id: "", is_marshal: false });
  };

  // ── Update employee ───────────────────────────────────────────────────────
  const updateEmployee = async (id, updates) => {
    const { data } = await supabase.from("employees").update(updates).eq("id", id).select().single();
    if (data) {
      setEmployees(prev => prev.map(e => e.id === id ? data : e));
      if (myMarshal?.id === id) setMyMarshal(data);
      if (editEmp?.id === id) setEditEmp(data);
    }
  };

  // ── Remove employee ───────────────────────────────────────────────────────
  const removeEmployee = async (id) => {
    await supabase.from("employees").delete().eq("id", id);
    setEmployees(prev => prev.filter(e => e.id !== id));
    if (myMarshal?.id === id) setMyMarshal(null);
  };

  // ── Add temp person ───────────────────────────────────────────────────────
  const addTempPerson = async () => {
    if (!newPersonName.trim() || !myMarshal) return;
    const { data } = await supabase.from("employees").insert({
      name: newPersonName.trim(),
      dept: null,
      marshal_id: myMarshal.id,
      is_marshal: false,
      is_temp: true,
      created_in_session: session.id,
    }).select().single();
    if (data) setEmployees(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewPersonName(""); setShowAddPerson(false);
  };

  // ── Print report ──────────────────────────────────────────────────────────
  const handlePrint = () => {
    const printEmps = employees.filter(e => !e.is_temp || e.created_in_session === session?.id);
    const allStats = calcStats(printEmps, att);
    const now = new Date();
    const lines = [
      "FIRE EVACUATION DRILL – HEADCOUNT REPORT",
      "==========================================",
      `Date:          ${fmtDate(now.toISOString())}`,
      `Report time:   ${fmtTime(now.toISOString())}`,
      `Drill started: ${fmtTime(session?.started_at)}  by  ${session?.started_by || "—"}`,
      session?.ended_at
        ? `Drill ended:   ${fmtTime(session.ended_at)}  by  ${session?.ended_by || "—"}`
        : `Status:        ONGOING`,
      `Duration:      ${elapsed(session?.started_at, session?.ended_at)}`,
      "",
      "── OVERALL SUMMARY ──────────────────────",
      `  Total staff    : ${allStats.total}`,
      `  ✓ Present      : ${allStats.present}`,
      `  ✗ Missing      : ${allStats.missing}`,
      `  ∅ Off-site     : ${allStats.excused}`,
      `  ? Unaccounted  : ${allStats.unaccounted}`,
      "",
    ];
    marshals.forEach(marshal => {
      const party = printEmps.filter(e => e.marshal_id === marshal.id);
      if (party.length === 0) return;
      const s = calcStats(party, att);
      lines.push(`── ${marshal.name.toUpperCase()} ${"─".repeat(Math.max(0, 44 - marshal.name.length))}`);
      lines.push(`  Present: ${s.present}  Missing: ${s.missing}  Off-site: ${s.excused}  Unaccounted: ${s.unaccounted}`);
      party.forEach(e => {
        const r = att[e.id]; const st = r?.status || "unaccounted";
        const note = r?.note ? `  [${r.note}]` : "";
        const by   = r?.marshal_name ? `  (${r.marshal_name})` : "";
        const temp = e.is_temp ? "  [TEMP]" : "";
        const ts   = r?.updated_at && st !== "unaccounted" ? `  @ ${fmtTime(r.updated_at)}` : "";
        lines.push(`  ${STATUS_META[st].icon} ${e.name.padEnd(22)} ${(e.dept || "").padEnd(16)}${temp}${ts}${note}${by}`);
      });
      lines.push("");
    });
    const unassigned = printEmps.filter(e => !e.marshal_id);
    if (unassigned.length > 0) {
      lines.push(`── UNASSIGNED ────────────────────────────────`);
      unassigned.forEach(e => {
        const r = att[e.id]; const st = r?.status || "unaccounted";
        const ts = r?.updated_at && st !== "unaccounted" ? `  @ ${fmtTime(r.updated_at)}` : "";
        lines.push(`  ${STATUS_META[st].icon} ${e.name.padEnd(22)} ${e.dept || ""}${e.is_temp ? "  [TEMP]" : ""}${ts}`);
      });
      lines.push("");
    }
    if (allStats.missing > 0) {
      lines.push("⚠  MISSING PERSONS – ACTION REQUIRED ─────────");
      printEmps.filter(e => att[e.id]?.status === "missing").forEach(e => {
        const marshal = employees.find(m => m.id === e.marshal_id);
        const r = att[e.id];
        const n = r?.note;
        const ts = r?.updated_at ? `  |  Marked @ ${fmtTime(r.updated_at)}` : "";
        lines.push(`  ✗ ${e.name}  |  ${e.dept || "—"}  |  Marshal: ${marshal?.name || "Unassigned"}${ts}${n ? `  |  Note: ${n}` : ""}`);
      });
    }
    const html = `<html><head><title>Fire Drill Report</title>
<style>@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono&display=swap');
body{font-family:'JetBrains Mono',monospace;padding:32px;font-size:13px;line-height:1.6;white-space:pre;color:#1e293b}
@media print{body{padding:16px;font-size:11px}}</style>
</head><body>${lines.join("\n")}</body></html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.setTimeout(() => w.print(), 400);
  };

  // ─── COMPUTED ─────────────────────────────────────────────────────────────

  const offline      = connStatus === "offline";
  const drillEmps    = employees.filter(e => !e.is_temp || e.created_in_session === session?.id);
  const myParty      = myMarshal ? drillEmps.filter(e => e.marshal_id === myMarshal.id) : [];
  const allStats     = calcStats(drillEmps, att);
  const myStats      = calcStats(myParty, att);
  const allOK        = allStats.total > 0 && allStats.unaccounted === 0 && allStats.missing === 0;
  const hasMiss      = allStats.missing > 0;
  const drillEnded   = session && !session.active;
  const pastSessions = sessions.filter(s => !s.active);
  const otherActive  = activeSessions.filter(s => s.id !== session?.id);

  const visEmps = (() => {
    const base = tab === "mine" ? myParty : drillEmps;
    const q = search.trim().toLowerCase();
    const filtered = q ? base.filter(e => e.name.toLowerCase().includes(q) || e.dept?.toLowerCase().includes(q)) : base;
    return filtered.sort((a, b) => {
      const priority = { unaccounted: 0, missing: 1, present: 2, excused: 2 };
      const aP = priority[att[a.id]?.status || "unaccounted"];
      const bP = priority[att[b.id]?.status || "unaccounted"];
      if (aP !== bP) return aP - bP;
      return a.name.localeCompare(b.name);
    });
  })();

  // ─── LOADING ──────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
      <style>{CSS}</style>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🚨</div>
      <div style={{ color: "#94a3b8", fontSize: 14 }}>Connecting…</div>
    </div>
  );

  if (!dbReady) return (
    <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", padding: 24 }}>
      <style>{CSS}</style>
      <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
      <div style={{ color: "#f87171", fontWeight: 700, marginBottom: 8 }}>Database not connected</div>
      <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center" }}>Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.</div>
    </div>
  );

  // ─── EMPLOYEE MANAGEMENT PAGE ─────────────────────────────────────────────

  if (page === "employees") return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#0f172a,#1e293b)", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{CSS}</style>
      <ConnBar status={connStatus} />
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 40px" }}>

        <div style={{ padding: "16px 0 12px", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate("setup")} style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#94a3b8", borderRadius: 8, padding: "6px 12px", fontSize: 13 }}>← Back</button>
          <div style={{ color: "white", fontWeight: 800, fontSize: 18 }}>👥 Staff</div>
          <div style={{ marginLeft: "auto", color: "#475569", fontSize: 13 }}>
            {employees.filter(e => !e.is_temp).length} employees · {marshals.length} marshals
          </div>
        </div>

        <input className="inp" placeholder="🔍 Search…" value={empSearch} onChange={e => setEmpSearch(e.target.value)}
          style={{ width: "100%", padding: "10px 14px", borderRadius: 9, border: "1.5px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.06)", color: "white", fontSize: 14, marginBottom: 12 }} />

        <div style={{ maxHeight: 420, overflowY: "auto", marginBottom: 16 }}>
          {employees
            .filter(e => !e.is_temp && (!empSearch || e.name.toLowerCase().includes(empSearch.toLowerCase()) || e.dept?.toLowerCase().includes(empSearch.toLowerCase())))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(emp => {
              const assignedMarshal = employees.find(m => m.id === emp.marshal_id);
              return (
                <div key={emp.id} className="fade-in" style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 12px", marginBottom: 6, border: `1px solid ${emp.is_marshal ? "rgba(249,115,22,0.25)" : "rgba(255,255,255,0.06)"}`, gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: emp.is_marshal ? "linear-gradient(135deg,#dc2626,#f97316)" : "rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", color: emp.is_marshal ? "white" : "#64748b", fontWeight: 800, fontSize: 12, flexShrink: 0 }}>
                    {initials(emp.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "white", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{emp.name}</span>
                      {emp.is_marshal && <span style={{ background: "rgba(249,115,22,0.2)", color: "#f97316", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>MARSHAL</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>
                      {emp.dept || "No dept"}
                      {assignedMarshal && <span> · <span style={{ color: "#f97316" }}>→ {assignedMarshal.name}</span></span>}
                    </div>
                  </div>
                  <button onClick={() => setEditEmp(emp)}
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", borderRadius: 7, padding: "5px 9px", fontSize: 12, flexShrink: 0 }}>Edit</button>
                  <button onClick={() => { if (window.confirm(`Remove ${emp.name}?`)) removeEmployee(emp.id); }}
                    style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", borderRadius: 7, padding: "5px 9px", fontSize: 12, flexShrink: 0 }}>✕</button>
                </div>
              );
            })}
        </div>

        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: 16, border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>Add Employee</div>
          <input className="inp" value={newEmp.name} onChange={e => setNewEmp(p => ({...p, name: e.target.value}))} placeholder="Full name"
            onKeyDown={e => e.key === "Enter" && addEmployee()}
            style={{ width: "100%", padding: "10px 12px", border: "1.5px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", borderRadius: 8, fontSize: 14, color: "white", marginBottom: 8 }} />
          <select value={newEmp.dept} onChange={e => setNewEmp(p => ({...p, dept: e.target.value}))}
            style={{ width: "100%", padding: "10px 12px", border: "1.5px solid rgba(255,255,255,0.1)", background: "#1e293b", borderRadius: 8, fontSize: 14, color: newEmp.dept ? "white" : "#64748b", marginBottom: 8 }}>
            <option value="">Select department…</option>
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={newEmp.marshal_id} onChange={e => setNewEmp(p => ({...p, marshal_id: e.target.value}))}
            style={{ width: "100%", padding: "10px 12px", border: "1.5px solid rgba(255,255,255,0.1)", background: "#1e293b", borderRadius: 8, fontSize: 14, color: newEmp.marshal_id ? "white" : "#64748b", marginBottom: 8 }}>
            <option value="">Assign to marshal (optional)…</option>
            {marshals.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button onClick={() => setNewEmp(p => ({...p, is_marshal: !p.is_marshal}))}
            style={{ width: "100%", padding: "10px 12px", border: `1.5px solid ${newEmp.is_marshal ? "#f97316" : "rgba(255,255,255,0.1)"}`, background: newEmp.is_marshal ? "rgba(249,115,22,0.15)" : "rgba(255,255,255,0.05)", borderRadius: 8, fontSize: 14, color: newEmp.is_marshal ? "#f97316" : "#64748b", fontWeight: 600, textAlign: "left", marginBottom: 12 }}>
            🧑‍🚒 {newEmp.is_marshal ? "Is a Fire Marshal ✓" : "Make a Fire Marshal?"}
          </button>
          <button onClick={addEmployee} style={{ width: "100%", padding: 11, background: "#2563eb", color: "white", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 15 }}>Add Employee</button>
        </div>
      </div>

      {/* Edit sheet */}
      {editEmp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={() => setEditEmp(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#1e293b", width: "100%", maxWidth: 480, margin: "0 auto", padding: "20px 20px 36px", borderRadius: "20px 20px 0 0", boxShadow: "0 -8px 32px rgba(0,0,0,0.4)" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", margin: "0 auto 16px" }} />
            <div style={{ fontWeight: 800, fontSize: 16, color: "white", marginBottom: 4 }}>✏️ Edit {editEmp.name}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>Changes save instantly</div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Role</div>
              <button onClick={() => updateEmployee(editEmp.id, { is_marshal: !editEmp.is_marshal })}
                style={{ width: "100%", padding: "11px 14px", border: `1.5px solid ${editEmp.is_marshal ? "#f97316" : "rgba(255,255,255,0.1)"}`, background: editEmp.is_marshal ? "rgba(249,115,22,0.15)" : "rgba(255,255,255,0.05)", borderRadius: 9, fontSize: 14, color: editEmp.is_marshal ? "#f97316" : "#94a3b8", fontWeight: 600, textAlign: "left" }}>
                🧑‍🚒 {editEmp.is_marshal ? "Fire Marshal — tap to demote" : "Not a marshal — tap to promote"}
              </button>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Department</div>
              <select value={editEmp.dept || ""} onChange={e => updateEmployee(editEmp.id, { dept: e.target.value || null })}
                style={{ width: "100%", padding: "10px 12px", border: "1.5px solid rgba(255,255,255,0.1)", background: "#0f172a", borderRadius: 8, fontSize: 14, color: editEmp.dept ? "white" : "#64748b" }}>
                <option value="">No department</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Assigned Marshal</div>
              <select value={editEmp.marshal_id || ""} onChange={e => updateEmployee(editEmp.id, { marshal_id: e.target.value || null })}
                style={{ width: "100%", padding: "10px 12px", border: "1.5px solid rgba(255,255,255,0.1)", background: "#0f172a", borderRadius: 8, fontSize: 14, color: editEmp.marshal_id ? "white" : "#64748b" }}>
                <option value="">Unassigned</option>
                {marshals.filter(m => m.id !== editEmp.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button onClick={() => setEditEmp(null)}
              style={{ width: "100%", padding: 13, background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 10, fontSize: 15, color: "white", fontWeight: 600 }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );

  // ─── PAST SESSIONS PAGE ───────────────────────────────────────────────────

  if (page === "sessions") return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#0f172a,#1e293b)", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{CSS}</style>
      <ConnBar status={connStatus} />
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 40px" }}>
        <div style={{ padding: "16px 0 12px", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate("setup")} style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#94a3b8", borderRadius: 8, padding: "6px 12px", fontSize: 13 }}>← Back</button>
          <div style={{ color: "white", fontWeight: 800, fontSize: 18 }}>📋 Drill History</div>
          <div style={{ marginLeft: "auto", color: "#475569", fontSize: 13 }}>{pastSessions.length} sessions</div>
        </div>
        {pastSessions.length === 0 && (
          <div style={{ textAlign: "center", color: "#475569", padding: "60px 20px", fontSize: 14 }}>No completed drills yet.</div>
        )}
        {pastSessions.map(s => (
          <div key={s.id} className="fade-in" style={{ background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: "14px 16px", marginBottom: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <div style={{ color: "white", fontWeight: 700, fontSize: 15 }}>{fmtDate(s.started_at)}</div>
                <div style={{ color: "#475569", fontSize: 12, marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
                  {fmtTime(s.started_at)} → {s.ended_at ? fmtTime(s.ended_at) : "—"}
                </div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#94a3b8", fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
                {elapsed(s.started_at, s.ended_at)}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "#64748b", marginBottom: 14 }}>
              <span>🚨 Started by <span style={{ color: "#94a3b8" }}>{s.started_by}</span></span>
              {s.ended_by
                ? <span>⏹ Ended by <span style={{ color: "#94a3b8" }}>{s.ended_by}</span></span>
                : <span style={{ color: "#d97706" }}>⚠ No end time recorded</span>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setSession(s); loadAttendance(s.id).then(() => { setTab("all"); navigate("drill"); }); }}
                style={{ flex: 1, padding: "10px 0", background: "#1e3a5f", border: "1px solid #2563eb55", color: "#60a5fa", borderRadius: 9, fontSize: 13, fontWeight: 600 }}>
                👁 View Report
              </button>
              <button onClick={() => { if (window.confirm(`Delete drill from ${fmtDate(s.started_at)} at ${fmtTime(s.started_at)}?\n\nThis will permanently remove all attendance records.`)) deleteSession(s.id); }}
                style={{ width: 48, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", borderRadius: 9, fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ─── SETUP PAGE ───────────────────────────────────────────────────────────

  if (page === "setup") return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#0f172a 0%,#1e293b 100%)", fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <style>{CSS}</style>
      <ConnBar status={connStatus} />
      <div style={{ width: "100%", maxWidth: 480, padding: "28px 16px 40px", opacity: offline ? 0.6 : 1, transition: "opacity .3s" }}>

        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 48, marginBottom: 6 }}>🚨</div>
          <div style={{ color: "#f97316", fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 2 }}>Emergency System</div>
          <div style={{ color: "white", fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px" }}>Fire Drill</div>
          <div style={{ color: "#475569", fontSize: 13, marginTop: 3 }}>Headcount &amp; Muster</div>
        </div>

        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: 16, marginBottom: 12, border: "1px solid rgba(255,255,255,0.08)" }}>
          <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", display: "block", marginBottom: 10 }}>I am…</label>
          {marshals.length === 0 && (
            <div style={{ color: "#475569", fontSize: 13, padding: "10px 0" }}>No marshals set up yet. Go to Staff and mark employees as marshals.</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {marshals.map(m => {
              const sel = myMarshal?.id === m.id;
              const partyCount = employees.filter(e => e.marshal_id === m.id && !e.is_temp).length;
              return (
                <button key={m.id} onClick={() => setMyMarshal(m)}
                  style={{ display: "flex", alignItems: "center", padding: "12px 14px", borderRadius: 10, border: `2px solid ${sel ? "#dc2626" : "rgba(255,255,255,0.07)"}`, background: sel ? "rgba(220,38,38,0.12)" : "rgba(255,255,255,0.03)", textAlign: "left", transition: "all .15s" }}>
                  <div style={{ width: 38, height: 38, borderRadius: 9, background: sel ? "linear-gradient(135deg,#dc2626,#f97316)" : "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", color: sel ? "white" : "#64748b", fontWeight: 800, fontSize: 13, marginRight: 12, flexShrink: 0 }}>
                    {initials(m.name)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: sel ? "white" : "#cbd5e1", fontWeight: 600, fontSize: 15 }}>{m.name}</div>
                    <div style={{ color: "#475569", fontSize: 11, marginTop: 1 }}>
                      {m.dept ? `${m.dept} · ` : ""}Party of {partyCount}
                    </div>
                  </div>
                  {sel && <div style={{ color: "#f97316", fontSize: 20 }}>✓</div>}
                </button>
              );
            })}
          </div>
        </div>

        {activeSessions.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
              ⚡ {activeSessions.length} Active Drill{activeSessions.length > 1 ? "s" : ""}
            </div>
            {activeSessions.map(s => (
              <div key={s.id} style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 12, padding: "11px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#fbbf24", fontSize: 13, fontWeight: 700 }}>Started by {s.started_by}</div>
                  <div style={{ color: "#92400e", fontSize: 11, marginTop: 1, fontFamily: "'DM Mono', monospace" }}>{fmtTime(s.started_at)} · {elapsed(s.started_at)}</div>
                </div>
                <button onClick={() => !offline && joinSession(s)} disabled={!myMarshal}
                  style={{ padding: "8px 14px", background: myMarshal ? "#d97706" : "#374151", color: "white", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, opacity: myMarshal ? 1 : 0.5, flexShrink: 0 }}>
                  Join
                </button>
              </div>
            ))}
          </div>
        )}

        <button onClick={() => !offline && startDrill()} disabled={!myMarshal}
          style={{ width: "100%", padding: 14, background: myMarshal ? "#dc2626" : "#1e293b", color: "white", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 800, marginBottom: 12, transition: "all .15s", opacity: myMarshal ? 1 : 0.5, boxShadow: myMarshal ? "0 4px 20px rgba(220,38,38,0.35)" : "none" }}>
          🚨 Start {activeSessions.length > 0 ? "Another" : "Fire"} Drill
        </button>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setEmpSearch(""); navigate("employees"); }}
            style={{ flex: 1, padding: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "#64748b", borderRadius: 10, fontSize: 13 }}>
            👥 Staff
          </button>
          <button onClick={() => navigate("sessions")}
            style={{ flex: 1, padding: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "#64748b", borderRadius: 10, fontSize: 13, position: "relative" }}>
            📋 History
            {pastSessions.length > 0 && (
              <span style={{ position: "absolute", top: 6, right: 6, background: "#475569", color: "white", borderRadius: 10, fontSize: 10, padding: "1px 5px", fontWeight: 700 }}>
                {pastSessions.length}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  // ─── DRILL PAGE ───────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{CSS}</style>
      <ConnBar status={connStatus} />

      {/* TOP BAR */}
      <div style={{ background: drillEnded ? "#1e293b" : hasMiss ? "#991b1b" : allOK ? "#166534" : "#0f172a", padding: "10px 14px", position: "sticky", top: connStatus !== "online" ? 32 : 0, zIndex: 60, boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>🚨</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "white", fontWeight: 800, fontSize: 15 }}>{drillEnded ? "Drill Complete" : "Fire Drill Active"}</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {drillEnded ? `Ended ${fmtTime(session.ended_at)} · ${session.ended_by}` : `${elapsedStr} · ${session?.started_by}`}
            </div>
          </div>
          <div className={syncPulse ? "sync-anim" : ""} style={{ width: 8, height: 8, borderRadius: "50%", background: drillEnded ? "#475569" : "#4ade80", boxShadow: drillEnded ? "none" : "0 0 6px #4ade80", flexShrink: 0 }} />

          {otherActive.length > 0 && !drillEnded && (
            <button onClick={() => setShowSwitcher(v => !v)}
              style={{ background: showSwitcher ? "rgba(251,191,36,0.35)" : "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", borderRadius: 8, padding: "5px 9px", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              ⚡ {otherActive.length} other
            </button>
          )}

          <button onClick={() => {
            if (!drillEnded && !window.confirm("The drill is still in progress. Print a partial report anyway?")) return;
            handlePrint();
          }} style={{ background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.18)", color: "white", borderRadius: 8, padding: "6px 10px", fontSize: 13 }}>📋</button>

          <button onClick={() => { navigate("setup"); setSession(null); setAtt({}); setSearch(""); setShowSwitcher(false); }}
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "white", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <span style={{ fontSize: 14 }}>🏠</span>
            <span style={{ fontSize: 9, opacity: 0.7 }}>Home</span>
          </button>
        </div>

        {showSwitcher && (
          <div className="slide-up" style={{ background: "#1e293b", borderRadius: 10, border: "1px solid rgba(251,191,36,0.3)", padding: 8, marginBottom: 8 }}>
            <div style={{ color: "#64748b", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", padding: "2px 6px 6px" }}>Switch to another session</div>
            {otherActive.map(s => (
              <button key={s.id} onClick={() => switchSession(s)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 10px", background: "rgba(255,255,255,0.05)", border: "none", borderRadius: 8, marginBottom: 4, color: "white", textAlign: "left", cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.started_by}'s session</div>
                  <div style={{ fontSize: 11, color: "#64748b", fontFamily: "'DM Mono', monospace" }}>{fmtTime(s.started_at)} · running {elapsed(s.started_at)}</div>
                </div>
                <div style={{ color: "#fbbf24", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>Switch →</div>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {Object.entries(STATUS_META).map(([s, m]) => {
            const n = (tab === "mine" ? myStats : allStats)[s];
            if (s !== "present" && s !== "missing" && n === 0) return null;
            return (
              <div key={s} style={{ background: m.bg, color: m.text, padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 700, fontFamily: "'DM Mono', monospace", display: "flex", gap: 3 }}>
                <span>{m.icon}</span><span>{n}</span>
              </div>
            );
          })}
          <div style={{ marginLeft: "auto", color: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
            {(tab === "mine" ? myStats : allStats).present}/{(tab === "mine" ? myStats : allStats).total}
          </div>
        </div>

        {!drillEnded && hasMiss && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "6px 10px", marginTop: 8, fontSize: 12, fontWeight: 700, color: "#991b1b" }}>
            ⚠ {allStats.missing} PERSON{allStats.missing > 1 ? "S" : ""} MISSING — ALERT MANAGEMENT
          </div>
        )}
        {!drillEnded && allOK && (
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "6px 10px", marginTop: 8, fontSize: 12, fontWeight: 700, color: "#166534" }}>
            ✅ All staff accounted for
          </div>
        )}
        {drillEnded && (
          <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "6px 10px", marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
            📋 Completed drill · Duration: {elapsed(session.started_at, session.ended_at)}
          </div>
        )}
      </div>

      {/* TABS */}
      <div style={{ background: "white", display: "flex", borderBottom: "2px solid #e2e8f0" }}>
        {[
          { id: "mine", label: `My Party (${myParty.length})`, color: "#dc2626" },
          { id: "all",  label: `All Staff (${drillEmps.length})`, color: "#0f172a" },
        ].map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSearch(""); }}
            style={{ flex: 1, padding: "11px 14px", border: "none", borderBottom: tab === t.id ? `3px solid ${t.color}` : "3px solid transparent", background: "white", fontWeight: tab === t.id ? 700 : 400, color: tab === t.id ? t.color : "#64748b", fontSize: 14 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* SEARCH */}
      <div style={{ padding: "8px 10px", background: "white", borderBottom: "1px solid #f1f5f9" }}>
        <input className="inp-light" value={search} onChange={e => setSearch(e.target.value)} onFocus={() => setTab("all")} placeholder="🔍  Search by name or department…"
          style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15 }} />
      </div>

      {/* LEGEND */}
      <div style={{ padding: "5px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#94a3b8", overflowX: "auto" }}>
        {Object.entries(STATUS_META).map(([k, v]) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
            <span style={{ background: v.bg, color: v.text, width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>{v.icon}</span>
            <span>{v.label}</span>
          </span>
        ))}
      </div>

      {/* EMPLOYEE LIST */}
      <div style={{ padding: "8px 10px 110px", position: "relative", opacity: offline ? 0.75 : 1, transition: "opacity .3s" }}>
        {visEmps.length === 0 && (
          <div style={{ textAlign: "center", color: "#94a3b8", padding: "40px 20px", fontSize: 14 }}>
            {tab === "mine" && myParty.length === 0 ? "No employees assigned to your party yet." : "No employees found."}
          </div>
        )}
        {visEmps.map(emp => (
          <EmpRow key={emp.id} emp={emp} rec={att[emp.id]} onStatus={setStatus}
            onNote={(id, note) => { setNoteFor(id); setNoteText(note || ""); }} disabled={drillEnded} offline={offline} />
        ))}
      </div>

      {/* BOTTOM BAR */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "white", borderTop: "1px solid #e2e8f0", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, zIndex: 10, opacity: offline ? 0.7 : 1, transition: "opacity .3s" }}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: drillEnded ? "#64748b" : hasMiss ? "#dc2626" : allOK ? "#16a34a" : "#64748b" }}>
          {drillEnded ? "Drill Complete" : hasMiss ? `⚠ ${allStats.missing} MISSING` : allOK ? "✅ All Clear" : `${allStats.present}/${allStats.total} present`}
        </div>
        {!drillEnded && (
          <button onClick={() => { if (!offline) { setShowAddPerson(true); setNewPersonName(""); } }}
            style={{ background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, opacity: offline ? 0.4 : 1, cursor: offline ? "default" : "pointer" }}>
            + Person
          </button>
        )}
        <button onClick={() => {
          if (!drillEnded && !window.confirm("The drill is still in progress. Print a partial report anyway?")) return;
          handlePrint();
        }} style={{ background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>📋 Report</button>
        {!drillEnded && (
          <button onClick={() => { if (!offline) setConfirmStop(true); }} style={{ background: "#dc2626", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, opacity: offline ? 0.4 : 1, cursor: offline ? "default" : "pointer" }}>⏹ End Drill</button>
        )}
      </div>

      {/* STOP DRILL CONFIRM */}
      {confirmStop && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }} onClick={() => setConfirmStop(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 20, padding: "28px 24px", width: "100%", maxWidth: 360, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>⏹</div>
            <div style={{ fontWeight: 800, fontSize: 20, color: "#0f172a", marginBottom: 8 }}>End This Drill?</div>
            <div style={{ color: "#64748b", fontSize: 14, marginBottom: 12 }}>
              Only <strong>{session?.started_by}'s</strong> session will end. Other active sessions are unaffected.
            </div>
            {allStats.unaccounted > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 12px", marginBottom: 8, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
                ⚠ {allStats.unaccounted} people still unaccounted for
              </div>
            )}
            {allStats.missing > 0 && (
              <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", marginBottom: 8, fontSize: 13, color: "#991b1b", fontWeight: 700 }}>
                ✗ {allStats.missing} people marked MISSING
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setConfirmStop(false)} style={{ flex: 1, padding: 13, background: "#f1f5f9", border: "none", borderRadius: 10, fontSize: 15, color: "#64748b", fontWeight: 600 }}>Cancel</button>
              <button onClick={stopDrill} style={{ flex: 1, padding: 13, background: "#dc2626", color: "white", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 800 }}>End Drill</button>
            </div>
          </div>
        </div>
      )}

      {/* NOTE MODAL */}
      {noteFor && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={() => setNoteFor(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", width: "100%", padding: "20px 20px 36px", borderRadius: "20px 20px 0 0", boxShadow: "0 -8px 32px rgba(0,0,0,0.2)" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#e2e8f0", margin: "0 auto 16px" }} />
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: "#0f172a" }}>📝 Note for {employees.find(e => e.id === noteFor)?.name}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>e.g. "WFH today", "Annual leave", "Off-site meeting"</div>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a note…" autoFocus
              style={{ width: "100%", height: 90, padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 15, resize: "none", color: "#0f172a" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => { setNoteFor(null); setNoteText(""); }} style={{ flex: 1, padding: 13, background: "#f1f5f9", border: "none", borderRadius: 10, fontSize: 15, color: "#64748b", fontWeight: 600 }}>Cancel</button>
              <button onClick={saveNote} style={{ flex: 2, padding: 13, background: "#0f172a", color: "white", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 800 }}>Save Note</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD PERSON MODAL */}
      {showAddPerson && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={() => setShowAddPerson(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", width: "100%", padding: "20px 20px 36px", borderRadius: "20px 20px 0 0", boxShadow: "0 -8px 32px rgba(0,0,0,0.2)" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#e2e8f0", margin: "0 auto 16px" }} />
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: "#0f172a" }}>➕ Add Person</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>Assigned to your party · Flagged as temporary · Won't appear in future drills</div>
            <input value={newPersonName} onChange={e => setNewPersonName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addTempPerson()}
              placeholder="Full name…" autoFocus
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 15, color: "#0f172a", marginBottom: 10, outline: "none" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowAddPerson(false)} style={{ flex: 1, padding: 13, background: "#f1f5f9", border: "none", borderRadius: 10, fontSize: 15, color: "#64748b", fontWeight: 600 }}>Cancel</button>
              <button onClick={addTempPerson} style={{ flex: 2, padding: 13, background: "#0f172a", color: "white", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 800 }}>Add to Drill</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
