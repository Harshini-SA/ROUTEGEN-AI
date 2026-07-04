import React, { useState } from 'react';
import { Scale, DollarSign, Award, Zap, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

interface Scores {
  correctness: number;
  completeness: number;
  clarity: number;
  overall: number;
}

interface CompareResult {
  prompt: string;
  routed: {
    model: string;
    tier: string;
    cost: number;
    latency_ms: number;
    response: string;
    scores: Scores;
  };
  baseline: {
    model: string;
    cost: number;
    latency_ms: number;
    response: string;
    scores: Scores;
  };
  savings: {
    cost_savings_usd: number;
    cost_savings_pct: number;
    accuracy_delta: number;
    quality_maintained: boolean;
    accuracy_scoring_available: boolean;
  };
  verdict: string;
}

interface CompareDashboardProps {
  session: any;
  sessionId: string;
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#121214',
  border: '1px solid #27272a',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '12px'
};

const CompareDashboard: React.FC<CompareDashboardProps> = ({ session, sessionId }) => {
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunComparison = async () => {
    if (!prompt.trim() || isRunning) return;
    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('http://localhost:8000/compare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ prompt, session_id: sessionId })
      });
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError('Failed to run comparison. Please try again.');
    } finally {
      setIsRunning(false);
    }
  };

  const costData = result ? [
    { name: 'Smart Routing', value: result.routed.cost },
    { name: 'Single Model Baseline', value: result.baseline.cost }
  ] : [];

  const qualityData = result ? [
    { name: 'Smart Routing', value: result.routed.scores.overall },
    { name: 'Single Model Baseline', value: result.baseline.scores.overall }
  ] : [];

  // Target reference lines drawn in each chart's own unit space (never a dual-axis chart):
  // 60% savings means routed cost should sit at or below 40% of baseline cost.
  const savingsTargetCost = result ? result.baseline.cost * 0.4 : 0;
  // "Quality maintained" per the backend threshold: routed can drop at most 1 point below baseline.
  const qualityFloor = result ? Math.max(0, result.baseline.scores.overall - 1) : 0;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto custom-scrollbar p-6">
      <div className="max-w-5xl mx-auto w-full space-y-6 pb-12">
        {/* Header */}
        <div className="flex items-center space-x-3">
          <Scale className="w-6 h-6 text-secondary shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Quality vs. Cost Tradeoff Dashboard</h1>
            <p className="text-sm text-text-secondary">Benchmark smart routing against a single premium-model baseline.</p>
          </div>
        </div>

        {/* Input */}
        <div className="bg-surface border border-border rounded-2xl p-2 flex items-end space-x-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleRunComparison();
              }
            }}
            placeholder="Enter a prompt to benchmark (e.g. &quot;Write a marketing strategy for a SaaS startup&quot;)..."
            disabled={isRunning}
            rows={2}
            className="flex-1 bg-transparent p-3 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none resize-none disabled:opacity-50"
          />
          <button
            onClick={handleRunComparison}
            disabled={isRunning || !prompt.trim()}
            className="flex items-center space-x-2 px-4 py-2.5 m-1 bg-secondary hover:bg-secondary/80 text-white rounded-xl disabled:bg-border disabled:text-text-secondary disabled:cursor-not-allowed transition-all shrink-0"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            <span className="text-sm font-medium">{isRunning ? 'Running...' : 'Run Comparison'}</span>
          </button>
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-lg p-3">{error}</div>
        )}

        {isRunning && (
          <div className="flex flex-col items-center justify-center py-16 space-y-3 text-text-secondary">
            <Loader2 className="w-8 h-8 animate-spin text-secondary" />
            <p className="text-sm">Running both pipelines and judging quality — this takes a moment.</p>
          </div>
        )}

        {result && !isRunning && (
          <>
            {/* Summary Banner */}
            <div className={`rounded-2xl border p-5 flex items-center space-x-3 ${result.savings.quality_maintained ? 'bg-success/10 border-success/30' : 'bg-danger/10 border-danger/30'}`}>
              {result.savings.quality_maintained
                ? <CheckCircle2 className="w-6 h-6 text-success shrink-0" />
                : <AlertTriangle className="w-6 h-6 text-danger shrink-0" />}
              <div>
                <p className={`text-lg font-bold ${result.savings.quality_maintained ? 'text-success' : 'text-danger'}`}>
                  Saved {result.savings.cost_savings_pct.toFixed(0)}% cost
                  {result.savings.accuracy_scoring_available && (
                    result.savings.quality_maintained
                      ? ' | Quality maintained ✓'
                      : ` | Quality dropped ${Math.abs(result.savings.accuracy_delta).toFixed(1)} points`
                  )}
                </p>
                <p className="text-xs text-text-secondary mt-0.5">{result.verdict}</p>
              </div>
            </div>

            {/* Two Columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Routed */}
              <div className="bg-surface border border-success/30 rounded-2xl p-4 flex flex-col shadow-[0_0_15px_rgba(16,185,129,0.08)]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-text-primary flex items-center space-x-2">
                    <span>🤖</span>
                    <span>Smart Routing</span>
                  </span>
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-success/20 text-success border border-success/30">
                    {result.routed.tier} tier
                  </span>
                </div>
                <p className="text-xs text-text-secondary mb-3 truncate" title={result.routed.model}>{result.routed.model}</p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-background rounded-lg p-2 border border-border">
                    <p className="text-[10px] text-text-secondary uppercase">Cost</p>
                    <p className="text-sm font-bold text-success">${result.routed.cost.toFixed(5)}</p>
                  </div>
                  <div className="bg-background rounded-lg p-2 border border-border">
                    <p className="text-[10px] text-text-secondary uppercase">Latency</p>
                    <p className="text-sm font-bold text-text-primary">{Math.round(result.routed.latency_ms)}ms</p>
                  </div>
                  <div className="bg-background rounded-lg p-2 border border-border">
                    <p className="text-[10px] text-text-secondary uppercase">Quality</p>
                    <p className="text-sm font-bold text-text-primary">{result.routed.scores.overall}/10</p>
                  </div>
                </div>
                <div className="flex-1 max-h-64 overflow-y-auto bg-background rounded-lg border border-border p-3 prose prose-invert prose-sm custom-scrollbar">
                  <ReactMarkdown>{result.routed.response || '_No response generated._'}</ReactMarkdown>
                </div>
              </div>

              {/* Baseline */}
              <div className="bg-surface border border-danger/30 rounded-2xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-text-primary flex items-center space-x-2">
                    <span>💰</span>
                    <span>Single Model Baseline</span>
                  </span>
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-danger/20 text-danger border border-danger/30">
                    always-on
                  </span>
                </div>
                <p className="text-xs text-text-secondary mb-3 truncate" title={result.baseline.model}>{result.baseline.model}</p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-background rounded-lg p-2 border border-border">
                    <p className="text-[10px] text-text-secondary uppercase">Cost</p>
                    <p className="text-sm font-bold text-danger">${result.baseline.cost.toFixed(5)}</p>
                  </div>
                  <div className="bg-background rounded-lg p-2 border border-border">
                    <p className="text-[10px] text-text-secondary uppercase">Latency</p>
                    <p className="text-sm font-bold text-text-primary">{Math.round(result.baseline.latency_ms)}ms</p>
                  </div>
                  <div className="bg-background rounded-lg p-2 border border-border">
                    <p className="text-[10px] text-text-secondary uppercase">Quality</p>
                    <p className="text-sm font-bold text-text-primary">{result.baseline.scores.overall}/10</p>
                  </div>
                </div>
                <div className="flex-1 max-h-64 overflow-y-auto bg-background rounded-lg border border-border p-3 prose prose-invert prose-sm custom-scrollbar">
                  <ReactMarkdown>{result.baseline.response || '_No response generated._'}</ReactMarkdown>
                </div>
              </div>
            </div>

            {/* Bar Charts — two separate single-axis charts (cost $ and quality pts use different
                scales, so they are never combined onto one dual-axis chart) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-surface border border-border rounded-2xl p-4">
                <h3 className="text-xs font-semibold uppercase text-text-secondary mb-3 flex items-center space-x-2">
                  <DollarSign className="w-4 h-4" /> <span>Cost Comparison</span>
                </h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={costData} margin={{ top: 16, right: 10, left: 10, bottom: 5 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `$${v.toFixed(4)}`} width={60} />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(v: any) => [`$${Number(v).toFixed(5)}`, 'Cost']}
                      />
                      <ReferenceLine
                        y={savingsTargetCost}
                        stroke="#94a3b8"
                        strokeDasharray="4 4"
                        label={{ value: '60% savings target', position: 'insideTopRight', fontSize: 10, fill: '#94a3b8' }}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={56}>
                        <Cell fill="#10b981" />
                        <Cell fill="#ef4444" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-surface border border-border rounded-2xl p-4">
                <h3 className="text-xs font-semibold uppercase text-text-secondary mb-3 flex items-center space-x-2">
                  <Award className="w-4 h-4" /> <span>Quality Score Comparison</span>
                </h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={qualityData} margin={{ top: 16, right: 10, left: 10, bottom: 5 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                      <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: '#94a3b8' }} width={30} />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(v: any) => [`${v}/10`, 'Quality']}
                      />
                      <ReferenceLine
                        y={qualityFloor}
                        stroke="#94a3b8"
                        strokeDasharray="4 4"
                        label={{ value: 'Quality-maintained floor', position: 'insideTopRight', fontSize: 10, fill: '#94a3b8' }}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={56}>
                        <Cell fill="#10b981" />
                        <Cell fill="#ef4444" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <p className="text-xs text-text-secondary text-center -mt-2">Target: &gt;60% savings, &lt;2% quality drop</p>

            {/* Formulas — shown verbatim from the hackathon blueprint */}
            <div className="bg-background border border-border rounded-2xl p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase text-text-secondary mb-2">Hackathon Blueprint Formulas</h3>
              <div className="flex flex-col sm:flex-row sm:space-x-8 space-y-2 sm:space-y-0 font-mono text-sm">
                <div>
                  <span className="text-secondary">S</span> = <span className="text-text-primary">C_baseline &minus; &Sigma;(C_node_i)</span>
                  <span className="text-text-secondary ml-2">= ${result.savings.cost_savings_usd.toFixed(5)}</span>
                </div>
                <div>
                  <span className="text-secondary">&Delta;A</span> = <span className="text-text-primary">A_baseline &minus; A_routed</span>
                  <span className="text-text-secondary ml-2">= {(-result.savings.accuracy_delta).toFixed(1)} pts</span>
                </div>
              </div>
              {!result.savings.accuracy_scoring_available && (
                <p className="text-xs text-warning mt-2">Quality scoring unavailable for this run (judge output could not be parsed) — cost metrics above are still accurate.</p>
              )}
            </div>
          </>
        )}

        {!result && !isRunning && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 text-text-secondary">
            <Scale className="w-10 h-10 opacity-30" />
            <p className="text-sm max-w-md">
              Enter a prompt above to see how smart routing compares against always using the most
              expensive model — cost, latency, and judged quality, side by side.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CompareDashboard;
