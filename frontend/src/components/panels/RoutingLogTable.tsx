import React from 'react';
import { List, AlertCircle, CheckCircle2 } from 'lucide-react';

const RoutingLogTable = ({ logs }: { logs: any[] }) => {
  return (
    <div className="flex flex-col h-[500px]">
      <div className="flex-1 overflow-y-auto p-2 space-y-3 custom-scrollbar">
        {logs.length === 0 ? (
          <div className="text-center py-8 text-text-secondary text-sm">
            Waiting for pipeline execution...
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="bg-background rounded-lg p-3 border border-border flex flex-col shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-semibold text-text-primary capitalize">{log.node_id.replace(/_/g, ' ')}</span>
                <span className="text-xs font-mono text-success font-bold">${log.cost_usd.toFixed(5)}</span>
              </div>
              
              <div className="flex flex-wrap gap-2 mb-2">
                <span className="px-2 py-0.5 bg-surface rounded text-xs text-text-primary border border-border">
                  {log.model_used}
                </span>
                <span className="px-2 py-0.5 bg-surface rounded text-xs text-text-secondary border border-border">
                  {Math.round(log.latency_ms)}ms
                </span>
                {log.fallback_triggered && (
                  <span className="px-2 py-0.5 bg-danger/20 text-danger border border-danger/30 rounded text-xs flex items-center space-x-1">
                    <AlertCircle className="w-3 h-3" />
                    <span>Escalated</span>
                  </span>
                )}
              </div>
              
              <div className="text-xs text-text-secondary bg-surface/50 p-2 rounded border border-border/50">
                <span className="font-semibold text-primary">Routing Logic: </span> 
                {log.tier_selected === 'baseline' 
                  ? 'Baseline Comparison Mode Active → Bypassed Routing' 
                  : `Complexity Score ${log.complexity_score.toFixed(1)} → ${log.tier_selected.toUpperCase()} Tier → Selected ${log.model_used.split('/').pop()}`}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default RoutingLogTable;
