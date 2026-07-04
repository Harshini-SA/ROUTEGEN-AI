import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import CostPanel from './panels/CostPanel';
import RoutingLogTable from './panels/RoutingLogTable';
import CachePanel from './panels/CachePanel';
import QualityPanel from './panels/QualityPanel';
import { Activity, Play } from 'lucide-react';
import { API_BASE } from '../lib/api';

const Dashboard = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [cacheStats, setCacheStats] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    // Fetch initial metrics
    fetch('http://127.0.0.1:8000/dashboard/metrics')
      .then(res => res.json())
      .then(data => setMetrics(data))
      .catch(console.error);

    fetch('http://127.0.0.1:8000/cache/stats')
      .then(res => res.json())
      .then(data => setCacheStats(data))
      .catch(console.error);

    // Setup websocket
    const socket = io('ws://127.0.0.1:8000', { path: '/ws/live', transports: ['websocket'] });
    socket.on('message', (data) => {
      setLogs(prev => [JSON.parse(data), ...prev].slice(0, 50));
    });

    return () => { socket.disconnect(); };
  }, []);

  const runPipeline = async () => {
    setIsRunning(true);
    try {
      console.log('Calling:', `${API_BASE}/pipeline/run`);
      const res = await fetch(`${API_BASE}/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'What is the current state of AI regulation in the EU?' })
      });
      const data = await res.json();
      
      // Update logs if websocket fails
      if (data.logs) {
        setLogs(prev => [...data.logs.reverse(), ...prev].slice(0, 50));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-surface p-6 rounded-xl border border-surface/50 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Observability Dashboard</h2>
          <p className="text-text-secondary max-w-2xl">
            Monitor real-time model routing, latency, cost savings, and quality metrics across your AI pipelines.
          </p>
        </div>
        <button 
          onClick={runPipeline}
          disabled={isRunning}
          className="relative group flex items-center space-x-2 bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-lg font-medium transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRunning ? (
            <Activity className="w-5 h-5 animate-spin" />
          ) : (
            <Play className="w-5 h-5 group-hover:scale-110 transition-transform" />
          )}
          <span>{isRunning ? 'Running Pipeline...' : 'Run Demo Pipeline'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <CostPanel metrics={metrics} />
          <RoutingLogTable logs={logs} />
        </div>
        <div className="space-y-6">
          <QualityPanel metrics={metrics} />
          <CachePanel stats={cacheStats} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
