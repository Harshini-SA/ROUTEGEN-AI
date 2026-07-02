import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DollarSign, TrendingDown } from 'lucide-react';

const CostPanel = ({ metrics }: { metrics: any }) => {
  if (!metrics) return <div className="p-6 bg-surface rounded-xl border border-surface/50 h-64 animate-pulse"></div>;

  const data = [
    { name: 'Baseline (All-Large)', cost: metrics.baseline_cost, color: '#ef4444' },
    { name: 'RouteGen AI', cost: metrics.routegen_cost, color: '#10b981' }
  ];

  return (
    <div className="bg-surface rounded-xl border border-surface/50 p-6 shadow-lg">
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
            {metrics.total_savings_pct}%
          </div>
          <div className="text-xs text-text-secondary uppercase tracking-wider mt-1">Total Savings</div>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }} layout="vertical">
            <XAxis type="number" tickFormatter={(value) => `$${value}`} stroke="#94a3b8" />
            <YAxis dataKey="name" type="category" width={120} stroke="#94a3b8" />
            <Tooltip 
              cursor={{ fill: 'transparent' }}
              contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
              formatter={(value: number) => [`$${value.toFixed(4)}`, 'Cost']}
            />
            <Bar dataKey="cost" radius={[0, 4, 4, 0]} barSize={32}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default CostPanel;
