import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";

// ─── STATIC DATA ─────────────────────────────────────────────────────────────

const MUSTER_POINTS = [
  { id: "A", name: "Car Park North",  color: "#2563eb", light: "#dbeafe" },
  { id: "B", name: "Front Gate",      color: "#16a34a", light: "#dcfce7" },
  { id: "C", name: "Assembly Area 2", color: "#ea580c", light: "#ffedd5" },
];

const DEMO_EMPLOYEES = [
  { name: "Alice Johnson",  dept: "Finance",    point: "A" },
  { name: "Bob Smith",      dept: "Finance",    point: "A" },
  { name: "Carol White",    dept: "HR",         point: "A" },
  { name: "David Brown",    dept: "HR",         point: "A" },
  { name: "Karen Thomas",   dept: "Operations", point: "A" },
  { name: "Quinn Robinson", dept: "Legal",      point: "A" },
  { name: "Rachel Clark",   dept: "Legal",      point: "A" },
  { name: "Emma Davis",     dept: "IT",         point: "B" },
  { name: "Frank Miller",   dept: "IT",         point: "B" },
  { name: "Grace Wilson",   dept: "IT",         point: "B" },
  { name: "Henry Moore",    dept: "Sales",      point: "B" },
  { name: "Liam Jackson",   dept: "Operations", point: "B" },
  { name: "Mia Harris",     dept: "Operations", point: "B" },
  { name: "Noah Martin",    dept: "Marketing",  point: "B" },
  { name: "Iris Taylor",    dept: "Sales",      point: "C" },
  { name: "Jack Anderson",  dept: "Sales",      point: "C" },
  { name: "Olivia Garcia",  dept: "Marketing",  point: "C" },
  { name: "Peter Martinez", dept: "Marketing",  point: "C" },
  { name: "Sam Lewis",      dept: "Warehouse",  point: "C" },
  { name: "Tina Lee",       dept: "Warehouse",  point: "C" },
];

const STATUS_META = {
  unaccounted: { icon: "?", label: "Unaccounted", bg: "#64748b", ring: "#94a3b8", text: "#f8fafc" },
  present:     { icon: "✓", label: "Present",     bg: "#16a34a", ring: "#4ade80", text: "#f0fdf4" },
  missing:     { icon: "✗", label: "Missing",     bg: "#dc2626", ring: "#f87171", text: "#fff1f2" },
  excused:     { icon: "∅", label: "Off-site",    bg: "#d97706", ring: "#fbbf24", text: "#fffbeb" },
};

const CYCLE = { unaccounted: "present", present: "missing", missing: "excused", excused: "unaccounted" };

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function calcStats(employees, att, pointFilter = null) {
  const list = pointFilter ? employees.filter(e => e.id === pointFilter || e.point === pointFilter) : employees;
  const counts = { total: list.length, present: 0, missing: 0, excused: 0, unaccounted: 0 };
  list.forEach(e => { counts[att[e.id]?.status || "unaccounted"]++; });
  return counts;
}

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function elapsed(iso) {
  if (!iso) return "0m 0s";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}m ${s}s`;
}

// ─── ROOT ────────────────────────────────────────────────────────────────────

export default function App() {
  const [phase, setPhase]             = useState("setup");
  const [marshalName, setMarshalName] = useState("");
  const [myPoint, setMyPoint]         = useState("A");
  const [employees, setEmployees]     = useState([]);
  const [session, setSession]         = useState(null);
  const [att, setAtt]                 = useState({});  // { [employee_id]: { status, note, marshal_name, updated_at } }
  const [tab, setTab]                 = useState("mine");
  const [search, setSearch]           = useState("");
  const [noteFor, setNoteFor]         = useState(null);
  const [noteText, setNoteText]       = useState("");
  const [showMgmt, setShowMgmt]       = useState(false);
  const [newEmp, setNewEmp]           = useState({ name: "", dept: "", point: "A" });
  const [existSess, setExistSess]     = useState(null);
  const [loading, setLoading]         = useState(true);
  const [syncPulse, setSyncPulse]     = useState(false);
  const [elapsedStr, setElapsedStr]   = useState("0m 0s");
  const [geoStatus, setGeoStatus]     = useState(null);
  const [dbReady, setDbReady]         = useState(false);

  // ── Check DB and seed demo data on first load ────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Check if employees table has data
        const { data: existing, error } = await supabase.from("employees").select("id").limit(1);
        if (error) {
          console.error("Supabase error:", error.message);
          setLoading(false);
          return;
        }
        setDbReady(true);

        if (!existing || existing.length === 0) {
          // Seed demo employees
          await supabase.from("employees").insert(DEMO_EMPLOYEES);
        }

        // Load employees
        const { data: emps } = await supabase.from("employees").select("*").order("name");
        if (emps) setEmployees(emps);

        // Check for active session
        const { data: sessions } = await supabase
          .from("drill_sessions")
          .select("*")
          .eq("active", true)
          .order("started_at", { ascending: false })
          .limit(1);
        if (sessions && sessions.length > 0) setExistSess(sessions[0]);

      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    })();
  }, []);

  // ── Elapsed timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "active" || !session) return;
    const t = setInterval(() => setElapsedStr(elapsed(session.started_at)), 1000);
    return () => clearInterval(t);
  }, [phase, session]);

  // ── Real-time subscription once drill is active ──────────────────────────
  useEffect(() => {
    if (phase !== "active" || !session) return;

    const channel = supabase
      .channel("attendance-live")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "attendance",
        filter: `session_id=eq.${session.id}`,
      }, payload => {
        if (payload.eventType === "DELETE") return;
        const row = payload.new;
        setSyncPulse(true);
        setTimeout(() => setSyncPulse(false), 600);
        setAtt(prev => ({ ...prev, [row.employee_id]: row }));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [phase, session]);

  // ── Load attendance for a session ────────────────────────────────────────
  const loadAttendance = useCallback(async (sessionId) => {
    const { data } = await supabase
      .from("attendance")
      .select("*")
      .eq("session_id", sessionId);
    if (data) {
      const map = {};
      data.forEach(r => { map[r.employee_id] = r; });
      setAtt(map);
    }
  }, []);

  // ── Start drill ──────────────────────────────────────────────────────────
  const startDrill = async () => {
    if (!marshalName.trim()) return;
    // Deactivate any existing sessions
    await supabase.from("drill_sessions").update({ active: false }).eq("active", true);
    // Create new session
    const { data, error } = await supabase
      .from("drill_sessions")
      .insert({ started_by: marshalName, active: true })
      .select()
      .single();
    if (error || !data) { alert("Failed to start drill: " + error?.message); return; }
    setSession(data);
    setAtt({});
    setPhase("active");
    setTab("mine");
  };

  // ── Join drill ───────────────────────────────────────────────────────────
  const joinDrill = async () => {
    if (!marshalName.trim()) return;
    const { data: sessions } = await supabase
      .from("drill_sessions")
      .select("*")
      .eq("active", true)
      .order("started_at", { ascending: false })
      .limit(1);
    if (!sessions || sessions.length === 0) { alert("No active drill found. Start a new one."); return; }
    setSession(sessions[0]);
    await loadAttendance(sessions[0].id);
    setPhase("active");
    setTab("mine");
  };

  // ── Update attendance ────────────────────────────────────────────────────
  const upsertAtt = useCallback(async (employeeId, updates) => {
    if (!session) return;
    const row = {
      session_id: session.id,
      employee_id: employeeId,
      marshal_name: marshalName,
      updated_at: new Date().toISOString(),
      ...updates,
    };
    const { data, error } = await supabase
      .from("attendance")
      .upsert(row, { onConflict: "session_id,employee_id" })
      .select()
      .single();
    if (!error && data) {
      setAtt(prev => ({ ...prev, [employeeId]: data }));
    }
  }, [session, marshalName]);

  const cycleStatus = (id) => {
    const curr = att[id]?.status || "unaccounted";
    upsertAtt(id, { status: CYCLE[curr] });
  };

  const setStatus = (id, status) => upsertAtt(id, { status });

  const saveNote = async () => {
    if (!noteFor) return;
    await upsertAtt(noteFor, {
      status: att[noteFor]?.status || "unaccounted",
      note: noteText,
    });
    setNoteFor(null);
    setNoteText("");
  };

  // ── Geolocation ──────────────────────────────────────────────────────────
  const tryGeolocate = () => {
    if (!navigator.geolocation) { setGeoStatus("not-supported"); return; }
    setGeoStatus("detecting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoStatus("detected");
        const pts = ["A", "B", "C"];
        const idx = Math.abs(Math.round(pos.coords.longitude)) % 3;
        setMyPoint(pts[idx]);
      },
      () => setGeoStatus("error")
    );
  };

  // ── Employee management ──────────────────────────────────────────────────
  const addEmployee = async () => {
    if (!newEmp.name.trim()) return;
    const { data } = await supabase.from("employees").insert(newEmp).select().single();
    if (data) {
      setEmployees(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewEmp({ name: "", dept: "", point: "A" });
    }
  };

  const removeEmployee = async (id) => {
    await supabase.from("employees").delete().eq("id", id);
    setEmployees(prev => prev.filter(e => e.id !== id));
  };

  // ── Print report ─────────────────────────────────────────────────────────
  const handlePrint = () => {
    const stats = calcStats(employees, att);
    const now = new Date();
    const lines = [
      "FIRE EVACUATION DRILL – HEADCOUNT REPORT",
      "==========================================",
      `Date:          ${now.toLocaleDateString("en-GB")}`,
      `Time:          ${now.toLocaleTimeString("en-GB")}`,
      `Drill started: ${session?.started_by || "—"}  at  ${fmtTime(session?.started_at)}`,
      `Duration:      ${elapsed(session?.started_at)}`,
      "",
      "── OVERALL SUMMARY ──────────────────────",
      `  Total staff    : ${stats.total}`,
      `  ✓ Present      : ${stats.present}`,
      `  ✗ Missing      : ${stats.missing}`,
      `  ∅ Off-site     : ${stats.excused}`,
      `  ? Unaccounted  : ${stats.unaccounted}`,
      "",
    ];
    MUSTER_POINTS.forEach(mp => {
      const mpEmps = employees.filter(e => e.point === mp.id);
      const s = { total: mpEmps.length, present: 0, missing: 0, excused: 0, unaccounted: 0 };
      mpEmps.forEach(e => { s[att[e.id]?.status || "unaccounted"]++; });
      lines.push(`── MUSTER POINT ${mp.id} – ${mp.name} ${"─".repeat(Math.max(0, 30 - mp.name.length))}`);
      lines.push(`  Present: ${s.present}  Missing: ${s.missing}  Off-site: ${s.excused}  Unaccounted: ${s.unaccounted}`);
      mpEmps.forEach(e => {
        const r = att[e.id]; const st = r?.status || "unaccounted";
        const note = r?.note ? `  [${r.note}]` : "";
        const by   = r?.marshal_name ? `  (by ${r.marshal_name})` : "";
        lines.push(`  ${STATUS_META[st].icon} ${e.name.padEnd(22)} ${e.dept}${note}${by}`);
      });
      lines.push("");
    });
    if (stats.missing > 0) {
      lines.push("⚠  MISSING PERSONS – ACTION REQUIRED ───────");
      employees.filter(e => att[e.id]?.status === "missing").forEach(e => {
        const n = att[e.id]?.note;
        lines.push(`  ✗ ${e.name}  |  ${e.dept}  |  Point ${e.point}${n ? `  |  Note: ${n}` : ""}`);
      });
    }
    const html = `<html><head><title>Fire Drill Report</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono&display=swap');
  body { font-family: 'JetBrains Mono', monospace; padding: 32px; font-size: 13px; line-height: 1.6; white-space: pre; color: #1e293b; }
  @media print { body { padding: 16px; font-size: 11px; } }
</style></head><body>${lines.join("\n")}</body></html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.setTimeout(() => w.print(), 400);
  };

  // ── Computed ─────────────────────────────────────────────────────────────
  const stats   = calcStats(employees, att);
  const allOK   = stats.total > 0 && stats.unaccounted === 0 && stats.missing === 0;
  const hasMiss = stats.missing > 0;
  const myMp    = MUSTER_POINTS.find(p => p.id === myPoint);

  const visEmps = (() => {
    let list = tab === "mine" ? employees.filter(e => e.point === myPoint)
             : tab === "all"  ? [...employees]
             : employees.filter(e => e.point === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.dept?.toLowerCase().includes(q));
    }
    const ord = { unaccounted: 0, missing: 1, present: 2, excused: 3 };
    return list.sort((a, b) => ord[att[a.id]?.status || "unaccounted"] - ord[att[b.id]?.status || "unaccounted"]);
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOADING
  // ═══════════════════════════════════════════════════════════════════════════
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🚨</div>
      <div style={{ color: "#94a3b8", fontSize: 14 }}>Connecting to database…</div>
    </div>
  );

  if (!dbReady) return (
    <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
      <div style={{ color: "#f87171", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Database not connected</div>
      <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center" }}>Check your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables in Vercel.</div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  //  SETUP SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  if (phase === "setup") return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#0f172a 0%,#1e293b 100%)", fontFamily: "'DM Sans', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        input, select, textarea { outline: none; font-family: inherit; }
        button { font-family: inherit; cursor: pointer; }
        .inp:focus { border-color: #f97316 !important; }
        .mp-btn:hover { filter: brightness(1.08); }
        .action-btn:active { transform: scale(0.97); }
      `}</style>

      <div style={{ width: "100%", maxWidth: 480, padding: "32px 20px 0" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 52, marginBottom: 8 }}>🚨</div>
          <div style={{ color: "#f97316", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>Emergency</div>
          <div style={{ color: "white", fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px" }}>Fire Drill</div>
          <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>Headcount &amp; Muster System</div>
        </div>

        {existSess && (
          <div style={{ background: "rgba(251,191,36,0.12)", border: "1px solid #f59e0b", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#fbbf24" }}>
            ⚡ Active drill by <strong>{existSess.started_by}</strong> · started {fmtTime(existSess.started_at)}
          </div>
        )}

        {/* Marshal name */}
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 16, marginBottom: 12, border: "1px solid rgba(255,255,255,0.08)" }}>
          <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>Marshal Name</label>
          <input
            className="inp"
            value={marshalName}
            onChange={e => setMarshalName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && (existSess ? joinDrill() : startDrill())}
            placeholder="Enter your full name"
            style={{ width: "100%", padding: "11px 14px", borderRadius: 8, border: "1.5px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "white", fontSize: 16, transition: "border-color .2s" }}
          />
        </div>

        {/* Muster point */}
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 16, marginBottom: 12, border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <label style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>Your Muster Point</label>
            <button onClick={tryGeolocate} style={{ background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.3)", color: "#fb923c", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600 }}>
              {geoStatus === "detecting" ? "📡 Detecting…" : geoStatus === "detected" ? "✓ Located" : geoStatus === "error" ? "⚠ Failed" : "📍 Detect"}
            </button>
          </div>
          {MUSTER_POINTS.map(mp => {
            const sel = myPoint === mp.id;
            const mpEmps = employees.filter(e => e.point === mp.id);
            return (
              <button key={mp.id} onClick={() => setMyPoint(mp.id)} className="mp-btn" style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 8, borderRadius: 10, border: `2px solid ${sel ? mp.color : "rgba(255,255,255,0.08)"}`, background: sel ? `${mp.color}22` : "rgba(255,255,255,0.03)", transition: "all .15s" }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: sel ? mp.color : "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color: sel ? "white" : "#64748b", marginRight: 12, flexShrink: 0 }}>{mp.id}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: sel ? "white" : "#cbd5e1", fontWeight: 600, fontSize: 14 }}>{mp.name}</div>
                  <div style={{ color: "#64748b", fontSize: 11, marginTop: 1 }}>{mpEmps.length} personnel assigned</div>
                </div>
                {sel && <div style={{ color: mp.color, fontSize: 18 }}>✓</div>}
              </button>
            );
          })}
        </div>

        {/* CTA buttons */}
        {existSess && (
          <button onClick={joinDrill} disabled={!marshalName.trim()} className="action-btn" style={{ width: "100%", padding: 14, background: marshalName.trim() ? "#2563eb" : "#1e293b", color: "white", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, marginBottom: 10, transition: "all .15s", opacity: marshalName.trim() ? 1 : 0.5 }}>
            ⚡ Join Active Drill
          </button>
        )}
        <button onClick={startDrill} disabled={!marshalName.trim()} className="action-btn" style={{ width: "100%", padding: 14, background: marshalName.trim() ? "#dc2626" : "#1e293b", color: "white", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, marginBottom: 12, transition: "all .15s", opacity: marshalName.trim() ? 1 : 0.5 }}>
          {existSess ? "🔁 Start New Drill (Reset)" : "🚨 Start Fire Drill"}
        </button>

        {/* Employee management */}
        <button onClick={() => setShowMgmt(!showMgmt)} style={{ width: "100%", padding: 10, background: "transparent", color: "#64748b", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, fontSize: 13, marginBottom: 8 }}>
          {showMgmt ? "▲ Hide" : "▼ Manage"} Employee List ({employees.length} people)
        </button>

        {showMgmt && (
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ color: "white", fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Employee List</div>
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
              {employees.map(e => {
                const mp = MUSTER_POINTS.find(p => p.id === e.point);
                return (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: 13 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 4, background: mp?.color, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{e.point}</div>
                    <span style={{ flex: 1, color: "#cbd5e1" }}>{e.name} <span style={{ color: "#475569" }}>· {e.dept}</span></span>
                    <button onClick={() => removeEmployee(e.id)} style={{ background: "none", border: "none", color: "#ef4444", fontSize: 18, padding: "0 4px", lineHeight: 1 }}>×</button>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Add Employee</div>
              <input className="inp" value={newEmp.name} onChange={e => setNewEmp(p => ({...p, name: e.target.value}))} placeholder="Full name" style={{ width: "100%", padding: "8px 10px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", borderRadius: 7, fontSize: 14, color: "white", marginBottom: 6 }} />
              <input className="inp" value={newEmp.dept} onChange={e => setNewEmp(p => ({...p, dept: e.target.value}))} placeholder="Department" style={{ width: "100%", padding: "8px 10px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", borderRadius: 7, fontSize: 14, color: "white", marginBottom: 6 }} />
              <select value={newEmp.point} onChange={e => setNewEmp(p => ({...p, point: e.target.value}))} style={{ width: "100%", padding: "8px 10px", border: "1px solid rgba(255,255,255,0.1)", background: "#1e293b", borderRadius: 7, fontSize: 14, color: "white", marginBottom: 8 }}>
                {MUSTER_POINTS.map(mp => <option key={mp.id} value={mp.id}>Point {mp.id} – {mp.name}</option>)}
              </select>
              <button onClick={addEmployee} style={{ width: "100%", padding: 9, background: "#2563eb", color: "white", border: "none", borderRadius: 7, fontSize: 14, fontWeight: 600 }}>Add Person</button>
            </div>
          </div>
        )}

        <div style={{ height: 40 }} />
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  //  ACTIVE DRILL SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        button { font-family: inherit; cursor: pointer; }
        input, textarea { font-family: inherit; outline: none; }
        .emp-row:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.1) !important; }
        .status-btn:active { transform: scale(0.9); }
        .status-btn:hover { filter: brightness(1.1); }
        @keyframes syncFlash { 0%{opacity:0;transform:scale(0.8)} 100%{opacity:1;transform:scale(1)} }
        .sync-anim { animation: syncFlash .4s ease; }
      `}</style>

      {/* TOP BAR */}
      <div style={{ background: hasMiss ? "#991b1b" : allOK ? "#166534" : "#0f172a", padding: "10px 14px", position: "sticky", top: 0, zIndex: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>🚨</span>
            <div>
              <div style={{ color: "white", fontWeight: 800, fontSize: 15, lineHeight: 1 }}>Fire Drill Active</div>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, marginTop: 2, fontFamily: "'DM Mono', monospace" }}>{elapsedStr} · {marshalName} · Pt {myPoint}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div className={syncPulse ? "sync-anim" : ""} style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 6px #4ade80" }} title="Live sync" />
            <button onClick={handlePrint} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", color: "white", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600 }}>📋 Report</button>
            <button onClick={() => setPhase("setup")} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "rgba(255,255,255,0.6)", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>⚙</button>
          </div>
        </div>

        {/* Stats pills */}
        <div style={{ display: "flex", gap: 6 }}>
          {Object.entries(STATUS_META).map(([s, m]) => {
            if (s !== "present" && s !== "missing" && stats[s] === 0) return null;
            return (
              <div key={s} style={{ background: m.bg, color: m.text, padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 4, fontFamily: "'DM Mono', monospace" }}>
                <span>{m.icon}</span><span>{stats[s]}</span>
              </div>
            );
          })}
          <div style={{ marginLeft: "auto", color: "rgba(255,255,255,0.4)", fontSize: 11, alignSelf: "center", fontFamily: "'DM Mono', monospace" }}>
            {stats.total - stats.unaccounted}/{stats.total}
          </div>
        </div>

        {hasMiss && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "6px 10px", marginTop: 8, fontSize: 12, fontWeight: 700, color: "#991b1b" }}>
            ⚠ {stats.missing} PERSON{stats.missing > 1 ? "S" : ""} UNACCOUNTED — ALERT MANAGEMENT
          </div>
        )}
        {allOK && (
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "6px 10px", marginTop: 8, fontSize: 12, fontWeight: 700, color: "#166534" }}>
            ✅ All staff accounted for — drill complete
          </div>
        )}
      </div>

      {/* TABS */}
      <div style={{ background: "white", display: "flex", borderBottom: "2px solid #e2e8f0", overflowX: "auto" }}>
        {[
          { id: "mine", label: `My Pt ${myPoint}`, color: myMp?.color },
          { id: "all",  label: `All (${employees.length})`, color: "#0f172a" },
          ...MUSTER_POINTS.filter(mp => mp.id !== myPoint).map(mp => {
            const mpEmps = employees.filter(e => e.point === mp.id);
            const s = calcStats(mpEmps, att);
            const warn = s.missing > 0 ? "🔴" : s.unaccounted > 0 ? "🟡" : "🟢";
            return { id: mp.id, label: `Pt ${mp.id} ${warn}`, color: mp.color };
          })
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: "0 0 auto", padding: "10px 14px", border: "none", borderBottom: tab === t.id ? `3px solid ${t.color}` : "3px solid transparent", background: "white", fontWeight: tab === t.id ? 700 : 400, color: tab === t.id ? t.color : "#64748b", fontSize: 13, whiteSpace: "nowrap" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* SEARCH */}
      <div style={{ padding: "8px 10px", background: "white", borderBottom: "1px solid #f1f5f9" }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍  Search by name or department..."
          style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 15 }}
        />
      </div>

      {/* LEGEND */}
      <div style={{ padding: "5px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "#94a3b8", overflowX: "auto" }}>
        <span style={{ flexShrink: 0 }}>Tap to cycle:</span>
        {Object.entries(STATUS_META).map(([k, v]) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
            <span style={{ background: v.bg, color: v.text, width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>{v.icon}</span>
            <span>{v.label}</span>
          </span>
        ))}
      </div>

      {/* EMPLOYEE LIST */}
      <div style={{ padding: "8px 10px 100px" }}>
        {visEmps.length === 0 && (
          <div style={{ textAlign: "center", color: "#94a3b8", padding: "40px 20px", fontSize: 14 }}>No employees found</div>
        )}
        {visEmps.map(emp => {
          const rec = att[emp.id];
          const status = rec?.status || "unaccounted";
          const sm = STATUS_META[status];
          const empMp = MUSTER_POINTS.find(p => p.id === emp.point);
          const hasNote = rec?.note;
          return (
            <div key={emp.id} className="emp-row" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7, background: "white", borderRadius: 12, padding: "10px 12px", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", border: status === "missing" ? "2px solid #fca5a5" : "2px solid transparent", transition: "border .15s" }}>
              <button onClick={() => cycleStatus(emp.id)} className="status-btn"
                style={{ width: 52, height: 52, borderRadius: 12, background: sm.bg, color: sm.text, border: "none", fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 0 0 3px ${sm.ring}33`, transition: "transform .12s, filter .12s" }}>
                {sm.icon}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{emp.name}</div>
                <div style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
                  <span>{emp.dept}</span>
                  <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#cbd5e1", display: "inline-block" }} />
                  <span style={{ color: empMp?.color, fontWeight: 600 }}>Pt {emp.point}</span>
                </div>
                {hasNote && (
                  <div style={{ fontSize: 11, color: "#78350f", background: "#fef3c7", borderRadius: 5, padding: "2px 7px", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span>📝</span><span>{rec.note}</span>
                  </div>
                )}
                {rec?.marshal_name && (
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
                    {rec.marshal_name} · {fmtTime(rec.updated_at)}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setStatus(emp.id, "present")} style={{ width: 28, height: 28, borderRadius: 6, background: status === "present" ? "#16a34a" : "#f0fdf4", border: "1px solid #86efac", color: status === "present" ? "white" : "#16a34a", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</button>
                  <button onClick={() => setStatus(emp.id, "missing")} style={{ width: 28, height: 28, borderRadius: 6, background: status === "missing" ? "#dc2626" : "#fef2f2", border: "1px solid #fca5a5", color: status === "missing" ? "white" : "#dc2626", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✗</button>
                  <button onClick={() => setStatus(emp.id, "excused")} style={{ width: 28, height: 28, borderRadius: 6, background: status === "excused" ? "#d97706" : "#fffbeb", border: "1px solid #fcd34d", color: status === "excused" ? "white" : "#d97706", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>∅</button>
                </div>
                <button onClick={() => { setNoteFor(emp.id); setNoteText(rec?.note || ""); }} style={{ background: hasNote ? "#fef3c7" : "#f8fafc", border: `1px solid ${hasNote ? "#fcd34d" : "#e2e8f0"}`, borderRadius: 6, padding: "3px 8px", fontSize: 11, color: hasNote ? "#92400e" : "#94a3b8", fontWeight: 600 }}>
                  📝 {hasNote ? "Edit" : "Note"}
                </button>
              </div>
            </div>
          );
        })}

        {/* Muster point summary on All tab */}
        {tab === "all" && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 8, paddingLeft: 4 }}>Muster Point Summary</div>
            {MUSTER_POINTS.map(mp => {
              const mpEmps = employees.filter(e => e.point === mp.id);
              const s = calcStats(mpEmps, att);
              const pct = s.total > 0 ? Math.round(s.present / s.total * 100) : 0;
              return (
                <div key={mp.id} style={{ background: "white", borderRadius: 12, padding: 14, marginBottom: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: mp.color, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15 }}>{mp.id}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>{mp.name}</div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{s.present}/{s.total} present · {pct}%</div>
                      </div>
                    </div>
                    {s.missing > 0
                      ? <div style={{ background: "#fef2f2", color: "#dc2626", borderRadius: 6, padding: "3px 8px", fontSize: 12, fontWeight: 700 }}>⚠ {s.missing} missing</div>
                      : s.unaccounted === 0
                        ? <div style={{ background: "#f0fdf4", color: "#16a34a", borderRadius: 6, padding: "3px 8px", fontSize: 12, fontWeight: 700 }}>✓ Clear</div>
                        : null}
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "#f1f5f9", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: s.missing > 0 ? "#dc2626" : mp.color, borderRadius: 3, transition: "width .3s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* BOTTOM BAR */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "white", borderTop: "1px solid #e2e8f0", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 10 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'DM Mono', monospace" }}>⟳ Live · Supabase</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: hasMiss ? "#dc2626" : allOK ? "#16a34a" : "#64748b" }}>
            {hasMiss ? `⚠ ${stats.missing} MISSING` : allOK ? "✅ All Clear" : `${stats.present}/${stats.total} present`}
          </div>
          <button onClick={handlePrint} style={{ background: "#0f172a", color: "white", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700 }}>Print Report</button>
        </div>
      </div>

      {/* NOTE MODAL */}
      {noteFor && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={() => setNoteFor(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", width: "100%", padding: "20px 20px 32px", borderRadius: "20px 20px 0 0", boxShadow: "0 -8px 32px rgba(0,0,0,0.2)" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#e2e8f0", margin: "0 auto 16px" }} />
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 2, color: "#0f172a" }}>
              📝 Note for {employees.find(e => e.id === noteFor)?.name}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>e.g. "WFH today", "Annual leave", "Off-site meeting"</div>
            <textarea
              value={noteText} onChange={e => setNoteText(e.target.value)}
              placeholder="Add a note about this person…"
              autoFocus
              style={{ width: "100%", height: 90, padding: "10px 12px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 15, resize: "none", color: "#0f172a", outline: "none" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => { setNoteFor(null); setNoteText(""); }} style={{ flex: 1, padding: 13, background: "#f1f5f9", border: "none", borderRadius: 10, fontSize: 15, color: "#64748b", fontWeight: 600 }}>Cancel</button>
              <button onClick={saveNote} style={{ flex: 2, padding: 13, background: "#0f172a", color: "white", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 800 }}>Save Note</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
