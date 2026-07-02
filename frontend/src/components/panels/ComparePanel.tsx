import React from 'react';
import { Scale, DollarSign, TrendingDown, Award, AlertCircle } from 'lucide-react';

interface JudgeScore {
  score_a: number;
  score_b: number;
  reason: string;
}

interface ComparePanelProps {
  costRouted?: number;
  costBaseline?: number;
  judgeScore?: JudgeScore;
}

const ComparePanel: React.FC<ComparePanelProps> = ({ costRouted, costBaseline, judgeScore }) => {
  if (costRouted === undefined || costBaseline === undefined) {
    return (
      <div className="bg-surface rounded-xl border border-surface/50 p-6 flex flex-col items-center justify-center text-center space-y-4">
        <Scale className="w-8 h-8 text-text-secondary opacity-50" />
        <p className="text-text-secondary text-sm">Run a query in Compare Mode to see side-by-side metrics.</p>
      </div>
    );
  }

  const savingsUsd = Math.max(0, costBaseline - costRouted);
  const savingsPct = costBaseline > 0 ? (savingsUsd / costBaseline) * 100 : 0;
  
  const scoreRouted = judgeScore?.score_a ?? 0;
  const scoreBaseline = judgeScore?.score_b ?? 0;
  const qualityDelta = scoreRouted - scoreBaseline;

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden shadow-lg flex flex-col">
      <div className="p-4 border-b border-border bg-gradient-to-r from-primary/10 to-transparent flex items-center space-x-3">
        <Scale className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Benchmark Results</h3>
      </div>

      <div className="p-4 space-y-6">
        {/* Cost Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-text-secondary uppercase tracking-wider">
            <span className="flex items-center space-x-1"><DollarSign className="w-3 h-3"/> <span>Cost</span></span>
            {savingsPct > 0 && <span className="text-success flex items-center"><TrendingDown className="w-3 h-3 mr-1"/> {savingsPct.toFixed(0)}% Saved</span>}
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-background rounded-lg p-3 border border-border flex flex-col">
              <span className="text-[10px] text-text-secondary uppercase mb-1">Routed AI</span>
              <span className="text-lg font-bold text-success">${costRouted.toFixed(5)}</span>
            </div>
            <div className="bg-background rounded-lg p-3 border border-border flex flex-col">
              <span className="text-[10px] text-text-secondary uppercase mb-1">Baseline</span>
              <span className="text-lg font-bold text-danger">${costBaseline.toFixed(5)}</span>
            </div>
          </div>
        </div>

        {/* Quality Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-text-secondary uppercase tracking-wider">
            <span className="flex items-center space-x-1"><Award className="w-3 h-3"/> <span>Quality Score</span></span>
            <span className={`text-xs ${qualityDelta >= 0 ? 'text-success' : 'text-danger'}`}>
              {qualityDelta > 0 ? '+' : ''}{qualityDelta} pts
            </span>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-lg p-3 border flex flex-col ${qualityDelta >= 0 ? 'bg-primary/5 border-primary/30' : 'bg-background border-border'}`}>
              <span className="text-[10px] text-text-secondary uppercase mb-1">Routed AI</span>
              <span className="text-xl font-bold text-text-primary">{scoreRouted}<span className="text-xs text-text-secondary font-normal">/10</span></span>
            </div>
            <div className={`rounded-lg p-3 border flex flex-col ${qualityDelta < 0 ? 'bg-primary/5 border-primary/30' : 'bg-background border-border'}`}>
              <span className="text-[10px] text-text-secondary uppercase mb-1">Baseline</span>
              <span className="text-xl font-bold text-text-primary">{scoreBaseline}<span className="text-xs text-text-secondary font-normal">/10</span></span>
            </div>
          </div>
        </div>

        {/* Judge Reason */}
        {judgeScore?.reason && (
          <div className="bg-background rounded-lg p-3 border border-border mt-2">
            <div className="flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-secondary mt-0.5 shrink-0" />
              <p className="text-xs text-text-secondary leading-relaxed">{judgeScore.reason}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ComparePanel;
