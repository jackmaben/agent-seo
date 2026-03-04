import { useState, useRef } from "react";

// ── Font + global styles ──────────────────────────────────────────────────────
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,400&display=swap";
document.head.appendChild(fontLink);

const styleEl = document.createElement("style");
styleEl.textContent = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:#0b0e13}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  .fade-in{animation:fadeUp .4s ease both}
  textarea:focus,input:focus,select:focus{outline:none!important;border-color:#5fe3a1!important;box-shadow:0 0 0 2px rgba(95,227,161,.1)!important}
  ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0b0e13}::-webkit-scrollbar-thumb{background:#1e2d20;border-radius:4px}
  .tab-btn{transition:all .2s}.tab-btn:hover{background:rgba(95,227,161,.07)!important}
  .act-btn{transition:all .18s}.act-btn:hover:not(:disabled){filter:brightness(1.12);transform:translateY(-1px)}
  .copy-btn:hover{background:rgba(95,227,161,.12)!important;color:#5fe3a1!important}
  .edit-row{transition:background .15s}.edit-row:hover{background:rgba(95,227,161,.04)!important}
  .del-btn{opacity:0;transition:opacity .15s}.edit-row:hover .del-btn{opacity:1!important}
  .add-btn:hover{background:rgba(95,227,161,.1)!important;border-color:#5fe3a1!important;color:#5fe3a1!important}
  .add-btn{transition:all .15s}
  .serp-item:hover{background:rgba(95,227,161,.04)!important}
`;
document.head.appendChild(styleEl);

// ── Claude API ────────────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userPrompt, useWebSearch = false) {
  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };
  if (useWebSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e?.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  return data.content.filter(b => b.type === "text").map(b => b.text).join("\n");
}

// ── Prompts ───────────────────────────────────────────────────────────────────
const SERP_SYSTEM = `You are an SEO research agent. Use web_search aggressively to fetch real, current SERP data.
Always search multiple times to cover top 10 results. Return ONLY valid JSON, no markdown fences, no explanation.`;

function serpPrompt(keyword, location) {
  return `Search Google for the keyword: "${keyword}"${location ? ` in ${location}` : ""}.

Find the top 10 currently ranking pages. For each page, use web_search to visit and extract all H1, H2, H3 headings.

Then analyze:
1. Which headings/topics appear on 3 or more pages? These are "common_headers"
2. Which headings reflect fresh 2024–2026 trends not yet widely covered? These are "emerging_headers"
3. Deduplicate and keep the most modern phrasing for each topic cluster

Return ONLY this JSON:
{
  "serp_urls": ["url1","url2",...],
  "common_headers": ["header appearing on 3+ pages",...],
  "emerging_headers": ["newly trending header",...],
  "all_extracted_headers": ["every unique header found",...]
}`;
}

const OUTLINE_SYSTEM = `You are a Semantic SEO Content Intelligence Agent (2025–2026).
Generate a modern SEO content outline as JSON ONLY. No prose. No markdown fences. No explanation.

Schema:
{
  "title": "",
  "intro_summary": "",
  "sections": [ { "heading": "", "subheadings": [] } ],
  "faq": [ { "question": "", "answer_intent": "" } ]
}

Rules: cluster+deduplicate competitor headers, fill topical gaps, add emerging topics,
entity-based structure, problem/solution + comparison sections, integrate location naturally,
satisfy search intent, PAA-style FAQ. Output ONLY valid JSON.`;

function outlinePrompt(p) {
  return `keyword: ${p.keyword}
target_location: ${p.location || "global"}
persona: ${p.persona || "general audience"}
search_intent: ${p.intent}
common_competitor_headers: ${p.common}
emerging_headers: ${p.emerging}
additional_instructions: ${p.instructions || "none"}

Generate the SEO outline JSON now.`;
}

const ARTICLE_SYSTEM = `You are a Semantic SEO Content Intelligence Agent (2025–2026).
Generate a full article in Markdown ONLY.
- Follow the confirmed outline exactly, no new sections
- H1 for title, H2 for sections, H3 for subheadings
- Short readable paragraphs, bullets where helpful
- Natural entity usage, semantic richness, locale-aware tone
- End with FAQ section
- Output ONLY the article markdown. No explanation. No JSON.`;

function articlePrompt(p) {
  return `keyword: ${p.keyword}
target_location: ${p.location || "global"}
persona: ${p.persona || "general audience"}
search_intent: ${p.intent}
content_length: ${p.length} words
writing_instructions: ${p.instructions || "professional, engaging"}
confirmed_outline:
${JSON.stringify(p.outline, null, 2)}

Generate the full article now.`;
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function MD({ text }) {
  if (!text) return null;
  const inline = (str) =>
    str.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((p, i) => {
      if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} style={{ color: "#e8f5ee", fontWeight: 600 }}>{p.slice(2, -2)}</strong>;
      if (p.startsWith("*") && p.endsWith("*")) return <em key={i} style={{ color: "#9dbfad" }}>{p.slice(1, -1)}</em>;
      if (p.startsWith("`") && p.endsWith("`")) return <code key={i} style={{ background: "#1a2230", color: "#5fe3a1", padding: "1px 6px", borderRadius: 3, fontSize: ".87em", fontFamily: "IBM Plex Mono,monospace" }}>{p.slice(1, -1)}</code>;
      return p;
    });
  return text.split("\n").map((line, i) => {
    if (line.startsWith("# ")) return <h1 key={i} style={{ fontFamily: "Playfair Display,serif", fontSize: "clamp(20px,3vw,28px)", fontWeight: 900, color: "#f0f5f0", margin: "0 0 18px", lineHeight: 1.25 }}>{inline(line.slice(2))}</h1>;
    if (line.startsWith("## ")) return <h2 key={i} style={{ fontFamily: "Playfair Display,serif", fontSize: "clamp(15px,2vw,19px)", fontWeight: 700, color: "#5fe3a1", margin: "26px 0 9px" }}>{inline(line.slice(3))}</h2>;
    if (line.startsWith("### ")) return <h3 key={i} style={{ fontSize: "15px", fontWeight: 600, color: "#c4ddd0", margin: "16px 0 6px" }}>{inline(line.slice(4))}</h3>;
    if (line.startsWith("- ") || line.startsWith("* ")) return <div key={i} style={{ display: "flex", gap: 9, marginBottom: 4 }}><span style={{ color: "#5fe3a1", flexShrink: 0, marginTop: 3 }}>›</span><span style={{ fontSize: "14.5px", color: "#adc4b8", lineHeight: 1.75 }}>{inline(line.slice(2))}</span></div>;
    if (!line.trim()) return <div key={i} style={{ height: 7 }} />;
    return <p key={i} style={{ fontSize: "14.5px", color: "#adc4b8", lineHeight: 1.82, marginBottom: 3 }}>{inline(line)}</p>;
  });
}

// ── Inline Outline Editor ─────────────────────────────────────────────────────
function OutlineEditor({ outline, onChange }) {
  const set = (patch) => onChange({ ...outline, ...patch });
  const setSections = (sections) => set({ sections });
  const setFaq = (faq) => set({ faq });

  const iS = {
    background: "transparent", border: "none",
    borderBottom: "1px dashed #1e3a28", color: "inherit",
    fontFamily: "inherit", fontSize: "inherit", fontWeight: "inherit",
    padding: "1px 3px", outline: "none", width: "100%",
    transition: "border-color .15s",
  };

  const updSection = (si, key, val) =>
    setSections(outline.sections.map((s, i) => i === si ? { ...s, [key]: val } : s));
  const updSub = (si, bi, val) =>
    setSections(outline.sections.map((s, i) => i !== si ? s : { ...s, subheadings: s.subheadings.map((h, j) => j === bi ? val : h) }));
  const addSub = (si) =>
    setSections(outline.sections.map((s, i) => i !== si ? s : { ...s, subheadings: [...(s.subheadings || []), "New subheading"] }));
  const delSub = (si, bi) =>
    setSections(outline.sections.map((s, i) => i !== si ? s : { ...s, subheadings: s.subheadings.filter((_, j) => j !== bi) }));
  const addSection = () => setSections([...outline.sections, { heading: "New Section", subheadings: [] }]);
  const delSection = (si) => setSections(outline.sections.filter((_, i) => i !== si));
  const moveSection = (si, d) => {
    const arr = [...outline.sections]; const to = si + d;
    if (to < 0 || to >= arr.length) return;
    [arr[si], arr[to]] = [arr[to], arr[si]]; setSections(arr);
  };
  const updFaq = (fi, key, val) => setFaq(outline.faq.map((f, i) => i !== fi ? f : { ...f, [key]: val }));
  const addFaq = () => setFaq([...(outline.faq || []), { question: "New question?", answer_intent: "informational" }]);
  const delFaq = (fi) => setFaq(outline.faq.filter((_, i) => i !== fi));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Title block */}
      <div style={{ background: "linear-gradient(135deg,#0f1c15,#0d1c1e)", border: "1px solid #1e3028", borderRadius: 10, padding: "20px 24px" }}>
        <div style={{ fontSize: "9px", letterSpacing: "0.22em", color: "#5fe3a1", fontFamily: "IBM Plex Mono,monospace", marginBottom: 9 }}>H1 · TITLE — click to edit</div>
        <input style={{ ...iS, fontFamily: "Playfair Display,serif", fontSize: "clamp(16px,2.4vw,22px)", fontWeight: 900, color: "#f0f5f0" }}
          value={outline.title} onChange={e => set({ title: e.target.value })} />
        {outline.intro_summary !== undefined && (
          <textarea style={{ ...iS, marginTop: 12, fontSize: "13px", color: "#6b8a7a", fontStyle: "italic", lineHeight: 1.65, resize: "none", display: "block", minHeight: 48 }}
            value={outline.intro_summary} onChange={e => set({ intro_summary: e.target.value })} />
        )}
      </div>

      {/* Sections */}
      {outline.sections?.map((sec, si) => (
        <div key={si} className="edit-row" style={{ background: "#0d1117", border: "1px solid #1a2430", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "11px 15px", borderBottom: "1px solid #0f1820", display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: "9px", fontFamily: "IBM Plex Mono,monospace", color: "#2a5a40", background: "#0f2018", border: "1px solid #1e3028", padding: "2px 6px", borderRadius: 3, flexShrink: 0 }}>H2</span>
            <input style={{ ...iS, fontSize: "14px", fontWeight: 700, color: "#c4e8d4", fontFamily: "Playfair Display,serif", flex: 1 }}
              value={sec.heading} onChange={e => updSection(si, "heading", e.target.value)} />
            <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
              <button onClick={() => moveSection(si, -1)} style={{ background: "none", border: "none", color: "#2a4a38", cursor: "pointer", fontSize: 12, padding: "1px 5px" }} title="Move up">↑</button>
              <button onClick={() => moveSection(si, 1)} style={{ background: "none", border: "none", color: "#2a4a38", cursor: "pointer", fontSize: 12, padding: "1px 5px" }} title="Move down">↓</button>
              <button className="del-btn" onClick={() => delSection(si)} style={{ background: "none", border: "none", color: "#8a3030", cursor: "pointer", fontSize: 13, padding: "1px 5px" }} title="Remove">✕</button>
            </div>
          </div>
          {sec.subheadings?.map((sub, bi) => (
            <div key={bi} className="edit-row" style={{ padding: "8px 15px 8px 42px", borderBottom: "1px solid #0a1018", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "9px", fontFamily: "IBM Plex Mono,monospace", color: "#1e4035", background: "#081510", border: "1px solid #122018", padding: "2px 5px", borderRadius: 3, flexShrink: 0 }}>H3</span>
              <input style={{ ...iS, fontSize: "13px", color: "#7da890", flex: 1 }}
                value={sub} onChange={e => updSub(si, bi, e.target.value)} />
              <button className="del-btn" onClick={() => delSub(si, bi)} style={{ background: "none", border: "none", color: "#8a3030", cursor: "pointer", fontSize: 12, flexShrink: 0 }}>✕</button>
            </div>
          ))}
          <div style={{ padding: "7px 15px 7px 42px" }}>
            <button className="add-btn" onClick={() => addSub(si)} style={{ fontSize: "9.5px", color: "#2a4a38", background: "transparent", border: "1px dashed #1a2e22", padding: "3px 11px", cursor: "pointer", borderRadius: 4, fontFamily: "IBM Plex Mono,monospace", letterSpacing: "0.1em" }}>+ ADD SUBHEADING</button>
          </div>
        </div>
      ))}

      <button className="add-btn" onClick={addSection} style={{ padding: "10px", background: "transparent", border: "1px dashed #1a2e22", color: "#2a4a38", fontSize: "9.5px", letterSpacing: "0.16em", fontFamily: "IBM Plex Mono,monospace", cursor: "pointer", borderRadius: 7 }}>+ ADD SECTION</button>

      {/* FAQ */}
      {outline.faq?.length > 0 && (
        <div style={{ background: "#0d1117", border: "1px solid #1a2430", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "11px 15px", borderBottom: "1px solid #0f1820", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "9px", fontFamily: "IBM Plex Mono,monospace", color: "#2a5a40", background: "#0f2018", border: "1px solid #1e3028", padding: "2px 6px", borderRadius: 3 }}>FAQ</span>
            <span style={{ fontFamily: "Playfair Display,serif", fontSize: "14px", fontWeight: 700, color: "#c4e8d4" }}>Frequently Asked Questions</span>
          </div>
          {outline.faq.map((f, fi) => (
            <div key={fi} className="edit-row" style={{ padding: "9px 15px", borderBottom: fi < outline.faq.length - 1 ? "1px solid #0a1018" : "none", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <input style={{ ...iS, fontSize: "13px", color: "#9dbfad", marginBottom: 4 }} value={f.question} onChange={e => updFaq(fi, "question", e.target.value)} />
                <input style={{ ...iS, fontSize: "10.5px", color: "#3a5a48", fontFamily: "IBM Plex Mono,monospace" }} value={f.answer_intent} onChange={e => updFaq(fi, "answer_intent", e.target.value)} />
              </div>
              <button className="del-btn" onClick={() => delFaq(fi)} style={{ background: "none", border: "none", color: "#8a3030", cursor: "pointer", fontSize: 12, flexShrink: 0, marginTop: 2 }}>✕</button>
            </div>
          ))}
          <div style={{ padding: "7px 15px" }}>
            <button className="add-btn" onClick={addFaq} style={{ fontSize: "9.5px", color: "#2a4a38", background: "transparent", border: "1px dashed #1a2e22", padding: "3px 11px", cursor: "pointer", borderRadius: 4, fontFamily: "IBM Plex Mono,monospace", letterSpacing: "0.1em" }}>+ ADD FAQ</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Read-only outline view ────────────────────────────────────────────────────
function OutlineReadView({ outline }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      <div style={{ background: "linear-gradient(135deg,#0f1c15,#0d1c1e)", border: "1px solid #1e3028", borderRadius: 10, padding: "20px 24px" }}>
        <div style={{ fontSize: "9px", letterSpacing: "0.22em", color: "#5fe3a1", fontFamily: "IBM Plex Mono,monospace", marginBottom: 9 }}>H1 · TITLE</div>
        <div style={{ fontFamily: "Playfair Display,serif", fontSize: "clamp(16px,2.4vw,22px)", fontWeight: 900, color: "#f0f5f0", lineHeight: 1.3 }}>{outline.title}</div>
        {outline.intro_summary && <div style={{ marginTop: 11, fontSize: "13px", color: "#5a7a6a", fontStyle: "italic", lineHeight: 1.7, borderLeft: "2px solid #1a3020", paddingLeft: 13 }}>{outline.intro_summary}</div>}
      </div>
      {outline.sections?.map((sec, si) => (
        <div key={si} style={{ background: "#0d1117", border: "1px solid #1a2430", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "11px 15px", borderBottom: sec.subheadings?.length ? "1px solid #0f1820" : "none", display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: "9px", fontFamily: "IBM Plex Mono,monospace", color: "#2a5a40", background: "#0f2018", border: "1px solid #1e3028", padding: "2px 6px", borderRadius: 3, flexShrink: 0 }}>H2</span>
            <span style={{ fontFamily: "Playfair Display,serif", fontSize: "14px", fontWeight: 700, color: "#c4e8d4" }}>{sec.heading}</span>
          </div>
          {sec.subheadings?.map((sub, bi) => (
            <div key={bi} style={{ padding: "8px 15px 8px 42px", borderBottom: bi < sec.subheadings.length - 1 ? "1px solid #0a1018" : "none", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "9px", fontFamily: "IBM Plex Mono,monospace", color: "#1e4035", background: "#081510", border: "1px solid #122018", padding: "2px 5px", borderRadius: 3, flexShrink: 0 }}>H3</span>
              <span style={{ fontSize: "13px", color: "#7da890" }}>{sub}</span>
            </div>
          ))}
        </div>
      ))}
      {outline.faq?.length > 0 && (
        <div style={{ background: "#0d1117", border: "1px solid #1a2430", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "11px 15px", borderBottom: "1px solid #0f1820", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: "9px", fontFamily: "IBM Plex Mono,monospace", color: "#2a5a40", background: "#0f2018", border: "1px solid #1e3028", padding: "2px 6px", borderRadius: 3 }}>FAQ</span>
            <span style={{ fontFamily: "Playfair Display,serif", fontSize: "14px", fontWeight: 700, color: "#c4e8d4" }}>Frequently Asked Questions</span>
          </div>
          {outline.faq.map((f, fi) => (
            <div key={fi} style={{ padding: "9px 15px", borderBottom: fi < outline.faq.length - 1 ? "1px solid #0a1018" : "none" }}>
              <div style={{ fontSize: "13px", color: "#9dbfad", marginBottom: 3 }}>❓ {f.question}</div>
              <div style={{ fontSize: "10.5px", color: "#2a4a38", fontFamily: "IBM Plex Mono,monospace" }}>intent: {f.answer_intent}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SERP Results Panel ────────────────────────────────────────────────────────
function SerpPanel({ data }) {
  const [tab, setTab] = useState("common");
  const tabs = [
    { id: "common", label: "COMMON HEADERS", items: data.common_headers, color: "#5fe3a1" },
    { id: "emerging", label: "EMERGING", items: data.emerging_headers, color: "#f5c842" },
    { id: "urls", label: "SOURCES (TOP 10)", items: data.serp_urls, color: "#7ab4e8" },
  ];
  const active = tabs.find(t => t.id === tab);
  return (
    <div className="fade-in" style={{ background: "#080c11", border: "1px solid #1a2430", borderRadius: 8, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ display: "flex", borderBottom: "1px solid #0f1820" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "9px 8px", background: tab === t.id ? "#0d1117" : "transparent", border: "none", borderBottom: tab === t.id ? `2px solid ${t.color}` : "2px solid transparent", color: tab === t.id ? t.color : "#1e3a28", fontSize: "9.5px", letterSpacing: "0.15em", fontFamily: "IBM Plex Mono,monospace", cursor: "pointer", transition: "all .15s" }}>
            {t.label} <span style={{ opacity: .55 }}>({(t.items || []).length})</span>
          </button>
        ))}
      </div>
      <div style={{ maxHeight: 190, overflowY: "auto", padding: "3px 0" }}>
        {(active.items || []).map((item, i) => (
          <div key={i} className="serp-item" style={{ padding: "6px 15px", display: "flex", gap: 9, alignItems: "flex-start", transition: "background .15s" }}>
            <span style={{ fontSize: "9px", color: active.color, opacity: .45, fontFamily: "IBM Plex Mono,monospace", flexShrink: 0, marginTop: 2 }}>{String(i + 1).padStart(2, "0")}</span>
            {tab === "urls"
              ? <a href={item} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "#4a7a9b", textDecoration: "none", wordBreak: "break-all", lineHeight: 1.5 }}>{item}</a>
              : <span style={{ fontSize: "13px", color: "#8ab8a0", lineHeight: 1.5 }}>{item}</span>
            }
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────
const Field = ({ label, hint, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <label style={{ fontSize: "9.5px", letterSpacing: "0.2em", color: "#5fe3a1", fontFamily: "IBM Plex Mono,monospace" }}>{label}</label>
      {hint && <span style={{ fontSize: "9.5px", color: "#1e3a28", fontFamily: "IBM Plex Mono,monospace" }}>{hint}</span>}
    </div>
    {children}
  </div>
);

const IS = { background: "#06090e", border: "1px solid #18242e", borderRadius: 5, color: "#c4ddd0", padding: "10px 13px", fontSize: "13px", fontFamily: "Source Serif 4,serif", width: "100%", transition: "border-color .2s" };
const TS = { ...IS, resize: "vertical", lineHeight: 1.65 };

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SEOAgent() {
  const [tab, setTab] = useState("outline");
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState("");
  const [err, setErr] = useState("");

  // outline state
  const [oKw, setOKw] = useState("");
  const [oLoc, setOLoc] = useState("");
  const [oPer, setOPer] = useState("");
  const [oInt, setOInt] = useState("informational");
  const [oIns, setOIns] = useState("");
  const [serpData, setSerpData] = useState(null);
  const [outline, setOutline] = useState(null);
  const [editMode, setEditMode] = useState(false);

  // article state
  const [aKw, setAKw] = useState("");
  const [aLoc, setALoc] = useState("");
  const [aPer, setAPer] = useState("");
  const [aInt, setAInt] = useState("informational");
  const [aLen, setALen] = useState("1500");
  const [aIns, setAIns] = useState("");
  const [aJson, setAJson] = useState("");
  const [article, setArticle] = useState("");

  const outRef = useRef(null);
  const artRef = useRef(null);
  const intents = ["informational", "navigational", "transactional", "commercial investigation"];

  const scrapeSerp = async () => {
    if (!oKw.trim()) { setErr("Enter a keyword first."); return; }
    setBusy(true); setErr(""); setSerpData(null); setOutline(null);
    try {
      setBusyMsg("🔍 Searching & scraping top 10 ranking pages...");
      const raw = await callClaude(SERP_SYSTEM, serpPrompt(oKw, oLoc), true);
      const match = raw.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Could not extract SERP data. Please try again.");
      setSerpData(JSON.parse(match[0]));
    } catch (e) { setErr("SERP scrape failed: " + e.message); }
    finally { setBusy(false); setBusyMsg(""); }
  };

  const genOutline = async () => {
    if (!oKw.trim()) { setErr("Enter a keyword first."); return; }
    setBusy(true); setErr(""); setOutline(null);
    try {
      setBusyMsg("🧠 Building SEO outline from SERP intelligence...");
      const raw = await callClaude(OUTLINE_SYSTEM, outlinePrompt({
        keyword: oKw, location: oLoc, persona: oPer, intent: oInt,
        common: serpData ? JSON.stringify(serpData.common_headers) : "none",
        emerging: serpData ? JSON.stringify(serpData.emerging_headers) : "generate from knowledge",
        instructions: oIns,
      }));
      const match = raw.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Could not parse outline JSON.");
      setOutline(JSON.parse(match[0]));
      setEditMode(false);
      setTimeout(() => outRef.current?.scrollIntoView({ behavior: "smooth" }), 120);
    } catch (e) { setErr("Outline failed: " + e.message); }
    finally { setBusy(false); setBusyMsg(""); }
  };

  const useOutline = () => {
    if (!outline) return;
    setAKw(oKw); setALoc(oLoc); setAPer(oPer); setAInt(oInt);
    setAJson(JSON.stringify(outline, null, 2));
    setTab("article");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const genArticle = async () => {
    if (!aKw.trim()) { setErr("Keyword required."); return; }
    if (!aJson.trim()) { setErr("Outline JSON required."); return; }
    setBusy(true); setErr(""); setArticle("");
    try {
      setBusyMsg("✍️ Writing full article...");
      let parsed;
      try { parsed = JSON.parse(aJson); } catch { throw new Error("Invalid outline JSON."); }
      const text = await callClaude(ARTICLE_SYSTEM, articlePrompt({ keyword: aKw, location: aLoc, persona: aPer, intent: aInt, length: aLen, instructions: aIns, outline: parsed }));
      setArticle(text);
      setTimeout(() => artRef.current?.scrollIntoView({ behavior: "smooth" }), 120);
    } catch (e) { setErr("Article failed: " + e.message); }
    finally { setBusy(false); setBusyMsg(""); }
  };

  const copy = (t) => navigator.clipboard?.writeText(t);

  const GreenBtn = ({ onClick, label, busyLabel, small }) => (
    <button className="act-btn" onClick={onClick} disabled={busy}
      style={{ padding: small ? "10px 18px" : "13px 26px", background: busy ? "#0a1810" : "linear-gradient(135deg,#183c28,#0f2218)", border: "1px solid #2a5a3e", color: busy ? "#1e3a28" : "#5fe3a1", fontSize: "10px", letterSpacing: "0.18em", fontFamily: "IBM Plex Mono,monospace", cursor: busy ? "not-allowed" : "pointer", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 10 }}>
      {busy ? <><div style={{ width: 11, height: 11, border: "2px solid #1a3020", borderTopColor: "#5fe3a1", borderRadius: "50%", animation: "spin .7s linear infinite" }} />{busyLabel || "PROCESSING..."}</> : label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0b0e13", color: "#c4ddd0", fontFamily: "Source Serif 4,serif" }}>
      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(ellipse 70% 35% at 50% 0%,rgba(95,227,161,.04) 0%,transparent 65%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", inset: 0, backgroundImage: "linear-gradient(rgba(95,227,161,.016) 1px,transparent 1px),linear-gradient(90deg,rgba(95,227,161,.016) 1px,transparent 1px)", backgroundSize: "52px 52px", pointerEvents: "none" }} />

      <div style={{ position: "relative", maxWidth: 880, margin: "0 auto", padding: "40px 20px 100px" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 38 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 14px", background: "rgba(95,227,161,.05)", border: "1px solid rgba(95,227,161,.14)", borderRadius: 20, marginBottom: 14 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#5fe3a1", animation: "pulse 2s ease infinite" }} />
            <span style={{ fontSize: "9.5px", letterSpacing: "0.28em", color: "#5fe3a1", fontFamily: "IBM Plex Mono,monospace" }}>SEMANTIC SEO AGENT · 2025–2026</span>
          </div>
          <h1 style={{ fontFamily: "Playfair Display,serif", fontSize: "clamp(32px,6vw,56px)", fontWeight: 900, color: "#f0f5f0", lineHeight: 1.05, letterSpacing: "-0.02em", marginBottom: 9 }}>
            Content<br /><em style={{ color: "#5fe3a1" }}>Intelligence</em>
          </h1>
          <p style={{ fontSize: "10.5px", color: "#2a4a38", letterSpacing: "0.1em", fontFamily: "IBM Plex Mono,monospace" }}>LIVE SERP SCRAPING · EDITABLE OUTLINES · FULL ARTICLE GENERATION</p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", background: "#0d1117", border: "1px solid #1a2430", borderRadius: 8, padding: 4, marginBottom: 24, gap: 4 }}>
          {[
            { id: "outline", n: "01", name: "OUTLINE MODE", sub: "Scrape SERP → Edit → Confirm" },
            { id: "article", n: "02", name: "ARTICLE MODE", sub: "Write from Confirmed Outline" },
          ].map(t => (
            <button key={t.id} className="tab-btn" onClick={() => setTab(t.id)}
              style={{ flex: 1, padding: "12px 14px", borderRadius: 6, border: "none", cursor: "pointer", background: tab === t.id ? "linear-gradient(135deg,#0f2018,#0a1a14)" : "transparent", borderLeft: tab === t.id ? "2px solid #5fe3a1" : "2px solid transparent", textAlign: "left" }}>
              <div style={{ fontSize: "9.5px", letterSpacing: "0.16em", color: tab === t.id ? "#5fe3a1" : "#1e3a28", fontFamily: "IBM Plex Mono,monospace", marginBottom: 2 }}>{t.n} · {t.name}</div>
              <div style={{ fontSize: "11px", color: tab === t.id ? "#4a7a60" : "#152218" }}>{t.sub}</div>
            </button>
          ))}
        </div>

        {/* Status / Error */}
        {err && (
          <div className="fade-in" style={{ background: "rgba(239,68,68,.06)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 6, padding: "10px 14px", marginBottom: 16, display: "flex", gap: 9 }}>
            <span style={{ color: "#f87171", flexShrink: 0 }}>⚠</span>
            <span style={{ fontSize: "12.5px", color: "#f87171", fontFamily: "IBM Plex Mono,monospace" }}>{err}</span>
          </div>
        )}
        {busy && busyMsg && (
          <div style={{ background: "rgba(95,227,161,.05)", border: "1px solid rgba(95,227,161,.15)", borderRadius: 6, padding: "9px 14px", marginBottom: 16, display: "flex", gap: 9, alignItems: "center" }}>
            <div style={{ width: 11, height: 11, border: "2px solid #1a3020", borderTopColor: "#5fe3a1", borderRadius: "50%", animation: "spin .7s linear infinite", flexShrink: 0 }} />
            <span style={{ fontSize: "12px", color: "#4a8a68", fontFamily: "IBM Plex Mono,monospace" }}>{busyMsg}</span>
          </div>
        )}

        {/* ══ OUTLINE TAB ══ */}
        {tab === "outline" && (
          <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ background: "#0d1117", border: "1px solid #1a2430", borderRadius: 10, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: "9.5px", letterSpacing: "0.2em", color: "#2a5a40", fontFamily: "IBM Plex Mono,monospace", borderBottom: "1px solid #0f1820", paddingBottom: 11 }}>PARAMETERS</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13 }}>
                <Field label="TARGET KEYWORD *"><input style={IS} value={oKw} onChange={e => setOKw(e.target.value)} placeholder="e.g. best CRM software for startups" /></Field>
                <Field label="TARGET LOCATION" hint="optional"><input style={IS} value={oLoc} onChange={e => setOLoc(e.target.value)} placeholder="e.g. United Kingdom" /></Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13 }}>
                <Field label="AUDIENCE PERSONA"><input style={IS} value={oPer} onChange={e => setOPer(e.target.value)} placeholder="e.g. SaaS founder" /></Field>
                <Field label="SEARCH INTENT">
                  <select style={{ ...IS, cursor: "pointer" }} value={oInt} onChange={e => setOInt(e.target.value)}>
                    {intents.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="ADDITIONAL INSTRUCTIONS" hint="optional">
                <textarea style={{ ...TS, minHeight: 64 }} value={oIns} onChange={e => setOIns(e.target.value)} placeholder="e.g. Emphasise AI features. Include pricing table. Target enterprise buyers." />
              </Field>

              {/* Two-step action bar */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button className="act-btn" onClick={scrapeSerp} disabled={busy}
                  style={{ padding: "12px 20px", background: busy ? "#0a1218" : "linear-gradient(135deg,#101e2e,#0a1520)", border: "1px solid #1e3a5a", color: busy ? "#1a3040" : "#7ab4e8", fontSize: "10px", letterSpacing: "0.16em", fontFamily: "IBM Plex Mono,monospace", cursor: busy ? "not-allowed" : "pointer", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 9 }}>
                  {busy && busyMsg?.includes("Searching") ? <div style={{ width: 11, height: 11, border: "2px solid #1a3040", borderTopColor: "#7ab4e8", borderRadius: "50%", animation: "spin .7s linear infinite" }} /> : "🔍"} SCRAPE TOP 10 SERP
                </button>
                <span style={{ fontSize: "9px", color: "#1e3028", fontFamily: "IBM Plex Mono,monospace" }}>then</span>
                <GreenBtn onClick={genOutline} label="GENERATE OUTLINE →" busyLabel="BUILDING OUTLINE..." />
              </div>
              <div style={{ fontSize: "10.5px", color: "#1a3228", fontFamily: "IBM Plex Mono,monospace", lineHeight: 1.6 }}>
                ℹ Scraping is optional but recommended — it feeds real competitor headers into the outline.
              </div>
            </div>

            {/* SERP panel */}
            {serpData && <SerpPanel data={serpData} />}

            {/* Outline output */}
            {outline && (
              <div ref={outRef} className="fade-in">
                {/* Toolbar */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 9 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: "9.5px", letterSpacing: "0.18em", color: "#5fe3a1", fontFamily: "IBM Plex Mono,monospace" }}>✓ OUTLINE READY</div>
                    <button onClick={() => setEditMode(m => !m)}
                      style={{ fontSize: "10px", letterSpacing: "0.1em", color: editMode ? "#5fe3a1" : "#3a5a48", background: editMode ? "rgba(95,227,161,.1)" : "transparent", border: `1px solid ${editMode ? "#5fe3a1" : "#1a2430"}`, padding: "5px 12px", cursor: "pointer", fontFamily: "IBM Plex Mono,monospace", borderRadius: 4, transition: "all .15s" }}>
                      {editMode ? "✎ EDITING MODE ON" : "✎ EDIT OUTLINE"}
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="copy-btn" onClick={() => copy(JSON.stringify(outline, null, 2))}
                      style={{ fontSize: "10px", letterSpacing: "0.1em", color: "#3a5a48", background: "transparent", border: "1px solid #1a2430", padding: "5px 12px", cursor: "pointer", fontFamily: "IBM Plex Mono,monospace", borderRadius: 4, transition: "all .2s" }}>COPY JSON</button>
                    <button className="act-btn" onClick={useOutline}
                      style={{ fontSize: "10px", letterSpacing: "0.1em", color: "#5fe3a1", background: "linear-gradient(135deg,#0f2018,#0a1810)", border: "1px solid #2a5a38", padding: "5px 13px", cursor: "pointer", fontFamily: "IBM Plex Mono,monospace", borderRadius: 4, transition: "all .18s" }}>USE FOR ARTICLE →</button>
                  </div>
                </div>

                {editMode
                  ? <OutlineEditor outline={outline} onChange={setOutline} />
                  : <OutlineReadView outline={outline} />
                }

                {editMode && (
                  <div style={{ marginTop: 13, display: "flex", justifyContent: "flex-end", gap: 9 }}>
                    <button className="act-btn" onClick={() => setEditMode(false)}
                      style={{ padding: "10px 20px", background: "#0a1810", border: "1px solid #2a5a38", color: "#5fe3a1", fontSize: "10px", letterSpacing: "0.14em", fontFamily: "IBM Plex Mono,monospace", cursor: "pointer", borderRadius: 6 }}>✓ DONE EDITING</button>
                    <button className="act-btn" onClick={useOutline}
                      style={{ padding: "10px 20px", background: "linear-gradient(135deg,#183c28,#0f2218)", border: "1px solid #3a7a50", color: "#7afabc", fontSize: "10px", letterSpacing: "0.14em", fontFamily: "IBM Plex Mono,monospace", cursor: "pointer", borderRadius: 6 }}>CONFIRM & USE FOR ARTICLE →</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══ ARTICLE TAB ══ */}
        {tab === "article" && (
          <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ background: "#0d1117", border: "1px solid #1a2430", borderRadius: 10, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: "9.5px", letterSpacing: "0.2em", color: "#2a5a40", fontFamily: "IBM Plex Mono,monospace", borderBottom: "1px solid #0f1820", paddingBottom: 11 }}>ARTICLE PARAMETERS</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13 }}>
                <Field label="TARGET KEYWORD *"><input style={IS} value={aKw} onChange={e => setAKw(e.target.value)} placeholder="e.g. best CRM for startups" /></Field>
                <Field label="TARGET LOCATION"><input style={IS} value={aLoc} onChange={e => setALoc(e.target.value)} placeholder="e.g. United Kingdom" /></Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 13 }}>
                <Field label="PERSONA"><input style={IS} value={aPer} onChange={e => setAPer(e.target.value)} placeholder="SaaS founder" /></Field>
                <Field label="INTENT">
                  <select style={{ ...IS, cursor: "pointer" }} value={aInt} onChange={e => setAInt(e.target.value)}>
                    {intents.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </Field>
                <Field label="WORD COUNT">
                  <select style={{ ...IS, cursor: "pointer" }} value={aLen} onChange={e => setALen(e.target.value)}>
                    {["800", "1200", "1500", "2000", "2500", "3000"].map(l => <option key={l} value={l}>{l} words</option>)}
                  </select>
                </Field>
              </div>
              <Field label="CONFIRMED OUTLINE JSON *" hint="auto-filled from Outline Mode or paste manually">
                <textarea style={{ ...TS, minHeight: 200, fontFamily: "IBM Plex Mono,monospace", fontSize: "11px", color: "#5fe3a1" }}
                  value={aJson} onChange={e => setAJson(e.target.value)}
                  placeholder={'{\n  "title": "...",\n  "sections": [...],\n  "faq": [...]\n}'} />
              </Field>
              <Field label="WRITING INSTRUCTIONS" hint="tone, style">
                <textarea style={{ ...TS, minHeight: 64 }} value={aIns} onChange={e => setAIns(e.target.value)} placeholder="e.g. Confident, approachable tone. UK English. Strong intro hook. Real-world examples." />
              </Field>
              <GreenBtn onClick={genArticle} label="GENERATE FULL ARTICLE →" busyLabel="WRITING ARTICLE..." />
            </div>

            {article && (
              <div ref={artRef} className="fade-in">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                    <div style={{ fontSize: "9.5px", letterSpacing: "0.18em", color: "#5fe3a1", fontFamily: "IBM Plex Mono,monospace" }}>✓ ARTICLE GENERATED</div>
                    <span style={{ fontSize: "10px", color: "#2a4a38", fontFamily: "IBM Plex Mono,monospace" }}>{article.split(/\s+/).length} words · ~{Math.ceil(article.split(/\s+/).length / 238)} min read</span>
                  </div>
                  <button className="copy-btn" onClick={() => copy(article)}
                    style={{ fontSize: "10px", letterSpacing: "0.1em", color: "#3a5a48", background: "transparent", border: "1px solid #1a2430", padding: "6px 12px", cursor: "pointer", fontFamily: "IBM Plex Mono,monospace", borderRadius: 4, transition: "all .2s" }}>COPY MARKDOWN</button>
                </div>
                <div style={{ background: "#0d1117", border: "1px solid #1a2430", borderRadius: 10, padding: "28px 32px" }}>
                  <MD text={article} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
