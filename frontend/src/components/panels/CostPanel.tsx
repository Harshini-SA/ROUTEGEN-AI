import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DollarSign, Zap, TrendingDown } from 'lucide-react';

const CostPanel = ({ metrics }: { metrics: any }) => {
  if (!metrics) return <div className="p-6 bg-surface rounded-xl border border-surface/50 h-64 animate-pulse"></div>;

  const costData = [
    { name: 'Baseline', value: metrics.baseline_cost || 0.0, color: '#ef4444' },
    { name: 'RouteGen AI', value: metrics.routegen_cost || 0.0, color: '#10b981' }
  ];

  const energyData = [
    { name: 'Baseline', value: metrics.baseline_joules || 0.0, color: '#ef4444' },
    { name: 'RouteGen AI', value: metrics.routegen_joules || 0.0, color: '#10b981' }
  ];

  return (
    <div className="bg-surface rounded-xl border border-surface/50 shadow-lg flex flex-col space-y-0">
      {/* Cost Optimization Section */}
      <div className="p-5 border-b border-border">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" />
            Cost Optimization
          </h3>
          <p className="text-sm text-text-secondary">Total run cost comparison</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-success flex items-center gap-1 justify-end">
            <TrendingDown className="w-6 h-6" />
            {(metrics.total_savings_pct || 0.0).toFixed(0)}%
          </div>
          <div className="text-xs text-text-secondary uppercase tracking-wider mt-1">Total Savings</div>
        </div>
      </div>
      </div>

      <div className="px-5 pb-5">
        <div className="h-28 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={costData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }} layout="vertical">
              <XAxis type="number" tickFormatter={(value) => `$${Number(value).toFixed(2)}`} stroke="#94a3b8" fontSize={11} />
              <YAxis dataKey="name" type="category" width={80} stroke="#94a3b8" fontSize={11} />
              <Tooltip 
                cursor={{ fill: 'transparent' }}
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                formatter={(value: any) => [`$${Number(value).toFixed(4)}`, 'Cost']}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                {costData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Energy Optimization Section */}
      <div className="p-5 border-t border-border">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Energy Optimization
            </h3>
            <p className="text-xs text-text-secondary mt-1">Total Joules consumed vs baseline</p>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-success flex items-center gap-1 justify-end">
              <TrendingDown className="w-4 h-4" />
              {(metrics.energy_savings_pct || 0.0).toFixed(0)}%
            </div>
          </div>
        </div>

        <div className="h-28 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={energyData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }} layout="vertical">
              <XAxis type="number" tickFormatter={(value) => `${Number(value).toFixed(0)}J`} stroke="#94a3b8" fontSize={11} />
              <YAxis dataKey="name" type="category" width={80} stroke="#94a3b8" fontSize={11} />
              <Tooltip 
                cursor={{ fill: 'transparent' }}
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                formatter={(value: any) => [`${Number(value).toFixed(2)} Joules`, 'Energy']}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                {energyData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        <div className="mt-4 pt-3 border-t border-border/50 text-center text-xs text-text-secondary">
          Total messages processed: <span className="font-bold text-white">{metrics.total_runs || 0}</span>
        </div>
      </div>
    </div>
  );
};

export default CostPanel;
