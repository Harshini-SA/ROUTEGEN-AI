import React, { useState, useEffect, useRef, useCallback } from 'react';
import CostPanel from './panels/CostPanel';
import RoutingLogTable from './panels/RoutingLogTable';
import DocumentsPanel from './panels/DocumentsPanel';
import CompareDashboard from './CompareDashboard';
import PipelineVisualizer from './PipelineVisualizer';
import { Send, Sparkles, Activity, Clock, Compass, Zap, Settings, ChevronRight, Menu, Plus, Scale, MessageSquare, Search, LogOut, User, Paperclip, X, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';

const ACCEPTED_UPLOAD_TYPES = '.pdf,.pptx,.jpg,.jpeg,.png';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cost?: number;
  trace?: any[];
  budget_downgrade?: boolean;
  budget_downgrade_reason?: string;
}

interface SessionSummary {
  session_id: string;
  title: string;
  created_at: number;
  message_count: number;
}

const preprocessLaTeX = (content: string) => {
  if (!content) return content;
  return content
    .replace(/\\\[/g, '$$$$')
    .replace(/\\\]/g, '$$$$')
    .replace(/\\\(/g, '$$')
    .replace(/\\\)/g, '$$');
};

const ChatApp = () => {
  const { session } = useOutletContext<{ session: any }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const predictionTimer = useRef<any>(null);
  const [predictedTier, setPredictedTier] = useState<string | null>(null);
  const [predictionConfidence, setPredictionConfidence] = useState<number>(0);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<{ filename: string; chunks: number }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // Cache stats state
  const [cacheStats, setCacheStats] = useState<any>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Budget Mode state
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetStatus, setBudgetStatus] = useState<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<string>('');

  // Tick an elapsed-time counter while a request is in flight, so we can surface
  // "taking longer than usual" messaging (and a retry) without a blank spinner.
  useEffect(() => {
    if (!isRunning) { setElapsedMs(0); return; }
    const startedAt = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [isRunning]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const getLiveMetrics = () => {
    let cost = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let joules = 0;
    let activeNode = null;
    let activeModel = null;
    let activeTier = null;

    if (logs && logs.length > 0) {
      // Deduplicate by node_id to avoid doubling metrics if both REST response and WS logs arrive
      const uniqueLogs = [];
      const seenNodes = new Set();
      for (const log of logs) {
        if (log && log.node_id && !seenNodes.has(log.node_id)) {
          seenNodes.add(log.node_id);
          uniqueLogs.push(log);
        }
      }

      uniqueLogs.forEach(log => {
        cost += log.cost_usd || 0;
        inputTokens += log.input_tokens || 0;
        outputTokens += log.output_tokens || 0;
        joules += log.energy_joules || 0;
      });

      const latestLog = uniqueLogs[0];
      if (latestLog) {
        activeNode = latestLog.node_id;
        activeModel = latestLog.model_used;
        activeTier = latestLog.tier_selected;
      }
    }

    return {
      cost,
      inputTokens,
      outputTokens,
      joules,
      activeNode,
      activeModel,
      activeTier
    };
  };

  const live = getLiveMetrics();

  useEffect(() => {
    scrollToBottom();
  }, [messages, isRunning]);

  const fetchMetrics = () => {
    fetch('http://127.0.0.1:8000/dashboard/metrics', {
      headers: { 'Authorization': `Bearer ${session?.access_token}` }
    })
      .then(res => res.json())
      .then(data => setMetrics({ 
        ...data, 
        baseline_cost: 0, 
        routegen_cost: 0, 
        baseline_joules: 0, 
        routegen_joules: 0, 
        total_savings_pct: 0, 
        energy_savings_pct: 0 
      }))
      .catch(console.error);
  };

  // Fetch metrics + recent sessions on mount
  useEffect(() => {
    fetchMetrics();
    fetchRecentSessions();
    fetchCacheStats();
    fetchBudgetStatus();

    const ws = new WebSocket('ws://127.0.0.1:8000/ws/live');
    ws.onmessage = (event) => {
      setLogs(prev => [JSON.parse(event.data), ...prev].slice(0, 50));
    };

    return () => { ws.close(); };
  }, []);

  const fetchRecentSessions = () => {
    fetch(`${API_BASE}/sessions`, {
      headers: { 'Authorization': `Bearer ${session?.access_token}` }
    })
      .then(res => res.json())
      .then(data => setRecentSessions(data))
      .catch(console.error);
  };

  const fetchCacheStats = () => {
    fetch(`${API_BASE}/cache/stats`, {
      headers: { 'Authorization': `Bearer ${session?.access_token}` }
    })
      .then(res => res.json())
      .then(data => setCacheStats(data))
      .catch(console.error);
  };

  const fetchBudgetStatus = () => {
    if (!sessionId) return;
    fetch(`${API_BASE}/budget/status/${sessionId}`, {
      headers: { 'Authorization': `Bearer ${session?.access_token}` }
    })
      .then(res => res.json())
      .then(data => setBudgetStatus(data))
      .catch(console.error);
  };

  const handleSetBudget = () => {
    const limit = parseFloat(budgetInput);
    if (isNaN(limit) || limit <= 0) return;
    
    fetch(`${API_BASE}/budget/${sessionId}`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ limit })
    })
      .then(res => res.json())
      .then(() => {
        setShowBudgetModal(false);
        setBudgetInput('');
        fetchBudgetStatus();
      })
      .catch(console.error);
  };

  const fetchDocuments = (sid: string) => {
    fetch(`http://127.0.0.1:8000/documents/${sid}`, {
      headers: { 'Authorization': `Bearer ${session?.access_token}` }
    })
      .then(res => res.json())
      .then(data => setUploadedFiles((data.filenames || []).map((filename: string) => ({ filename, chunks: 0 }))))
      .catch(console.error);
  };

  const handleNewChat = () => {
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setLogs([]);
    setUploadedFiles([]);
    setUploadError(null);
    setMetrics((prev: any) => prev ? { ...prev, baseline_cost: 0, routegen_cost: 0, baseline_joules: 0, routegen_joules: 0, total_savings_pct: 0, energy_savings_pct: 0 } : null);
  };

  const handleLoadSession = async (sid: string) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${sid}`, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      const data = await res.json();
      if (data.error) return;

      setSessionId(sid);
      
      // Fetch budget status for the newly loaded session
      fetch(`${API_BASE}/budget/status/${sid}`, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      })
        .then(r => r.json())
        .then(data => setBudgetStatus(data))
        .catch(console.error);

      const messagesRaw = data.messages || [];
      const messages = messagesRaw.map((m: any) => {
        if (m.role === 'assistant' && m.cost !== undefined) {
          // Reconstruct historical trace to render the collapsed pipeline pill
          m.trace = [
            { node_id: 'query_parsing', tier_selected: m.tier || 'unknown' },
            { node_id: 'web_search_summarisation' },
            { node_id: 'evidence_analysis' },
            { node_id: 'contradiction_detection' },
            { node_id: 'final_formatting', model_used: m.model_used || 'unknown', cost_usd: m.cost || 0 }
          ];
          m.isHistorical = true;
        }
        return m;
      });
      
      setMessages(messages);
      setLogs([]);
      setUploadedFiles([]);
      setUploadError(null);

      // Calculate historical metrics for the loaded session
      let historicalCost = 0;
      let historicalBaselineCost = 0;
      let historicalRuns = 0;

      messages.forEach((m: any) => {
        if (m.role === 'assistant' && m.cost) {
          historicalCost += m.cost;
          historicalRuns += 1;
          
          // Approximate baseline multiplier based on model string
          let multiplier = 5; // default fallback
          const modelUsed = (m.model_used || '').toLowerCase();
          if (modelUsed.includes('8b') || modelUsed.includes('small')) multiplier = 10;
          else if (modelUsed.includes('70b') || modelUsed.includes('large')) multiplier = 3;
          else if (modelUsed.includes('120b') || modelUsed.includes('o1') || modelUsed.includes('r1')) multiplier = 1;
          
          historicalBaselineCost += (m.cost * multiplier);
        }
      });
      
      const total_savings_pct = historicalBaselineCost > 0 ? ((historicalBaselineCost - historicalCost) / historicalBaselineCost) * 100 : 0;
      
      setMetrics((prev: any) => {
        const base = prev || { total_runs: 0 };
        return {
          ...base,
          baseline_cost: historicalBaselineCost,
          routegen_cost: historicalCost,
          baseline_joules: historicalBaselineCost * 8000,
          routegen_joules: historicalCost * 8000,
          total_savings_pct,
          energy_savings_pct: total_savings_pct
        };
      });

      if (messages.length > 0) {
        fetchDocuments(sid);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('session_id', sessionId);

      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        body: formData
      });
      const data = await res.json();

      if (data.status === 'ok') {
        setUploadedFiles(prev => [...prev, { filename: data.filename, chunks: data.chunks_added }]);
      } else {
        setUploadError(data.message || 'Upload failed.');
        setTimeout(() => setUploadError(null), 4000);
      }
    } catch (err) {
      setUploadError('Failed to connect to server.');
      setTimeout(() => setUploadError(null), 4000);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearDocuments = async () => {
    try {
      await fetch(`${API_BASE}/documents/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      setUploadedFiles([]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      
      // Clear previous timer
      if (predictionTimer.current) {
        clearTimeout(predictionTimer.current);
      }
      
      // Only predict if 3+ words typed
      const wordCount = value.trim().split(/\s+/).filter(Boolean).length;
      
      if (wordCount < 3) {
        setPredictedTier(null);
        return;
      }
      
      // Debounce 400ms — don't spam API
      predictionTimer.current = setTimeout(
        async () => {
          try {
            const { data: { session: freshSession } } = await supabase.auth.getSession();
            const token = freshSession?.access_token || "mock-access-token";
            
            console.log("🔮 Predicting tier for:", value, "Token:", token);
            const res = await fetch(
              `${API_BASE}/predict-tier`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                  partial_query: value
                })
              }
            );
            const data = await res.json();
            console.log("🔮 Predicted tier result:", data);
            setPredictedTier(data.predicted_tier);
            setPredictionConfidence(data.confidence);
          } catch (e) {
            console.error("Predict tier failed:", e);
          }
        }, 
        400
      );
    },
    []
  );

  const handleSend = async (forcedQuery?: string) => {
    const queryToRun = forcedQuery || input;
    if (!queryToRun.trim() || isRunning) return;

    const tierHint = predictedTier; // Save prediction before resetting input/state

    if (!forcedQuery) {
      setInput('');
      setPredictedTier(null);
    }
    lastQueryRef.current = queryToRun;
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: queryToRun }]);
    setIsRunning(true);
    setLogs([]);

    // Allow the retry button to cancel an in-flight request before re-sending.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Fetch a fresh session so the very first message isn't sent with a
      // stale/undefined token from useOutletContext before auth has hydrated.
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      if (!freshSession) {
        console.error('No session found');
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "Please log in again." }]);
        setIsRunning(false);
        return;
      }
      const token = freshSession.access_token;

      console.log('Calling:', `${API_BASE}/pipeline/run`);
      console.log('Token:', token ? 'present' : 'missing');
      const res = await fetch(`${API_BASE}/pipeline/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          query: queryToRun,
          session_id: sessionId,  // pre-generated client-side so uploads can attach before the first message
          predicted_tier: tierHint || null
        }),
        signal: controller.signal
      });
      const data = await res.json();
      console.log('API response:', data);

      // Clone the trace in pipeline order BEFORE the sidebar log reverse mutates it.
      const pipelineTrace = Array.isArray(data.logs) ? [...data.logs] : [];

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: data.report || "No response generated.",
        cost: data.total_cost,
        trace: pipelineTrace,
        budget_downgrade: data.budget_downgrade,
        budget_downgrade_reason: data.budget_downgrade_reason
      }]);

      if (data.logs) {
        setLogs(prev => [...data.logs.reverse(), ...prev].slice(0, 50));
      }

      // Refresh recent sessions list
      fetchRecentSessions();

      // Live Observability Stats Update for CURRENT session
      const cost = data.total_cost || 0;
      const currentTier = pipelineTrace.find((l: any) => l.node_id === 'query_parsing')?.tier_selected || 'unknown';
      let baselineMultiplier = 1;
      if (currentTier === 'small') baselineMultiplier = 10;
      else if (currentTier === 'large') baselineMultiplier = 3;
      
      const baselineCost = cost * baselineMultiplier;
      
      setMetrics((prev: any) => {
        const p = prev || { baseline_cost: 0, routegen_cost: 0, total_runs: 0 };
        const newRoutegenCost = (p.routegen_cost || 0) + cost;
        const newBaselineCost = (p.baseline_cost || 0) + baselineCost;
        const newTotalRuns = (p.total_runs || 0) + 1;
        
        const total_savings_pct = newBaselineCost > 0 ? ((newBaselineCost - newRoutegenCost) / newBaselineCost) * 100 : 0;
        const energy_savings_pct = total_savings_pct; // Use cost savings as proxy for energy savings

        return {
          ...p,
          baseline_cost: newBaselineCost,
          routegen_cost: newRoutegenCost,
          baseline_joules: newBaselineCost * 8000,
          routegen_joules: newRoutegenCost * 8000,
          total_runs: newTotalRuns,
          total_savings_pct,
          energy_savings_pct
        };
      });

      // Refresh cache and budget stats
      fetchCacheStats();
      fetchBudgetStatus();
    } catch (e: any) {
      // A user-triggered retry aborts the previous request — that's not an error.
      if (e?.name === 'AbortError') return;
      console.error(e);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "Error connecting to intelligent router." }]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsRunning(false);
      }
    }
  };

  // Cancel the in-flight request and re-send the same query (used by the "taking a while" retry).
  const handleRetry = () => {
    const q = lastQueryRef.current;
    if (!q) return;
    abortRef.current?.abort();
    setIsRunning(false);
    // Defer so the isRunning guard in handleSend doesn't block the re-send.
    setTimeout(() => handleSend(q), 0);
  };

  const currentTier = logs.find(l => l.node_id === 'query_parsing')?.tier_selected;
  let timeoutThreshold = 20000;
  if (currentTier === 'small') timeoutThreshold = 8000;
  else if (currentTier === 'large') timeoutThreshold = 15000;
  else if (currentTier === 'reasoning') timeoutThreshold = 25000;

  return (
    <div className="flex h-full w-full bg-background font-sans text-text-primary">
      
      {/* Left Sidebar */}
      <div className="w-[260px] bg-surface/50 border-r border-border hidden md:flex flex-col flex-shrink-0">
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center p-[1px]">
              <div className="w-full h-full bg-surface rounded-[7px] flex items-center justify-center">
                <Compass className="w-5 h-5 text-primary" />
              </div>
            </div>
            <span className="font-bold tracking-wide">RouteGen<span className="text-primary font-normal"> AI</span></span>
          </div>
          <button 
            onClick={handleNewChat}
            className="w-8 h-8 rounded-lg bg-background border border-border hover:border-primary/50 flex items-center justify-center text-text-secondary hover:text-primary transition-colors"
            title="New Chat"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 mt-1">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg bg-primary/10 text-primary font-medium border border-primary/20 hover:bg-primary/15 active:scale-[0.98] transition-all shadow-sm hover:shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm">New Chat</span>
          </button>
        </div>

        {/* Option Buttons (Compare, Observability, Budget) */}
        <div className="p-3 border-b border-border space-y-1">
          <button 
            onClick={() => setCompareMode(!compareMode)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${compareMode ? 'bg-secondary/10 text-secondary border border-secondary/30' : 'hover:bg-surface-hover text-text-secondary hover:text-text-primary'}`}
          >
            <div className="flex items-center space-x-3">
              <Scale className="w-4 h-4" />
              <span className="text-sm font-medium">Compare Mode</span>
            </div>
            {compareMode && <span className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(168,85,247,0.8)]"></span>}
          </button>
          <button 
            onClick={() => setShowInsights(!showInsights)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${showInsights ? 'bg-primary/10 text-primary' : 'hover:bg-surface-hover text-text-secondary hover:text-text-primary'}`}
          >
            <div className="flex items-center space-x-3">
              <Activity className="w-4 h-4" />
              <span className="text-sm">Observability</span>
            </div>
            <ChevronRight className={`w-4 h-4 transition-transform ${showInsights ? 'rotate-90' : ''}`} />
          </button>
          <button 
            onClick={() => setShowBudgetModal(true)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors hover:bg-surface-hover text-text-secondary hover:text-text-primary`}
          >
            <div className="flex items-center space-x-3">
              <span className="w-4 h-4 text-center">💰</span>
              <span className="text-sm">Set Budget</span>
            </div>
          </button>
          
          {budgetStatus?.budget_set && (
            <div className="mt-4 px-2">
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="text-text-secondary uppercase tracking-wider font-semibold">Budget Used</span>
                <span className="text-white font-mono">${budgetStatus.total_spent.toFixed(4)} / ${(budgetStatus.budget_limit || 0).toFixed(2)}</span>
              </div>
              <div className="budget-bar mb-2">
                <div 
                  className={`budget-fill ${budgetStatus.status}`}
                  style={{width: `${Math.min(100, (budgetStatus.usage_pct || 0) * 100)}%`}}
                />
              </div>
              {budgetStatus.forced_downgrades > 0 && (
                <div className="text-[10px] text-warning/90 mt-1 flex items-start space-x-1 leading-tight">
                  <span>⚠️</span>
                  <span>{budgetStatus.forced_downgrades} queries downgraded to save budget</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live Prompt Metrics Monitor */}
        {logs.length > 0 && (
          <div className="mx-3 my-3 p-4 bg-gradient-to-b from-surface/90 to-surface/55 border border-border/95 rounded-xl space-y-4 shadow-lg backdrop-blur-sm animate-fade-in">
            <div className="flex items-center justify-between pb-1 border-b border-border/40">
              <span className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-primary animate-ping"></span>
                Live Prompt Metrics
              </span>
              {isRunning && (
                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded font-medium animate-pulse">
                  Running...
                </span>
              )}
            </div>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-text-secondary text-[13px]">Active Node:</span>
                <span className="font-semibold text-white truncate max-w-[130px]" title={live.activeNode || "idle"}>
                  {live.activeNode ? live.activeNode.replace(/_/g, ' ') : 'idle'}
                </span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-text-secondary text-[13px]">Selected Tier:</span>
                <span className={`font-semibold capitalize px-2 py-0.5 rounded text-xs ${
                  live.activeTier === 'reasoning' ? 'bg-secondary/20 text-secondary' :
                  live.activeTier === 'large' ? 'bg-primary/20 text-primary' :
                  live.activeTier === 'baseline' ? 'bg-gray-800 text-gray-300' :
                  'bg-success/20 text-success'
                }`}>
                  {live.activeTier || 'none'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-text-secondary text-[13px]">Tokens Used:</span>
                <span className="font-bold text-white text-[13px]">
                  {live.inputTokens + live.outputTokens} <span className="text-xs font-normal text-text-secondary">({live.inputTokens}in / {live.outputTokens}out)</span>
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-text-secondary text-[13px]">Cost (USD):</span>
                <span className="font-bold text-success text-[14px]">
                  ${live.cost.toFixed(5)}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-text-secondary text-[13px]">Energy:</span>
                <span className="font-bold text-warning flex items-center gap-1.5 text-[13px]">
                  <Zap className="w-4 h-4" />
                  {live.joules.toFixed(2)} Joules
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Recent Sessions */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1 custom-scrollbar">
          {recentSessions.length > 0 && (
            <>
              <div className="pb-2 px-3">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Recent Chats</span>
              </div>
              {recentSessions.map((s) => (
                <button
                  key={s.session_id}
                  onClick={() => handleLoadSession(s.session_id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm truncate transition-colors flex items-center space-x-2 ${
                    sessionId === s.session_id 
                      ? 'bg-surface-hover text-text-primary font-medium' 
                      : 'hover:bg-surface-hover text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-50" />
                  <span className="truncate">{s.title}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* User Profile / Logout */}
        <div className="p-3 border-t border-border mt-auto">
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface/50 border border-border">
            <div className="flex items-center space-x-2 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs text-text-secondary truncate">{session?.user?.email}</span>
            </div>
            <button 
              onClick={() => supabase.auth.signOut()}
              className="p-2 text-text-secondary hover:text-danger transition-colors shrink-0"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full relative w-full overflow-hidden bg-grid-dots">
        {/* Budget Modal */}
        {showBudgetModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="bg-surface border border-border p-6 rounded-2xl shadow-xl w-[320px] max-w-[90%]">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg">Set Session Budget</h3>
                <button onClick={() => setShowBudgetModal(false)} className="text-text-secondary hover:text-text-primary">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-text-secondary mb-4 leading-relaxed">
                RouteGen will automatically use cheaper models as you approach this limit to prevent overspending.
              </p>
              <div className="mb-6 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">$</span>
                <input 
                  type="number" 
                  step="0.01"
                  placeholder="e.g. 0.10"
                  value={budgetInput}
                  onChange={e => setBudgetInput(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg py-2.5 pl-8 pr-3 text-text-primary focus:outline-none focus:border-primary/50"
                  autoFocus
                  onKeyDown={e => { if(e.key === 'Enter') handleSetBudget(); }}
                />
              </div>
              <button 
                onClick={handleSetBudget}
                disabled={!budgetInput}
                className="w-full bg-primary text-background font-bold py-2.5 rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Set Budget Limit
              </button>
            </div>
          </div>
        )}

        {compareMode ? (
          <CompareDashboard session={session} sessionId={sessionId} />
        ) : (
          <>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_UPLOAD_TYPES}
          onChange={handleFileUpload}
          className="hidden"
        />

        {uploadError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-danger/90 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
            {uploadError}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 mt-[-10vh] relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/10 rounded-full blur-[100px] animate-pulse-slow pointer-events-none"></div>
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-6 relative z-10">
              <Compass className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4 text-center relative z-10">
              Welcome to <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">RouteGen AI</span>
            </h1>
            <p className="text-text-secondary text-center max-w-2xl mb-12">
              An intelligent routing layer that analyzes your prompt's complexity and instantly dispatches it to the most cost-effective LLM. Fast. Bold. Optimized.
            </p>

            <div className="w-full max-w-3xl relative group">
              {predictedTier && (
                <div className="prediction-badge">
                  {predictedTier === 'small' && '⚡ Simple query detected'}
                  {predictedTier === 'large' && '🧠 Analysis query detected'}
                  {predictedTier === 'reasoning' && '🔬 Complex reasoning detected'}
                </div>
              )}
              {uploadedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {uploadedFiles.map((f, i) => (
                    <span key={`${f.filename}-${i}`} className="flex items-center space-x-1.5 px-3 py-1 bg-surface border border-border rounded-full text-xs text-text-secondary">
                      <Paperclip className="w-3 h-3" />
                      <span>{f.filename}</span>
                    </span>
                  ))}
                </div>
              )}
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/30 to-secondary/30 rounded-2xl blur opacity-20 group-focus-within:opacity-50 transition duration-1000"></div>
              <div className="relative bg-surface rounded-2xl border border-border p-2">
                <textarea
                  value={input}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask anything..."
                  disabled={isRunning}
                  className="w-full bg-transparent min-h-[120px] p-4 text-[16px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none resize-none disabled:opacity-50"
                />
                <div className="flex items-center justify-between px-2 pb-2">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-background border border-border hover:border-primary/50 text-xs text-text-secondary transition-colors disabled:opacity-50"
                      title="Attach a PDF, PPTX, or image"
                    >
                      {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
                      <span>{isUploading ? 'Uploading...' : 'Attach'}</span>
                    </button>
                    <button onClick={() => handleSend("Analyze the ethical implications of AGI.")} className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-background border border-border hover:border-primary/50 text-xs text-text-secondary transition-colors">
                      <Zap className="w-3 h-3 text-warning" />
                      <span>Deep Search</span>
                    </button>
                  </div>
                  <button
                    onClick={() => handleSend()}
                    disabled={isRunning || !input.trim()}
                    className="p-2.5 bg-text-primary hover:bg-white active:scale-95 text-background rounded-xl disabled:bg-border disabled:text-text-secondary disabled:cursor-not-allowed disabled:active:scale-100 transition-all shadow-md hover:shadow-lg"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4 pb-32 pt-6 custom-scrollbar w-full">
              <div className="max-w-4xl mx-auto space-y-8 w-full">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex w-full animate-fade-in-up ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'user' ? (
                      <div className="bg-surface border border-border px-5 py-3 rounded-2xl max-w-[85%] shadow-sm">
                        <p className="text-text-primary leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ) : (
                      <div className="flex items-start space-x-4 max-w-[100%] w-full">
                        <div className="w-8 h-8 rounded-lg bg-surface flex flex-shrink-0 items-center justify-center border border-primary/30 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                          <Compass className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-3">
                          {msg.trace && msg.trace.length > 0 && msg.trace[0].cache_hit && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)] mb-1">
                              <Zap className="w-3.5 h-3.5 text-green-400" />
                              <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider">Smart Cached</span>
                            </div>
                          )}
                          {msg.budget_downgrade && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warning/10 border border-warning/20 shadow-[0_0_10px_rgba(245,158,11,0.1)] mb-1 mt-1 block w-fit">
                              <span className="text-[10px] font-bold text-warning uppercase tracking-wider flex items-center gap-1">
                                💰 {msg.budget_downgrade_reason}
                              </span>
                            </div>
                          )}
                          {/* Pipeline trace: appears between the user's message and this response */}
                          {msg.trace && msg.trace.length > 0 && (
                            <div className="mt-1">
                              <PipelineVisualizer trace={msg.trace} autoCollapse={!msg.isHistorical} defaultCollapsed={msg.isHistorical} />
                            </div>
                          )}
                          <div className="pt-2 text-text-primary prose prose-invert prose-sm sm:prose-base prose-p:leading-relaxed prose-pre:bg-surface prose-pre:border prose-pre:border-border">
                            <ReactMarkdown
                              remarkPlugins={[remarkMath]}
                              rehypePlugins={[rehypeKatex]}
                              components={{
                                ul: ({node, ...props}: any) => <ul className="list-disc ml-4 my-2 space-y-1" {...props} />,
                                ol: ({node, ...props}: any) => <ol className="list-decimal ml-4 my-2 space-y-1" {...props} />,
                                li: ({node, ...props}: any) => <li className="ml-2 leading-relaxed" {...props} />,
                                h1: ({node, ...props}: any) => <h1 className="text-xl font-bold my-3" {...props} />,
                                h2: ({node, ...props}: any) => <h2 className="text-lg font-bold my-2" {...props} />,
                                h3: ({node, ...props}: any) => <h3 className="text-base font-semibold my-2" {...props} />,
                                code: ({node, inline, ...props}: any) => inline
                                  ? <code className="bg-gray-800 px-1 rounded text-sm font-mono" {...props} />
                                  : <code className="block bg-gray-800 p-3 rounded my-2 text-sm font-mono overflow-x-auto" {...props} />,
                                p: ({node, ...props}: any) => <p className="my-2 leading-relaxed" {...props} />,
                                strong: ({node, ...props}: any) => <strong className="font-bold" {...props} />,
                                blockquote: ({node, ...props}: any) => <blockquote className="border-l-4 border-indigo-500 pl-4 my-2 italic text-gray-300" {...props} />,
                                table: ({node, ...props}: any) => <table className="border-collapse my-3 w-full text-sm" {...props} />,
                                th: ({node, ...props}: any) => <th className="border border-gray-600 px-3 py-2 bg-gray-800 font-bold" {...props} />,
                                td: ({node, ...props}: any) => <td className="border border-gray-600 px-3 py-2" {...props} />,
                              }}
                            >
                              {preprocessLaTeX(msg.content)}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {isRunning && (
                  <div className="flex items-start space-x-4 w-full">
                    <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center border border-primary/30">
                      <Sparkles className="w-4 h-4 text-primary animate-pulse" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Instant "something is happening" feedback */}
                      <div className="typing-indicator" aria-label="Assistant is thinking">
                        <span></span><span></span><span></span>
                      </div>
                      <PipelineVisualizer live title="Routing through pipeline" />
                      {elapsedMs > timeoutThreshold && (
                        <p className="text-xs text-text-secondary">
                          {elapsedMs > 45000
                            ? 'This is taking a while.'
                            : '⏳ Taking longer than usual — our reasoning model is working hard on this...'}
                        </p>
                      )}
                      {elapsedMs > 45000 && (
                        <button
                          onClick={handleRetry}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-surface border border-border text-text-primary hover:border-primary/50 transition-colors"
                        >
                          ↻ Try again with a faster model
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Sticky Input Bar */}
            <div className="absolute bottom-0 w-full bg-gradient-to-t from-background via-background to-transparent pt-10 pb-6 px-4">
              <div className="max-w-3xl mx-auto relative group">
                {predictedTier && (
                  <div className="prediction-badge">
                    {predictedTier === 'small' && '⚡ Simple query detected'}
                    {predictedTier === 'large' && '🧠 Analysis query detected'}
                    {predictedTier === 'reasoning' && '🔬 Complex reasoning detected'}
                  </div>
                )}
                {uploadedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {uploadedFiles.map((f, i) => (
                      <span key={`${f.filename}-${i}`} className="flex items-center space-x-1.5 px-3 py-1 bg-surface border border-border rounded-full text-xs text-text-secondary">
                        <Paperclip className="w-3 h-3" />
                        <span>{f.filename}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-2xl blur opacity-30 group-focus-within:opacity-100 transition duration-500"></div>
                <div className="relative flex items-end bg-surface rounded-2xl shadow-sm border border-border focus-within:border-primary/50 transition-all p-2 pl-4">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="p-2 mb-1 mr-1 text-text-secondary hover:text-primary transition-colors disabled:opacity-50 shrink-0"
                    title="Attach a PDF, PPTX, or image"
                  >
                    {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
                  </button>
                  <textarea
                    value={input}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Ask anything..."
                    disabled={isRunning}
                    className="w-full bg-transparent max-h-48 min-h-[44px] py-2.5 text-[15px] text-text-primary placeholder:text-text-secondary focus:outline-none resize-none disabled:opacity-50 custom-scrollbar"
                    rows={1}
                    style={{ height: 'auto' }}
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={isRunning || !input.trim()}
                    className="p-2 mb-1 mr-1 bg-text-primary hover:bg-white active:scale-95 text-background rounded-xl disabled:bg-border disabled:text-text-secondary disabled:cursor-not-allowed disabled:active:scale-100 transition-all shadow-md hover:shadow-lg"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
          </>
        )}
      </div>

      {/* Right: Observability Dashboard */}
      <div className={`${showInsights ? 'flex' : 'hidden'} w-[380px] flex-col bg-surface/30 border-l border-border h-full backdrop-blur-md transition-all duration-300 absolute right-0 z-40 md:relative`}>
        <div className="p-4 border-b border-border bg-surface/50 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold tracking-wide text-text-primary uppercase">Routing Observability</span>
          </div>
          <button onClick={() => setShowInsights(false)} className="md:hidden text-text-secondary">
            <Settings className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
          <CostPanel metrics={metrics} />

          <DocumentsPanel files={uploadedFiles} onClear={handleClearDocuments} />

          <div className="mt-8">
            <h3 className="text-xs font-semibold uppercase text-text-secondary mb-3 flex items-center space-x-2">
              <Zap className="w-4 h-4 text-green-400" />
              <span>Smart Context Cache</span>
            </h3>
            <div className="bg-surface rounded-xl border border-border p-4 shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <span className="text-sm text-text-secondary">Cache Hits</span>
                <span className="text-lg font-bold text-green-400">{cacheStats?.total_hits || 0}</span>
              </div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-sm text-text-secondary">Hit Rate</span>
                <span className="text-lg font-bold text-white">{((cacheStats?.hit_rate || 0) * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-border/50">
                <span className="text-sm text-text-secondary">Total Cost Saved</span>
                <span className="text-lg font-bold text-success">${(cacheStats?.total_cost_saved || 0).toFixed(4)}</span>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <h3 className="text-xs font-semibold uppercase text-text-secondary mb-3 flex items-center space-x-2">
              <Clock className="w-4 h-4" />
              <span>Live Execution Trace</span>
            </h3>
            <div className="bg-background rounded-xl border border-border p-1 shadow-inner">
              <RoutingLogTable logs={logs} />
            </div>
          </div>
        </div>
      </div>
      
    </div>
  );
};

export default ChatApp;
