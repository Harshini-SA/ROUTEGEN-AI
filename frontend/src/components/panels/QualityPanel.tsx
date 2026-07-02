import React from 'react';
import { Activity, ShieldCheck } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const QualityPanel = ({ metrics }: { metrics: any }) => {
  if (!metrics) return <div className="p-6 bg-surface rounded-xl border border-surface/50 h-64 animate-pulse"></div>;

  // Mock data for the chart to show quality retention over runs
  const data = [
    { run: '1', routegen: 98, baseline: 99 },
    { run: '2', routegen: 99, baseline: 99 },
    { run: '3', routegen: 97, baseline: 98 },
    { run: '4', routegen: 98, baseline: 99 },
    { run: '5', routegen: metrics.quality_retention, baseline: 99.5 },
  ];

  return (
    <div className="bg-surface rounded-xl border border-surface/50 p-6 shadow-lg">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Quality Retention
          </h3>
          <p className="text-sm text-text-secondary">BERTScore vs Baseline</p>
        </div>
        <div className="flex items-center gap-1 text-success bg-success/10 px-3 py-1 rounded-full border border-success/20">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-sm font-bold">{metrics.quality_retention}%</span>
        </div>
      </div>

      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <XAxis dataKey="run" stroke="#64748b" tick={{fontSize: 12}} />
            <YAxis domain={[90, 100]} stroke="#64748b" tick={{fontSize: 12}} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
            />
            <Line type="monotone" dataKey="baseline" stroke="#94a3b8" strokeDasharray="5 5" name="Baseline" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="routegen" stroke="#3b82f6" name="RouteGen AI" strokeWidth={3} dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default QualityPanel;
