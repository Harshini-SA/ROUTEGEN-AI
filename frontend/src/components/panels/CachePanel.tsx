import React from 'react';
import { Database, Zap } from 'lucide-react';

const CachePanel = ({ stats }: { stats: any }) => {
  if (!stats) return <div className="p-6 bg-surface rounded-xl border border-surface/50 h-48 animate-pulse"></div>;

  return (
    <div className="bg-surface rounded-xl border border-surface/50 p-6 shadow-lg relative overflow-hidden group">
      <div className="absolute -right-10 -top-10 w-32 h-32 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-all"></div>
      
      <div className="flex items-center gap-2 mb-6">
        <Database className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-white">Semantic Cache</h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-background/50 rounded-lg p-4 border border-surface">
          <div className="text-sm text-text-secondary mb-1">Hit Rate</div>
          <div className="text-2xl font-bold text-white flex items-center gap-2">
            {stats.hit_rate_pct}%
          </div>
        </div>
        <div className="bg-background/50 rounded-lg p-4 border border-surface">
          <div className="text-sm text-text-secondary mb-1">Cost Saved</div>
          <div className="text-2xl font-bold text-success flex items-center gap-1">
            <Zap className="w-4 h-4" />
            ${stats.total_savings_usd.toFixed(2)}
          </div>
        </div>
        <div className="col-span-2 bg-background/50 rounded-lg p-4 border border-surface flex justify-between items-center">
          <span className="text-sm text-text-secondary">Queries served at zero cost</span>
          <span className="font-mono text-lg text-white bg-surface px-3 py-1 rounded">{stats.queries_served_zero_cost}</span>
        </div>
      </div>
    </div>
  );
};

export default CachePanel;
