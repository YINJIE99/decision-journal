import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const CONFIDENCE_LABELS = ["直觉", "有依据", "较确信", "高确信", "几乎确定"];
const EMOTION_OPTIONS = ["冷静", "兴奋", "焦虑", "压力大", "乐观", "犹豫", "冲动", "疲惫"];
const ACC_LABELS = ["完全偏离", "部分偏离", "基本吻合", "较为准确", "精准预判"];
const ACC_COLORS = ["#e74c3c","#e67e22","#f1c40f","#2ecc71","#27ae60"];
const ATTR_OPTIONS = [
  { value: "logic_confirmed", label: "逻辑验证", desc: "结果符合分析框架，判断链条成立", color: "var(--review-accent)" },
  { value: "execution_drift", label: "执行变形", desc: "方向对但执行走样，或时机/节奏出了问题", color: "#e67e22" },
  { value: "surprise_variable", label: "意外变量", desc: "出现了分析框架外的因素，非判断力问题", color: "#9b59b6" },
];
const STANCE_OPTIONS = [
  { value: "hold", label: "坚持原判", desc: "确信不动摇，镜像分析加强了我的信心", color: "var(--accent)" },
  { value: "adjust", label: "微调执行", desc: "方向不变，但调整具体做法、节奏或风控", color: "#e67e22" },
  { value: "overturn", label: "推翻重来", desc: "根本性改变决策，镜像揭示了致命问题", color: "#e74c3c" },
];
const STORAGE_KEY = "decision-journal-entries";

const emptyEntry = () => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  date: new Date().toISOString().slice(0, 10),
  title: "",
  context: "",
  options: "",
  decision: "",
  devilsAdvocate: "",
  expectedOutcome: "",
  confidence: 2,
  emotions: [],
  reviewDate: "",
  historicalParallel: "",
  // Decision drift (post-mirror)
  mirrorSummary: "",
  postMirrorStance: "",
  confidence2: -1,
  emotions2: [],
  // Review
  actualOutcome: "",
  outcomeAttribution: "",
  lessonLearned: "",
  predictionAccuracy: -1,
});

/* ─── Storage ─── */
const store = {
  async load() {
    if (window.storage?.get) {
      try { const r = await window.storage.get(STORAGE_KEY); if (r) return JSON.parse(r.value); } catch {}
    }
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
  },
  async save(entries) {
    const json = JSON.stringify(entries);
    if (window.storage?.set) { try { await window.storage.set(STORAGE_KEY, json); } catch {} }
    try { localStorage.setItem(STORAGE_KEY, json); } catch {}
  }
};

/* ─── Utilities ─── */
function groupByTime(entries) {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const tree = {};
  sorted.forEach(e => { const [y, m] = e.date.split("-"); if (!tree[y]) tree[y] = {}; if (!tree[y][m]) tree[y][m] = []; tree[y][m].push(e); });
  return tree;
}
const MONTHS = {"01":"一月","02":"二月","03":"三月","04":"四月","05":"五月","06":"六月","07":"七月","08":"八月","09":"九月","10":"十月","11":"十一月","12":"十二月"};
function dayLabel(ds) { const d = new Date(ds+"T00:00:00"); return `${d.getDate()}日 · 周${"日一二三四五六"[d.getDay()]}`; }
function daysSince(ds) { return Math.floor((Date.now() - new Date(ds).getTime()) / 864e5); }

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(s) { return s.replace(/[\/\\:*?"<>|]/g, "").replace(/\s+/g, "_").slice(0, 30); }

/* ─── Copy formatter ─── */
function formatEntryForCopy(entry) {
  const s = [];
  s.push(`# 决策日志：${entry.title}`);
  s.push(`**日期**：${entry.date}`);
  if (entry.context) s.push(`## 情境\n${entry.context}`);
  if (entry.options) s.push(`## 考虑过的选项\n${entry.options}`);
  if (entry.decision) s.push(`## 我的选择与理由\n${entry.decision}`);
  if (entry.devilsAdvocate) s.push(`## 致命盲区（我自己写的预尸检）\n${entry.devilsAdvocate}`);
  if (entry.expectedOutcome) s.push(`## 预期结果\n${entry.expectedOutcome}`);
  s.push(`**确信度**：${CONFIDENCE_LABELS[entry.confidence]}（${entry.confidence}/4）`);
  if (entry.emotions.length > 0) s.push(`**决策时情绪**：${entry.emotions.join("、")}`);

  const prompt = `---

以上是我的一条决策日志，包含我自己写的预尸检。请你作为"历史镜像顾问"，帮我完成以下工作：

1. **找出2-3个历史镜像**：从商业史、政治史、科技史或其他领域中，找到结构上与我这个决策高度相似的真实案例。要具体到人名、时间、决策节点，说明因果链条与我的情境有哪些同构之处。

2. **这些镜像中的人最终怎样了？** 分别说明成功和失败的案例，提取出导致不同结局的关键分叉变量。

3. **照妖镜**：基于我的情绪状态（${entry.emotions.join("、") || "未记录"}）和确信度（${CONFIDENCE_LABELS[entry.confidence]}），指出我可能存在的认知偏差。审视我写的"致命盲区"——我的预尸检是否避重就轻？有没有我刻意回避但更可能致命的失败路径？

4. **补充预尸检**：在我写的预尸检基础上，补充1-2个我没想到的失败剧本，特别是那些"结构性相似案例中反复出现、但当事人几乎从未预见到"的死法。

请用中文回答，保持结构清晰但不要套话。`;
  return s.join("\n\n") + "\n\n" + prompt;
}

/* ─── Batch export formatter ─── */
function formatBatchExport(entries) {
  return {
    exported_at: new Date().toISOString(),
    count: entries.length,
    analysis_prompt: `以下JSON包含${entries.length}条决策日志记录。每条记录包含两轮填写数据：第一轮是决策时刻的原始判断（confidence, emotions），第二轮是获取AI历史镜像分析后的偏移数据（confidence2, emotions2, postMirrorStance）。

请分析这位决策者的认知特征：
1. **校准能力**：对比确信度与最终准确度（predictionAccuracy），这个人的直觉靠谱吗？在哪些情绪状态下最容易失准？
2. **镜像敏感度**：对比两轮确信度和情绪的变化幅度。这个人看到历史案例后容易动摇吗？还是顽固不化？频繁推翻决策（overturn）说明什么？从不推翻又说明什么？
3. **气质画像**：综合以上数据，这个人更倾向于过度自信还是过度犹豫？有没有特定的"危险组合"（比如某种情绪+高确信度=必翻车）？
4. **给出3条具体建议**：基于数据模式，这个人在未来做决策时应该注意什么？

请用数据说话，引用具体记录作为证据。`,
    entries: entries.map(e => ({
      id: e.id,
      date: e.date,
      title: e.title,
      context: e.context,
      decision: e.decision,
      devilsAdvocate: e.devilsAdvocate,
      expectedOutcome: e.expectedOutcome,
      confidence_round1: { level: e.confidence, label: CONFIDENCE_LABELS[e.confidence], emotions: e.emotions },
      historical_mirror: e.historicalParallel || null,
      mirror_summary: e.mirrorSummary || null,
      confidence_round2: e.confidence2 >= 0 ? { level: e.confidence2, label: CONFIDENCE_LABELS[e.confidence2], emotions: e.emotions2, stance: e.postMirrorStance, confidence_delta: e.confidence2 - e.confidence } : null,
      review: e.actualOutcome ? { actual_outcome: e.actualOutcome, accuracy: e.predictionAccuracy >= 0 ? { score: e.predictionAccuracy, label: ACC_LABELS[e.predictionAccuracy] } : null, attribution: e.outcomeAttribution || null, lesson: e.lessonLearned || null } : null,
    }))
  };
}

/* ─── Shared styles ─── */
const S = {
  btn: { padding: "7px 16px", borderRadius: "8px", border: "none", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s ease" },
  input: { width: "100%", padding: "10px 12px", borderRadius: "8px", fontSize: "13.5px", border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontFamily: "inherit", boxSizing: "border-box", outline: "none" },
  treeBtn: { display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", color: "var(--text-primary)", cursor: "pointer", padding: "6px 4px", fontFamily: "inherit", width: "100%", textAlign: "left" },
  sectionHead: { fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, margin: "0 0 16px" },
  tag: { fontSize: "11px", padding: "2px 8px", borderRadius: "10px" },
};

/* ─── UI Primitives ─── */
function Chevron({ open }) { return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ transform: open ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s ease", flexShrink: 0 }}><path d="M6.5 4L12 9L6.5 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function Field({ label, hint, children }) { return <div style={{ marginBottom: "18px" }}><label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>{label}</label>{hint && <p style={{ fontSize: "12px", color: "var(--text-tertiary)", margin: "0 0 6px", lineHeight: 1.5, fontStyle: "italic" }}>{hint}</p>}{children}</div>; }

function AutoTextarea({ value, onChange, placeholder, readOnly, minRows = 2 }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) { ref.current.style.height = "auto"; ref.current.style.height = ref.current.scrollHeight + "px"; } }, [value]);
  return <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly} rows={minRows}
    style={{ ...S.input, lineHeight: 1.65, resize: "none", overflow: "hidden", background: readOnly ? "var(--bg-tertiary)" : "var(--bg-secondary)" }}
    onFocus={e => { if (!readOnly) e.target.style.borderColor = "var(--accent)"; }} onBlur={e => { e.target.style.borderColor = "var(--border)"; }} />;
}

function ConfidenceBar({ value, onChange, label }) {
  const v = value < 0 ? 2 : value;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: "4px" }}>
        {[0,1,2,3,4].map(i => <button key={i} onClick={() => onChange(i)} style={{ width: "32px", height: "10px", borderRadius: "3px", border: "none", background: i <= v ? (label ? "var(--drift-accent)" : "var(--accent)") : "var(--bg-tertiary)", opacity: i <= v ? (0.5 + (i/4)*0.5) : 0.4, cursor: "pointer", transition: "all 0.15s ease" }} />)}
      </div>
      <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{CONFIDENCE_LABELS[v]}</span>
    </div>
  );
}

function EmotionPicker({ selected, onChange, accentColor }) {
  const ac = accentColor || "var(--accent)";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {EMOTION_OPTIONS.map(em => {
        const on = selected.includes(em);
        return <button key={em} onClick={() => onChange(on ? selected.filter(e => e !== em) : [...selected, em])}
          style={{ padding: "4px 12px", borderRadius: "20px", fontSize: "12.5px", fontFamily: "inherit", border: `1px solid ${on ? ac : "var(--border)"}`, background: on ? ac + "18" : "transparent", color: on ? ac : "var(--text-secondary)", cursor: "pointer", transition: "all 0.15s ease" }}>{em}</button>;
      })}
    </div>
  );
}

function AccuracySelector({ value, onChange }) {
  return <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>{ACC_LABELS.map((label, i) => <button key={i} onClick={() => onChange(i)} style={{ padding: "4px 12px", borderRadius: "20px", fontSize: "12.5px", fontFamily: "inherit", border: `1.5px solid ${value === i ? ACC_COLORS[i] : "var(--border)"}`, background: value === i ? ACC_COLORS[i] + "18" : "transparent", color: value === i ? ACC_COLORS[i] : "var(--text-secondary)", cursor: "pointer", transition: "all 0.15s ease" }}>{label}</button>)}</div>;
}

function AttributionPicker({ value, onChange }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>{ATTR_OPTIONS.map(opt => {
    const on = value === opt.value;
    return <button key={opt.value} onClick={() => onChange(on ? "" : opt.value)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "10px", border: `1.5px solid ${on ? opt.color : "var(--border)"}`, background: on ? opt.color + "12" : "transparent", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s ease", textAlign: "left" }}>
      <div style={{ width: "10px", height: "10px", borderRadius: "50%", border: `2px solid ${on ? opt.color : "var(--border)"}`, background: on ? opt.color : "transparent", flexShrink: 0 }} />
      <div><div style={{ fontSize: "13px", fontWeight: 600, color: on ? opt.color : "var(--text-primary)" }}>{opt.label}</div><div style={{ fontSize: "11.5px", color: "var(--text-tertiary)", marginTop: "1px" }}>{opt.desc}</div></div>
    </button>;
  })}</div>;
}

function StancePicker({ value, onChange }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>{STANCE_OPTIONS.map(opt => {
    const on = value === opt.value;
    return <button key={opt.value} onClick={() => onChange(on ? "" : opt.value)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "10px", border: `1.5px solid ${on ? opt.color : "var(--border)"}`, background: on ? opt.color + "12" : "transparent", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s ease", textAlign: "left" }}>
      <div style={{ width: "10px", height: "10px", borderRadius: "50%", border: `2px solid ${on ? opt.color : "var(--border)"}`, background: on ? opt.color : "transparent", flexShrink: 0 }} />
      <div><div style={{ fontSize: "13px", fontWeight: 600, color: on ? opt.color : "var(--text-primary)" }}>{opt.label}</div><div style={{ fontSize: "11.5px", color: "var(--text-tertiary)", marginTop: "1px" }}>{opt.desc}</div></div>
    </button>;
  })}</div>;
}

function Toast({ message }) {
  if (!message) return null;
  return <div style={{ position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)", padding: "10px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 500, background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--accent)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", zIndex: 999, animation: "fadeSlideIn 0.25s ease", maxWidth: "90vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message}</div>;
}

function ReviewAnchor({ label, text }) {
  if (!text) return null;
  return <div style={{ marginBottom: "12px" }}><div style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--text-tertiary)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div><div style={{ padding: "10px 14px", borderRadius: "8px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{text}</div></div>;
}

/* ─── Calibration Panel ─── */
function CalibrationPanel({ entries }) {
  const stats = useMemo(() => {
    const now = new Date(); const todayStr = now.toISOString().slice(0, 10);
    const reviewed = entries.filter(e => !!e.actualOutcome);
    const scored = entries.filter(e => e.predictionAccuracy >= 0);
    const judgmentScored = scored.filter(e => e.outcomeAttribution !== "surprise_variable");
    const avgAcc = judgmentScored.length > 0 ? judgmentScored.reduce((s, e) => s + e.predictionAccuracy, 0) / judgmentScored.length : null;
    const needsReview = entries.filter(e => { if (e.actualOutcome) return false; const over90 = (now - new Date(e.date)) > 90*864e5; const sd = e.reviewDate && e.reviewDate <= todayStr; return over90 || sd; });
    const surpriseCount = scored.filter(e => e.outcomeAttribution === "surprise_variable").length;
    const confMatrix = [0,1,2,3,4].map(conf => { const g = judgmentScored.filter(e => e.confidence === conf); if (!g.length) return { conf, count: 0, avgAcc: null }; return { conf, count: g.length, avgAcc: g.reduce((s, e) => s + e.predictionAccuracy, 0) / g.length }; });
    const emotionMatrix = EMOTION_OPTIONS.map(em => { const g = judgmentScored.filter(e => e.emotions.includes(em)); if (!g.length) return { emotion: em, count: 0, avgAcc: null }; return { emotion: em, count: g.length, avgAcc: g.reduce((s, e) => s + e.predictionAccuracy, 0) / g.length }; }).filter(e => e.count > 0);
    const hc = judgmentScored.filter(e => e.confidence >= 3); const oc = hc.filter(e => e.predictionAccuracy <= 1);
    const overconfRate = hc.length > 0 ? oc.length / hc.length : null;
    return { reviewed, scored, judgmentScored, avgAcc, needsReview, confMatrix, emotionMatrix, overconfRate, surpriseCount, total: entries.length };
  }, [entries]);
  const barW = (val, max) => max > 0 ? `${Math.max((val/max)*100, 4)}%` : "4%";
  const barColor = avg => avg >= 2.5 ? "var(--review-accent)" : avg >= 1.5 ? "#f0a030" : "#e74c3c";

  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
        {[
          { label: "总记录", value: stats.total, color: "var(--accent)" },
          { label: "已回顾", value: stats.reviewed.length, color: "var(--review-accent)" },
          { label: "待回顾", value: stats.needsReview.length, color: stats.needsReview.length > 0 ? "#e67e22" : "var(--text-tertiary)" },
          { label: "判断力均分", value: stats.avgAcc !== null ? stats.avgAcc.toFixed(1)+"/4" : "—", color: "var(--text-secondary)" },
        ].map(s => <div key={s.label} style={{ flex: "1 1 90px", padding: "12px 14px", borderRadius: "10px", background: "var(--bg-secondary)", border: "1px solid var(--border)", minWidth: "85px" }}><div style={{ fontSize: "20px", fontWeight: 700, color: s.color, fontFamily: "var(--font-display)" }}>{s.value}</div><div style={{ fontSize: "11.5px", color: "var(--text-tertiary)", marginTop: "2px" }}>{s.label}</div></div>)}
      </div>
      {stats.surpriseCount > 0 && <div style={{ fontSize: "12px", color: "#9b59b6", marginBottom: "10px", padding: "8px 12px", borderRadius: "8px", background: "#9b59b612", border: "1px solid #9b59b620" }}>📌 {stats.surpriseCount} 条标记为"意外变量"，已从判断力校准中排除</div>}
      {stats.judgmentScored.length >= 3 && (
        <div style={{ background: "var(--bg-secondary)", borderRadius: "12px", padding: "16px 18px", border: "1px solid var(--border)" }}>
          <p style={{ ...S.sectionHead, color: "var(--accent)", marginBottom: "14px" }}>▎认知校准</p>
          {stats.overconfRate !== null && stats.overconfRate > 0.4 && <div style={{ padding: "10px 14px", borderRadius: "8px", marginBottom: "14px", background: "#e74c3c12", border: "1px solid #e74c3c30", fontSize: "12.5px", color: "#e74c3c", lineHeight: 1.6 }}>⚠ 高确信/几乎确定时，<b>{Math.round(stats.overconfRate*100)}%</b> 最终偏离预期。你的极度自信目前是<b>反向指标</b>。</div>}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px", fontWeight: 600 }}>确信度 → 实际准确度（仅判断力）</div>
            {stats.confMatrix.map(row => <div key={row.conf} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}><div style={{ width: "56px", fontSize: "11.5px", color: "var(--text-tertiary)", textAlign: "right", flexShrink: 0 }}>{CONFIDENCE_LABELS[row.conf]}</div><div style={{ flex: 1, height: "14px", background: "var(--bg-tertiary)", borderRadius: "4px", overflow: "hidden" }}>{row.count > 0 && <div style={{ height: "100%", borderRadius: "4px", transition: "width 0.4s ease", width: barW(row.avgAcc, 4), background: barColor(row.avgAcc) }} />}</div><div style={{ width: "52px", fontSize: "11px", color: "var(--text-tertiary)", flexShrink: 0 }}>{row.count > 0 ? `${row.avgAcc.toFixed(1)} (${row.count})` : "—"}</div></div>)}
          </div>
          {stats.emotionMatrix.length > 0 && <div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px", fontWeight: 600 }}>情绪状态 → 实际准确度（仅判断力）</div>
            {stats.emotionMatrix.sort((a,b) => a.avgAcc - b.avgAcc).map(row => <div key={row.emotion} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}><div style={{ width: "56px", fontSize: "11.5px", color: "var(--text-tertiary)", textAlign: "right", flexShrink: 0 }}>{row.emotion}</div><div style={{ flex: 1, height: "14px", background: "var(--bg-tertiary)", borderRadius: "4px", overflow: "hidden" }}><div style={{ height: "100%", borderRadius: "4px", transition: "width 0.4s ease", width: barW(row.avgAcc, 4), background: barColor(row.avgAcc) }} /></div><div style={{ width: "52px", fontSize: "11px", color: "var(--text-tertiary)", flexShrink: 0 }}>{`${row.avgAcc.toFixed(1)} (${row.count})`}</div></div>)}
          </div>}
        </div>
      )}
    </div>
  );
}

/* ─── Review Reminder ─── */
function ReviewReminder({ entries, onEdit }) {
  const now = new Date(); const todayStr = now.toISOString().slice(0, 10);
  const needsReview = entries.filter(e => { if (e.actualOutcome) return false; const over90 = (now - new Date(e.date)) > 90*864e5; const sd = e.reviewDate && e.reviewDate <= todayStr; return over90 || sd; }).sort((a,b) => a.date.localeCompare(b.date));
  if (!needsReview.length) return null;
  const urgencyColor = days => days > 270 ? "#e74c3c" : days > 180 ? "#e67e22" : "#f0a030";
  return (
    <div style={{ marginBottom: "20px", borderRadius: "12px", overflow: "hidden", border: "1px solid #e67e2240", background: "#e67e2208" }}>
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid #e67e2225" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e67e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#e67e22" }}>{needsReview.length} 条决策等待回顾</span>
      </div>
      <div style={{ padding: "8px" }}>{needsReview.map(entry => {
        const days = daysSince(entry.date); const sch = entry.reviewDate && entry.reviewDate <= todayStr; const od = sch ? daysSince(entry.reviewDate) : 0;
        return <div key={entry.id} onClick={() => onEdit(entry)} style={{ padding: "10px 12px", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", transition: "background 0.15s ease" }} onMouseEnter={e => e.currentTarget.style.background = "#e67e2212"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.title}</div><div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "2px" }}>{entry.date} · {CONFIDENCE_LABELS[entry.confidence]}</div></div>
          {sch ? <div style={{ padding: "4px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", color: od > 0 ? "#e74c3c" : "#e67e22", background: (od > 0 ? "#e74c3c" : "#e67e22") + "15" }}>{od > 0 ? `逾期${od}天` : "今天"}</div>
               : <div style={{ padding: "4px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", color: urgencyColor(days), background: urgencyColor(days) + "15" }}>{days}天前</div>}
        </div>;
      })}</div>
    </div>
  );
}

/* ─── Entry Card with drawdown + multi-select ─── */
function EntryCard({ entry, onEdit, selectable, selected, onToggle }) {
  const hasReview = !!entry.actualOutcome;
  const isDrawdown = hasReview && entry.confidence >= 3 && entry.predictionAccuracy >= 0 && entry.predictionAccuracy <= 1 && entry.outcomeAttribution !== "surprise_variable";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
      {selectable && (
        <button onClick={e => { e.stopPropagation(); onToggle(entry.id); }} style={{ width: "20px", height: "20px", borderRadius: "5px", border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}`, background: selected ? "var(--accent)" : "transparent", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s ease", padding: 0 }}>
          {selected && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="#0e0f11" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </button>
      )}
      <div onClick={onEdit} style={{ flex: 1, padding: "14px 16px", borderRadius: "10px", cursor: "pointer", background: "var(--bg-secondary)", border: `1px solid ${isDrawdown ? "#e74c3c60" : "var(--border)"}`, boxShadow: isDrawdown ? "0 0 8px #e74c3c15" : "none", transition: "all 0.15s ease" }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = isDrawdown ? "#e74c3c" : "var(--accent)"; e.currentTarget.style.transform = "translateX(4px)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = isDrawdown ? "#e74c3c60" : "var(--border)"; e.currentTarget.style.transform = "translateX(0)"; }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "14.5px", fontWeight: 600, color: isDrawdown ? "#e74c3c" : "var(--text-primary)", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.title || "无标题"}{isDrawdown && " ⚠"}</div>
            {entry.context && <div style={{ fontSize: "12.5px", color: "var(--text-tertiary)", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.context}</div>}
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }}>
            {entry.emotions.slice(0, 2).map(em => <span key={em} style={{ ...S.tag, background: "var(--accent-faint)", color: "var(--accent)" }}>{em}</span>)}
            {hasReview && entry.predictionAccuracy >= 0 && <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: ACC_COLORS[entry.predictionAccuracy] }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Timeline ─── */
function Timeline({ entries, onEdit, selectable, selectedIds, onToggle }) {
  const [openYears, setOpenYears] = useState({});
  const [openMonths, setOpenMonths] = useState({});
  const tree = groupByTime(entries);
  const years = Object.keys(tree).sort((a,b) => b.localeCompare(a));
  useEffect(() => {
    if (years.length > 0 && !Object.keys(openYears).length) {
      const y0 = years[0]; setOpenYears({ [y0]: true });
      const ms = Object.keys(tree[y0]).sort((a,b) => b.localeCompare(a));
      if (ms.length) setOpenMonths({ [`${y0}-${ms[0]}`]: true });
    }
  }, [entries.length]);

  if (!entries.length) return <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-tertiary)" }}><div style={{ fontSize: "40px", marginBottom: "16px", opacity: 0.5 }}>📖</div><p style={{ fontSize: "15px", fontWeight: 500, margin: "0 0 6px" }}>还没有决策记录</p><p style={{ fontSize: "13px", margin: 0 }}>点击右上角开始记录你的第一个决策</p></div>;

  return <div>{years.map(year => <div key={year} style={{ marginBottom: "8px" }}>
    <button onClick={() => setOpenYears(p => ({ ...p, [year]: !p[year] }))} style={{ ...S.treeBtn, fontSize: "16px", fontWeight: 700, fontFamily: "var(--font-display)" }}><Chevron open={openYears[year]} /><span>{year}年</span><span style={{ fontSize: "12px", fontWeight: 400, color: "var(--text-tertiary)", marginLeft: "8px" }}>{Object.values(tree[year]).flat().length}条</span></button>
    {openYears[year] && <div style={{ paddingLeft: "12px", borderLeft: "2px solid var(--border)", marginLeft: "8px" }}>
      {Object.keys(tree[year]).sort((a,b) => b.localeCompare(a)).map(month => {
        const mk = `${year}-${month}`; const dg = {}; tree[year][month].forEach(e => { if (!dg[e.date]) dg[e.date] = []; dg[e.date].push(e); });
        return <div key={mk} style={{ marginBottom: "4px" }}>
          <button onClick={() => setOpenMonths(p => ({ ...p, [mk]: !p[mk] }))} style={{ ...S.treeBtn, fontSize: "14px", fontWeight: 600 }}><Chevron open={openMonths[mk]} /><span>{MONTHS[month]}</span><span style={{ fontSize: "12px", fontWeight: 400, color: "var(--text-tertiary)", marginLeft: "8px" }}>{tree[year][month].length}条</span></button>
          {openMonths[mk] && <div style={{ paddingLeft: "12px", borderLeft: "2px solid var(--border)", marginLeft: "8px" }}>
            {Object.keys(dg).sort((a,b) => b.localeCompare(a)).map(date => <div key={date} style={{ marginBottom: "4px" }}>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", padding: "6px 0 4px", fontWeight: 500 }}>{dayLabel(date)}</div>
              {dg[date].map(entry => <EntryCard key={entry.id} entry={entry} onEdit={() => onEdit(entry)} selectable={selectable} selected={selectedIds.has(entry.id)} onToggle={onToggle} />)}
            </div>)}
          </div>}
        </div>;
      })}
    </div>}
  </div>)}</div>;
}

/* ─── Entry Form ─── */
function EntryForm({ entry, onChange, onSave, onDelete, onCancel, isNew }) {
  const update = (k, v) => onChange({ ...entry, [k]: v });
  const canSave = entry.title.trim().length > 0;
  const [toast, setToast] = useState(null);
  const showToast = (msg, ms = 3000) => { setToast(msg); setTimeout(() => setToast(null), ms); };
  const handleCopy = async () => {
    if (!entry.title.trim() || (!entry.context && !entry.decision)) { showToast("请至少填写标题和情境/选择"); return; }
    try { await navigator.clipboard.writeText(formatEntryForCopy(entry)); showToast("已复制！粘贴到新对话即可获取历史镜像分析"); } catch { showToast("复制失败，请重试"); }
  };
  const hasAnchors = entry.expectedOutcome || entry.devilsAdvocate;
  const hasDrift = entry.mirrorSummary || entry.postMirrorStance || entry.confidence2 >= 0;
  const confDelta = entry.confidence2 >= 0 ? entry.confidence2 - entry.confidence : null;

  return (
    <div style={{ animation: "fadeSlideIn 0.3s ease", position: "relative" }}>
      <Toast message={toast} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "10px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-display)" }}>{isNew ? "📝 新决策记录" : "编辑记录"}</h2>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={onCancel} style={{ ...S.btn, background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>取消</button>
          {!isNew && <button onClick={onDelete} style={{ ...S.btn, background: "#e74c3c18", color: "#e74c3c" }}>删除</button>}
          <button onClick={onSave} disabled={!canSave} style={{ ...S.btn, background: canSave ? "var(--accent)" : "var(--bg-tertiary)", color: canSave ? "#fff" : "var(--text-tertiary)" }}>保存</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", marginBottom: "18px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}><Field label="决策标题"><input value={entry.title} onChange={e => update("title", e.target.value)} placeholder="用一句话命名这个决策" style={S.input} /></Field></div>
        <div style={{ flex: "0 0 160px" }}><Field label="日期"><input type="date" value={entry.date} onChange={e => update("date", e.target.value)} style={S.input} /></Field></div>
      </div>

      {/* ── Section 1: Decision ── */}
      <div style={{ background: "var(--bg-secondary)", borderRadius: "12px", padding: "20px", marginBottom: "16px", border: "1px solid var(--border)" }}>
        <p style={{ ...S.sectionHead, color: "var(--accent)" }}>▎决策时刻</p>
        <Field label="情境" hint="我当时面临什么情况？是什么迫使我需要做决策？"><AutoTextarea value={entry.context} onChange={v => update("context", v)} placeholder="描述决策背景和触发条件..." /></Field>
        <Field label="选项" hint="我考虑了哪些方案？各自的利弊是什么？"><AutoTextarea value={entry.options} onChange={v => update("options", v)} placeholder="列出你考虑过的选项..." /></Field>
        <Field label="我的选择与理由" hint="最终选了什么？当时说服自己的核心逻辑是什么？"><AutoTextarea value={entry.decision} onChange={v => update("decision", v)} placeholder="我决定..." /></Field>

        <div style={{ background: "#e74c3c08", borderRadius: "10px", padding: "16px", marginBottom: "18px", border: "1px solid #e74c3c20" }}>
          <Field label="🔪 致命盲区" hint="强制预尸检——假设半年后这个决策彻底失败了，最核心的死因是什么？（必须你自己写）">
            <AutoTextarea value={entry.devilsAdvocate} onChange={v => update("devilsAdvocate", v)} placeholder="如果这个决策会死，它最可能死于……" minRows={3} />
          </Field>
        </div>

        <Field label="预期结果" hint="写完致命盲区后再落笔——如果预期没有因此变化，要么盲区不够狠，要么你过度自信了"><AutoTextarea value={entry.expectedOutcome} onChange={v => update("expectedOutcome", v)} placeholder="我预期..." /></Field>
        <Field label="确信度"><ConfidenceBar value={entry.confidence} onChange={v => update("confidence", v)} /></Field>
        <Field label="情绪状态" hint="做这个决策时我的情绪是什么？"><EmotionPicker selected={entry.emotions} onChange={v => update("emotions", v)} /></Field>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "0 0 180px" }}>
            <Field label="预计揭晓日期（选填）" hint="到期自动提醒回顾。不填则90天后提醒。"><input type="date" value={entry.reviewDate} onChange={e => update("reviewDate", e.target.value)} style={S.input} /></Field>
          </div>
          {entry.reviewDate && <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "22px" }}>距揭晓还有 <span style={{ color: "var(--accent)", fontWeight: 600 }}>{Math.max(0, -daysSince(entry.reviewDate))}</span> 天</div>}
        </div>
      </div>

      {/* ── Copy → Mirror → Drift ── */}
      <button onClick={handleCopy} style={{ width: "100%", padding: "14px 20px", borderRadius: "10px", marginBottom: "16px", border: "1.5px dashed var(--accent)", background: "var(--accent-faint)", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", color: "var(--accent)" }}
        onMouseEnter={e => { const t = e.currentTarget; t.style.background = "var(--accent)"; t.style.color = "#0e0f11"; t.style.borderStyle = "solid"; t.querySelector("svg").style.stroke = "#0e0f11"; }}
        onMouseLeave={e => { const t = e.currentTarget; t.style.background = "var(--accent-faint)"; t.style.color = "var(--accent)"; t.style.borderStyle = "dashed"; t.querySelector("svg").style.stroke = "var(--accent)"; }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: "stroke 0.2s ease" }}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        <span style={{ fontSize: "13.5px", fontWeight: 600 }}>① 复制日志 → 粘贴到新对话获取「历史镜像」分析</span>
      </button>

      <Field label="② 历史镜像" hint="获取AI分析后，记录你自己想到的历史类比，或粘贴AI给出的关键案例"><AutoTextarea value={entry.historicalParallel} onChange={v => update("historicalParallel", v)} placeholder="这让我想到..." minRows={2} /></Field>

      {/* ── Section 2: Decision Drift ── */}
      <div style={{ background: "var(--drift-bg)", borderRadius: "12px", padding: "20px", marginBottom: "16px", border: "1px solid var(--drift-border)" }}>
        <p style={{ ...S.sectionHead, color: "var(--drift-accent)" }}>▎③ 决策偏移（获取历史镜像后填写）</p>
        <p style={{ fontSize: "12px", color: "var(--text-tertiary)", margin: "-10px 0 16px", fontStyle: "italic" }}>看完历史镜像分析后，你的判断发生了什么变化？</p>

        <Field label="镜像摘要" hint="把AI分析中最触动你的结论粘贴或概括在这里，让这份记录自包含"><AutoTextarea value={entry.mirrorSummary} onChange={v => update("mirrorSummary", v)} placeholder="AI分析让我意识到..." minRows={2} /></Field>
        <Field label="决策立场" hint="看完历史案例后，你是否改变了决定？"><StancePicker value={entry.postMirrorStance} onChange={v => update("postMirrorStance", v)} /></Field>
        <Field label="修正后确信度"><ConfidenceBar value={entry.confidence2} onChange={v => update("confidence2", v)} label="drift" /></Field>
        {confDelta !== null && <div style={{ fontSize: "12px", marginTop: "-12px", marginBottom: "16px", color: confDelta === 0 ? "var(--text-tertiary)" : confDelta > 0 ? "var(--review-accent)" : "#e67e22" }}>
          确信度变化：{confDelta > 0 ? `↑${confDelta}` : confDelta < 0 ? `↓${Math.abs(confDelta)}` : "→ 不变"}
        </div>}
        <Field label="修正后情绪" hint="重新审视后，你的情绪状态发生了什么变化？"><EmotionPicker selected={entry.emotions2} onChange={v => update("emotions2", v)} accentColor="var(--drift-accent)" /></Field>
      </div>

      {/* ── Section 3: Review ── */}
      <div style={{ background: "var(--review-bg)", borderRadius: "12px", padding: "20px", border: "1px dashed var(--border)" }}>
        <p style={{ ...S.sectionHead, color: "var(--review-accent)", marginBottom: "6px" }}>▎回顾区（揭晓后填写）</p>
        <p style={{ fontSize: "12px", color: "var(--text-tertiary)", margin: "0 0 16px", fontStyle: "italic" }}>别急着填——给时间做裁判。到期后回来，诚实面对结果。</p>
        {hasAnchors && <div style={{ marginBottom: "16px", padding: "14px", borderRadius: "10px", background: "#ffffff06", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: "11px", color: "var(--review-accent)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>↩ 当时的你是这么想的</div>
          <ReviewAnchor label="预期结果" text={entry.expectedOutcome} />
          <ReviewAnchor label="致命盲区" text={entry.devilsAdvocate} />
        </div>}
        <Field label="实际结果" hint="真实发生了什么？"><AutoTextarea value={entry.actualOutcome} onChange={v => update("actualOutcome", v)} placeholder="实际上..." /></Field>
        <Field label="预判准确度"><AccuracySelector value={entry.predictionAccuracy} onChange={v => update("predictionAccuracy", v)} /></Field>
        <Field label="结果归因" hint="标记为'意外变量'的不计入判断力校准"><AttributionPicker value={entry.outcomeAttribution} onChange={v => update("outcomeAttribution", v)} /></Field>
        <Field label="我学到了什么" hint="如果重来一次，我会做不同的选择吗？"><AutoTextarea value={entry.lessonLearned} onChange={v => update("lessonLearned", v)} placeholder="下次我会..." /></Field>
      </div>
    </div>
  );
}

/* ─── Main App ─── */
export default function DecisionJournal() {
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState("timeline");
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const fileRef = useRef(null);

  useEffect(() => { store.load().then(data => { setEntries(data); setLoading(false); }); }, []);
  const save = useCallback(async (updated) => { await store.save(updated); setEntries(updated); }, []);

  const startNew = () => { setEditing(emptyEntry()); setView("edit"); };
  const startEdit = entry => { setEditing({ ...entry, devilsAdvocate: entry.devilsAdvocate || "", outcomeAttribution: entry.outcomeAttribution || "", mirrorSummary: entry.mirrorSummary || "", postMirrorStance: entry.postMirrorStance || "", confidence2: entry.confidence2 ?? -1, emotions2: entry.emotions2 || [] }); setView("edit"); };
  const handleSave = async () => { const idx = entries.findIndex(e => e.id === editing.id); await save(idx >= 0 ? entries.map((e,i) => i === idx ? editing : e) : [editing, ...entries]); setView("timeline"); setEditing(null); };
  const handleDelete = async () => { await save(entries.filter(e => e.id !== editing.id)); setView("timeline"); setEditing(null); };

  const handleExportAll = () => downloadJSON(entries, `decision-journal-backup-${new Date().toISOString().slice(0,10)}.json`);
  const handleImport = e => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try { const imported = JSON.parse(ev.target.result); if (!Array.isArray(imported)) { alert("格式不正确"); return; }
        const merged = [...entries]; let added = 0;
        imported.forEach(item => { if (!merged.some(e => e.id === item.id)) { merged.push(item); added++; } });
        await save(merged); alert(`导入完成：新增 ${added} 条，跳过 ${imported.length - added} 条重复`);
      } catch { alert("文件解析失败"); }
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  const toggleSelect = id => setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const handleBatchExport = () => {
    const selected = entries.filter(e => selectedIds.has(e.id));
    if (!selected.length) return;
    const data = formatBatchExport(selected);
    downloadJSON(data, `decision-analysis-${selected.length}条-${new Date().toISOString().slice(0,10)}.json`);
    setSelectMode(false); setSelectedIds(new Set());
  };

  if (loading) return <div style={{ ...rootStyle, display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "var(--text-tertiary)" }}>加载中...</p></div>;

  return (
    <div style={rootStyle}>
      <style>{cssVars}</style>
      <div style={{ padding: "24px 28px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-display)", letterSpacing: "0.02em" }}>决策日志</h1>
          <p style={{ fontSize: "12.5px", color: "var(--text-tertiary)", margin: "4px 0 0", fontStyle: "italic" }}>记录决策时刻，让时间做裁判</p>
        </div>
        {view === "timeline" && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <input ref={fileRef} type="file" accept=".json" onChange={handleImport} style={{ display: "none" }} />
            <button onClick={() => fileRef.current?.click()} style={{ ...S.btn, background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontSize: "12px", padding: "6px 12px" }}>导入</button>
            {entries.length > 0 && <button onClick={handleExportAll} style={{ ...S.btn, background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontSize: "12px", padding: "6px 12px" }}>全量备份</button>}
            {entries.length > 0 && !selectMode && <button onClick={() => setSelectMode(true)} style={{ ...S.btn, background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontSize: "12px", padding: "6px 12px" }}>选择分析</button>}
            {selectMode && <>
              <button onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }} style={{ ...S.btn, background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontSize: "12px", padding: "6px 12px" }}>取消</button>
              <button onClick={handleBatchExport} disabled={!selectedIds.size} style={{ ...S.btn, background: selectedIds.size ? "#9b59b6" : "var(--bg-tertiary)", color: selectedIds.size ? "#fff" : "var(--text-tertiary)", fontSize: "12px", padding: "6px 12px" }}>导出分析 ({selectedIds.size})</button>
            </>}
            {!selectMode && <button onClick={startNew} style={{ ...S.btn, background: "var(--accent)", color: "#0e0f11", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}><span style={{ fontSize: "16px", lineHeight: 1 }}>+</span> 新记录</button>}
          </div>
        )}
      </div>
      <div style={{ padding: "20px 28px", overflowY: "auto", flex: 1 }}>
        {view === "timeline" && <>
          {entries.length > 0 && !selectMode && <CalibrationPanel entries={entries} />}
          {entries.length > 0 && !selectMode && <ReviewReminder entries={entries} onEdit={startEdit} />}
          <Timeline entries={entries} onEdit={startEdit} selectable={selectMode} selectedIds={selectedIds} onToggle={toggleSelect} />
        </>}
        {view === "edit" && editing && <EntryForm entry={editing} onChange={setEditing} onSave={handleSave} onDelete={handleDelete} onCancel={() => { setView("timeline"); setEditing(null); }} isNew={!entries.some(e => e.id === editing.id)} />}
      </div>
    </div>
  );
}

const rootStyle = { width: "100%", height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-primary)", color: "var(--text-primary)", fontFamily: "var(--font-body)", fontSize: "14px", overflow: "hidden" };
const cssVars = `
  :root { --bg-primary:#0e0f11;--bg-secondary:#16181c;--bg-tertiary:#1e2026;--border:#2a2d35;--text-primary:#e8e6e3;--text-secondary:#9a978f;--text-tertiary:#5e5c57;--accent:#c9a96e;--accent-faint:#c9a96e18;--review-bg:#1a2318;--review-accent:#7dac68;--drift-bg:#1a1825;--drift-border:#2d2640;--drift-accent:#a78bfa;--font-display:"Noto Serif SC","Source Han Serif SC","Songti SC",Georgia,serif;--font-body:"Noto Sans SC",-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; }
  *{box-sizing:border-box}
  @keyframes fadeSlideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  input:focus,select:focus{border-color:var(--accent)!important;outline:none}
  ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
`;
