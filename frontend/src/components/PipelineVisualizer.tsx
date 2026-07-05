import React, { useEffect, useRef, useState } from 'react';
import { Clock, Loader2, CheckCircle2, ChevronRight, ChevronDown, Activity, GitBranch, Zap, Globe } from 'lucide-react';

/**
 * Live 5-node pipeline progress visualizer.
 *
 * Drives its animation from the per-node `trace` array the backend already returns
 * (`/pipeline/run` -> logs, `/compare` -> routed.trace / baseline.trace). Even though the
 * data arrives all at once, nodes light up green sequentially (STAGGER_MS apart) to read as
 * a real-time monitoring dashboard.
 */

export interface TraceEntry {
  node_id: string;
  model_used?: string;
  tier_selected?: string;
  complexity_score?: number;
  latency_ms?: number;
  cost_usd?: number;
  rag_used?: boolean;
  rag_chunk_count?: number;
  fallback_model?: string | null;
  fallback_reason?: string | null;
  classification_reason?: string;
  classification_confidence?: number;
  classification_method?: string; // "huggingface" | "keyword_fallback"
  cache_hit?: boolean;
  cache_scope?: 'session' | 'global';
  hit_count?: number;
  original_query?: string;
  similarity?: string;
  detected_domain?: string;
  domain_shift?: number;
  base_score?: number;
  adjusted_score?: number;
}

interface PipelineVisualizerProps {
  trace?: TraceEntry[] | null;
  live?: boolean;                          // no data yet — show a "running" sweep
  orientation?: 'horizontal' | 'vertical'; // horizontal = chat, vertical = narrow compare columns
  title?: string;
  autoCollapse?: boolean;                  // collapse into a toggle once the animation finishes
  defaultCollapsed?: boolean;              // instantly show collapsed (for historical chats)
}

const NODES: { id: string; label: string }[] = [
  { id: 'query_parsing', label: 'Query Parsing' },
  { id: 'web_search_summarisation', label: 'Search' },
  { id: 'evidence_analysis', label: 'Analysis' },
  { id: 'contradiction_detection', label: 'Contradiction Check' },
  { id: 'final_formatting', label: 'Final Formatting' },
];

const STAGGER_MS = 100;

// --- exact hexes from the design brief ---
const C = {
  card: '#1E293B',
  cardEdge: '#334155',
  indigo: '#6366F1',
  green: '#10B981',
  gray: '#64748B',
  ink: '#E2E8F0',
  inkDim: '#94A3B8',
};

const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

const prettyModel = (m?: string) => {
  if (!m) return '—';
  const parts = m.split('/');
  return parts.length === 2 ? `${cap(parts[0])} ${parts[1]}` : m;
};

const fmtMs = (ms?: number) => {
  if (ms == null) return '';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
};

// Second line under Query Parsing: how the complexity was decided.
// e.g. "HuggingFace: 'complex reasoning' (94% confident)" or "Keyword fallback".
function nodeClassification(t?: TraceEntry): string {
  if (!t?.classification_method) return '';
  if (t.classification_method === 'pre-predicted') {
    return '⚡ Pre-predicted while typing';
  }
  const pct = t.classification_confidence != null ? ` (${Math.round(t.classification_confidence * 100)}% confident)` : '';
  if (t.classification_method === 'huggingface') {
    // classification_reason already reads "HuggingFace classified as '<label>' with N% confidence"
    return t.classification_reason || `HuggingFace${pct}`;
  }
  return `Keyword fallback${pct}`;
}

function nodeDetail(nodeId: string, t?: TraceEntry): string {
  if (!t) return '';
  switch (nodeId) {
    case 'query_parsing':
      if (t.domain_shift && t.domain_shift !== 0 && t.detected_domain && t.base_score && t.adjusted_score) {
        return `Score: ${t.base_score.toFixed(1)} → ${t.adjusted_score.toFixed(1)} (adjusted for ${t.detected_domain.toUpperCase()} domain)`;
      }
      return `Score: ${(t.complexity_score ?? 0).toFixed(1)} → ${cap(t.tier_selected)} Tier`;
    case 'web_search_summarisation':
      return t.rag_used ? `RAG: ${t.rag_chunk_count ?? 0} chunks retrieved` : 'No documents';
    case 'evidence_analysis':
      return `Model: ${t.model_used ?? '—'}`;
    case 'contradiction_detection':
      return 'No conflicts found';
    case 'final_formatting':
      return 'Response ready';
    default:
      return '';
  }
}

const PipelineVisualizer: React.FC<PipelineVisualizerProps> = ({
  trace,
  live = false,
  orientation = 'horizontal',
  title = 'Pipeline Trace',
  autoCollapse = false,
  defaultCollapsed = false,
}) => {
  const traceByNode = new Map((trace || []).map((t) => [t.node_id, t]));

  // completedCount = how many nodes have finished; the node at that index is "active".
  // Historical/collapsed traces (defaultCollapsed) are already-complete data with no live
  // animation to run — start them fully "complete" so expanding the pill later shows the
  // saved trace immediately instead of a permanently-spinning first node (completedCount
  // stuck at 0 forever, since the stagger effect below intentionally skips these).
  const [completedCount, setCompletedCount] = useState(defaultCollapsed ? NODES.length : 0);
  const [sweep, setSweep] = useState(0); // live-mode scanning pointer
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Staggered "each node completes" animation, driven from the (already-complete) trace.
  useEffect(() => {
    if (live || !trace || trace.length === 0) return;
    if (defaultCollapsed) {
      // Historical trace — no animation, just render as fully complete.
      setCompletedCount(NODES.length);
      return;
    }
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setCompletedCount(0);
    for (let i = 1; i <= NODES.length; i++) {
      timers.current.push(setTimeout(() => setCompletedCount(i), i * STAGGER_MS));
    }
    if (autoCollapse) {
      timers.current.push(
        setTimeout(() => setCollapsed(true), NODES.length * STAGGER_MS + 800)
      );
    }
    return () => timers.current.forEach(clearTimeout);
  }, [trace, live, autoCollapse, defaultCollapsed]);

  // Live sweep while the pipeline is actually running (no data yet).
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setSweep((s) => (s + 1) % NODES.length), 200);
    return () => clearInterval(id);
  }, [live]);

  const stateFor = (i: number): 'pending' | 'active' | 'complete' => {
    if (live) return i === sweep ? 'active' : 'pending';
    if (i < completedCount) return 'complete';
    if (i === completedCount) return 'active';
    return 'pending';
  };

  // --- summary bar values ---
  const q = traceByNode.get('query_parsing');
  const finalNode = traceByNode.get('final_formatting');
  const totalCost = (trace || []).reduce((sum, t) => sum + (t.cost_usd || 0), 0);
  const summaryTier = q?.tier_selected;
  const summaryModel = finalNode?.model_used || q?.model_used;

  const styleFor = (st: 'pending' | 'active' | 'complete') => {
    if (st === 'complete') return { color: C.green, border: C.green, bg: 'rgba(16,185,129,0.10)' };
    if (st === 'active') return { color: C.indigo, border: C.indigo, bg: 'rgba(99,102,241,0.12)' };
    return { color: C.gray, border: C.cardEdge, bg: 'rgba(30,41,59,0.5)' };
  };

  const NodeIcon = ({ st }: { st: 'pending' | 'active' | 'complete' }) => {
    if (st === 'complete') return <CheckCircle2 className="w-4 h-4" />;
    if (st === 'active') return <Loader2 className="w-4 h-4 animate-spin" />;
    return <Clock className="w-4 h-4" />;
  };

  // ---- Cache Hit UI ----
  if (trace && trace.length > 0 && trace[0].cache_hit) {
    const hit = trace[0];
    const savedStr = hit.classification_reason?.match(/\$([0-9.]+)/)?.[1] || '0.00';
    const isGlobal = hit.cache_scope === 'global';

    if (isGlobal) {
      // Global fingerprint hit — a DIFFERENT user already asked this. Purple/indigo
      // to distinguish it from the green session cache.
      return (
        <div className="rounded-xl border border-violet-500/30 bg-violet-900/10 p-4 w-full flex items-center justify-between shadow-[0_0_15px_rgba(139,92,246,0.15)]">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center border border-violet-500/30 shadow-[0_0_10px_rgba(139,92,246,0.25)]">
              <Globe className="w-5 h-5 text-violet-400 drop-shadow-[0_0_5px_rgba(139,92,246,0.6)]" />
            </div>
            <div>
              <h3 className="text-[13px] font-bold text-violet-300 tracking-wide">
                🌍 GLOBAL CACHE HIT — someone else already asked this!
              </h3>
              <p className="text-[11px] text-violet-300/70 mt-1 uppercase tracking-wider">
                Reused across users
                {hit.similarity ? ` · ${hit.similarity} similarity` : ''}
                {hit.hit_count != null ? ` · reuse #${hit.hit_count}` : ''}
                {' · <50ms'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-mono text-text-secondary">Cost: <span className="text-white">$0.00</span></div>
            <div className="text-xs font-mono text-violet-300 mt-1">Saved: ${savedStr}</div>
          </div>
        </div>
      );
    }

    // Session Smart Cache hit — this browser session, green.
    return (
      <div className="rounded-xl border border-green-500/30 bg-green-900/10 p-4 w-full flex items-center justify-between shadow-[0_0_15px_rgba(16,185,129,0.1)]">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center border border-green-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
            <Zap className="w-5 h-5 text-green-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
          </div>
          <div>
            <h3 className="text-[13px] font-bold text-green-400 tracking-wide">
              ⚡ SMART CACHE HIT (this session)
            </h3>
            <p className="text-[11px] text-green-400/70 mt-1 uppercase tracking-wider">Matched previous query · Response time: {'<50ms'}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-mono text-text-secondary">Cost: <span className="text-white">$0.00</span></div>
          <div className="text-xs font-mono text-green-400 mt-1">Saved: ${savedStr}</div>
        </div>
      </div>
    );
  }

  // ---- Collapsed pill ----
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
        style={{ backgroundColor: C.card, borderColor: C.cardEdge, color: C.inkDim }}
      >
        <GitBranch className="w-3.5 h-3.5" style={{ color: C.green }} />
        <span style={{ color: C.ink }}>View Pipeline</span>
        {summaryTier && (
          <span className="opacity-70">· {cap(summaryTier)} · ${totalCost.toFixed(5)}</span>
        )}
        <ChevronRight className="w-3.5 h-3.5 opacity-70 group-hover:translate-x-0.5 transition-transform" />
      </button>
    );
  }

  const isVertical = orientation === 'vertical';

  return (
    <div
      className="rounded-xl border overflow-hidden w-full"
      style={{ backgroundColor: C.card, borderColor: C.cardEdge }}
    >
      {/* Header + summary bar */}
      <div className="px-4 py-2.5 border-b flex items-center justify-between gap-3" style={{ borderColor: C.cardEdge }}>
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="w-4 h-4 shrink-0" style={{ color: live ? C.indigo : C.green }} />
          <span className="text-xs font-semibold uppercase tracking-wider truncate" style={{ color: C.ink }}>
            {title}
          </span>
          {live && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded animate-pulse" style={{ color: C.indigo, backgroundColor: 'rgba(99,102,241,0.15)' }}>
              running…
            </span>
          )}
        </div>
        {!live && (
          <button onClick={() => setCollapsed(true)} className="shrink-0" style={{ color: C.inkDim }} title="Collapse">
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Summary metrics */}
      <div className="px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono border-b" style={{ borderColor: C.cardEdge, backgroundColor: 'rgba(15,23,42,0.35)' }}>
        <SummaryStat label="Complexity" value={live ? '…' : (q?.complexity_score != null ? q.complexity_score.toFixed(1) : '—')} />
        <SummaryStat label="Tier" value={live ? '…' : (cap(summaryTier) || '—')} valueColor={C.indigo} />
        <SummaryStat label="Model" value={live ? '…' : prettyModel(summaryModel)} />
        <SummaryStat label="Cost" value={live ? '…' : `$${totalCost.toFixed(5)}`} valueColor={C.green} />
      </div>

      {/* Node track */}
      <div className={isVertical ? 'p-3 flex flex-col gap-1' : 'p-4 flex items-start gap-1 overflow-x-auto custom-scrollbar'}>
        {NODES.map((node, i) => {
          const st = stateFor(i);
          const s = styleFor(st);
          const t = traceByNode.get(node.id);
          const detail = st === 'complete' ? nodeDetail(node.id, t) : '';
          const classification = st === 'complete' && node.id === 'query_parsing' ? nodeClassification(t) : '';

          return (
            <React.Fragment key={node.id}>
              <div className={isVertical ? 'flex items-start gap-3' : 'flex flex-col items-center text-center min-w-[120px] flex-1'}>
                {/* chip */}
                <div
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-all duration-300 ${st === 'active' ? 'shadow-[0_0_14px_rgba(99,102,241,0.45)]' : ''}`}
                  style={{ backgroundColor: s.bg, borderColor: s.border, color: s.color }}
                >
                  <NodeIcon st={st} />
                  <span className="text-xs font-semibold whitespace-nowrap" style={{ color: st === 'pending' ? C.gray : C.ink }}>
                    {node.label}
                  </span>
                  {st === 'complete' && t?.latency_ms != null && (
                    <span className="text-[10px] font-mono" style={{ color: C.green }}>{fmtMs(t.latency_ms)}</span>
                  )}
                </div>

                {/* detail line */}
                <div className={isVertical ? 'pt-1.5' : 'mt-1.5 min-h-[16px]'}>
                  {detail && (
                    <span className="text-[10px] leading-tight block" style={{ color: C.inkDim }}>
                      {detail}
                    </span>
                  )}
                  {classification && (
                    <span
                      className="text-[9px] leading-tight block mt-0.5"
                      style={{ color: t?.classification_method === 'huggingface' ? C.indigo : C.gray }}
                      title={t?.classification_reason || ''}
                    >
                      {classification}
                    </span>
                  )}
                </div>
              </div>

              {/* connector */}
              {i < NODES.length - 1 && (
                isVertical ? (
                  <div className="ml-[13px] h-3 w-px" style={{ backgroundColor: i < completedCount ? C.green : C.cardEdge }} />
                ) : (
                  <div className="flex items-center pt-2 shrink-0">
                    <ChevronRight className="w-4 h-4" style={{ color: i < completedCount ? C.green : C.cardEdge }} />
                  </div>
                )
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

const SummaryStat: React.FC<{ label: string; value: string; valueColor?: string }> = ({ label, value, valueColor }) => (
  <span className="flex items-center gap-1.5">
    <span style={{ color: C.gray }}>{label}:</span>
    <span style={{ color: valueColor || C.ink }}>{value}</span>
  </span>
);

export default PipelineVisualizer;
