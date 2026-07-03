import React, { useState, useEffect, useRef } from 'react';
import CostPanel from './panels/CostPanel';
import RoutingLogTable from './panels/RoutingLogTable';
import ComparePanel from './panels/ComparePanel';
import DocumentsPanel from './panels/DocumentsPanel';
import { Send, Sparkles, Activity, Clock, Compass, Zap, Settings, ChevronRight, Menu, Plus, Scale, MessageSquare, Search, LogOut, User, Paperclip, X, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const ACCEPTED_UPLOAD_TYPES = '.pdf,.pptx,.jpg,.jpeg,.png';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  baseline_content?: string;
  judge_score?: any;
  cost?: number;
  baseline_cost?: number;
}

interface SessionSummary {
  session_id: string;
  title: string;
  created_at: number;
  message_count: number;
}

const ChatApp = () => {
  const { session } = useOutletContext<{ session: any }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isRunning]);

  const latestComparisonMessage = [...messages].reverse().find(m => m.baseline_cost !== undefined);

  // Fetch metrics + recent sessions on mount
  useEffect(() => {
    fetch('http://localhost:8000/dashboard/metrics', {
      headers: { 'Authorization': `Bearer ${session?.access_token}` }
    })
      .then(res => res.json())
      .then(data => setMetrics(data))
      .catch(console.error);

    fetchRecentSessions();

    const ws = new WebSocket('ws://localhost:8000/ws/live');
    ws.onmessage = (event) => {
      setLogs(prev => [JSON.parse(event.data), ...prev].slice(0, 50));
    };

    return () => { ws.close(); };
  }, []);

  const fetchRecentSessions = () => {
    fetch('http://localhost:8000/sessions', {
      headers: { 'Authorization': `Bearer ${session?.access_token}` }
    })
      .then(res => res.json())
      .then(data => setRecentSessions(data))
      .catch(console.error);
  };

  const fetchDocuments = (sid: string) => {
    fetch(`http://localhost:8000/documents/${sid}`, {
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
  };

  const handleLoadSession = async (sid: string) => {
    try {
      const res = await fetch(`http://localhost:8000/sessions/${sid}`, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      const data = await res.json();
      if (data.error) return;

      setSessionId(sid);
      setMessages(
        data.messages.map((msg: any, i: number) => ({
          id: `${sid}-${i}`,
          role: msg.role,
          content: msg.content,
        }))
      );
      setLogs([]);
      fetchDocuments(sid);
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

      const res = await fetch('http://localhost:8000/upload', {
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
      await fetch(`http://localhost:8000/documents/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      setUploadedFiles([]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSend = async (forcedQuery?: string) => {
    const queryToRun = forcedQuery || input;
    if (!queryToRun.trim() || isRunning) return;

    if (!forcedQuery) setInput('');
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: queryToRun }]);
    setIsRunning(true);
    setLogs([]); 

    try {
      const res = await fetch('http://localhost:8000/pipeline/run', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}` 
        },
        body: JSON.stringify({
          query: queryToRun,
          compare: compareMode,
          session_id: sessionId  // pre-generated client-side so uploads can attach before the first message
        })
      });
      const data = await res.json();

      setMessages(prev => [...prev, {
        id: Date.now().toString(), 
        role: 'assistant', 
        content: data.final_report || "No response generated.",
        baseline_content: data.baseline_report,
        judge_score: data.judge_score,
        cost: data.total_cost,
        baseline_cost: data.baseline_cost
      }]);

      if (data.logs) {
        setLogs(prev => [...data.logs.reverse(), ...prev].slice(0, 50));
      }

      // Refresh recent sessions list
      fetchRecentSessions();
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "Error connecting to intelligent router." }]);
    } finally {
      setIsRunning(false);
    }
  };

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
            className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg bg-primary/10 text-primary font-medium border border-primary/20 hover:bg-primary/15 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm">New Chat</span>
          </button>
        </div>

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

        <div className="p-3 border-t border-border space-y-1">
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
      <div className="flex-1 flex flex-col h-full relative w-full overflow-hidden">
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
          <div className="flex-1 flex flex-col items-center justify-center p-6 mt-[-10vh]">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mb-6">
              <Compass className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4 text-center">
              Welcome to <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">RouteGen AI</span>
            </h1>
            <p className="text-text-secondary text-center max-w-2xl mb-12">
              An intelligent routing layer that analyzes your prompt's complexity and instantly dispatches it to the most cost-effective LLM. Fast. Bold. Optimized.
            </p>

            <div className="w-full max-w-3xl relative group">
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
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={compareMode ? "Compare Mode Active: Ask anything to run side-by-side benchmark..." : "Ask anything..."}
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
                    className="p-2.5 bg-text-primary hover:bg-white text-background rounded-xl disabled:bg-border disabled:text-text-secondary disabled:cursor-not-allowed transition-all"
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
                  <div key={msg.id} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'user' ? (
                      <div className="bg-surface border border-border px-5 py-3 rounded-2xl max-w-[85%] shadow-sm">
                        <p className="text-text-primary leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col w-full space-y-4">
                        {!msg.baseline_content ? (
                          <div className="flex items-start space-x-4 max-w-[100%]">
                            <div className="w-8 h-8 rounded-lg bg-surface flex flex-shrink-0 items-center justify-center border border-primary/30 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                              <Compass className="w-5 h-5 text-primary" />
                            </div>
                            <div className="pt-1 text-text-primary prose prose-invert prose-sm sm:prose-base prose-p:leading-relaxed prose-pre:bg-surface prose-pre:border prose-pre:border-border">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          </div>
                        ) : (
                          // Delta Panel (Compare Mode)
                          <div className="w-full space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                              {/* Routed Side */}
                              <div className="bg-surface border border-primary/50 rounded-2xl p-4 relative shadow-[0_0_15px_rgba(6,182,212,0.1)] flex flex-col">
                                <div className="absolute -top-3 left-4 bg-primary text-background text-xs font-bold px-3 py-1 rounded-full flex items-center space-x-1">
                                  <Compass className="w-3 h-3" />
                                  <span>Intelligent Routed AI</span>
                                </div>
                                <div className="prose prose-invert prose-sm flex-1 mt-2 mb-4 overflow-x-auto">
                                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                                </div>
                                <div className="pt-3 border-t border-border flex justify-between items-center bg-background/50 -mx-4 -mb-4 p-4 rounded-b-2xl">
                                  <div className="flex flex-col">
                                    <span className="text-xs text-text-secondary uppercase tracking-wider">Cost</span>
                                    <span className="text-success text-sm font-bold">${msg.cost?.toFixed(5)}</span>
                                  </div>
                                  <div className="flex flex-col items-end">
                                    <span className="text-xs text-text-secondary uppercase tracking-wider">Quality Score</span>
                                    <span className="text-primary text-lg font-bold">{msg.judge_score?.score_a}/10</span>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Baseline Side */}
                              <div className="bg-surface border border-border rounded-2xl p-4 relative flex flex-col">
                                <div className="absolute -top-3 left-4 bg-background border border-border text-text-secondary text-xs font-bold px-3 py-1 rounded-full">
                                  Baseline (Gemini 1.5 Pro)
                                </div>
                                <div className="prose prose-invert prose-sm flex-1 mt-2 mb-4 overflow-x-auto opacity-80">
                                  <ReactMarkdown>{msg.baseline_content}</ReactMarkdown>
                                </div>
                                <div className="pt-3 border-t border-border flex justify-between items-center bg-background/50 -mx-4 -mb-4 p-4 rounded-b-2xl">
                                  <div className="flex flex-col">
                                    <span className="text-xs text-text-secondary uppercase tracking-wider">Cost</span>
                                    <span className="text-danger text-sm font-bold">${msg.baseline_cost?.toFixed(5)}</span>
                                  </div>
                                  <div className="flex flex-col items-end">
                                    <span className="text-xs text-text-secondary uppercase tracking-wider">Quality Score</span>
                                    <span className="text-text-primary text-lg font-bold">{msg.judge_score?.score_b}/10</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            
                            {/* Summary Banner */}
                            {(msg.baseline_cost && msg.cost) ? (
                              <div className="w-full bg-surface-hover border border-border rounded-xl p-4 flex flex-col md:flex-row items-center justify-between shadow-sm">
                                <div className="flex items-start space-x-3 mb-2 md:mb-0">
                                  <Scale className="w-5 h-5 text-secondary mt-0.5 shrink-0" />
                                  <div className="flex flex-col text-sm">
                                    <span className="text-text-primary font-medium">LLM-as-a-Judge Evaluation</span>
                                    <span className="text-text-secondary mt-1">{msg.judge_score?.reason || "Evaluation completed."}</span>
                                  </div>
                                </div>
                                <div className="flex flex-col items-center justify-center shrink-0 ml-4 px-4 py-2 bg-success/10 rounded-lg border border-success/20">
                                  <span className="text-xs text-success font-semibold uppercase tracking-wide">Saved</span>
                                  <span className="text-success text-xl font-black">
                                    {(((msg.baseline_cost - msg.cost) / msg.baseline_cost) * 100).toFixed(0)}%
                                  </span>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {isRunning && (
                  <div className="flex items-start space-x-4">
                    <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center border border-primary/30">
                      <Sparkles className="w-4 h-4 text-primary animate-pulse" />
                    </div>
                    <div className="pt-1 text-text-secondary text-sm flex flex-col space-y-1">
                      <span>{compareMode ? "Running side-by-side benchmark..." : "Routing through pipeline..."}</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Sticky Input Bar */}
            <div className="absolute bottom-0 w-full bg-gradient-to-t from-background via-background to-transparent pt-10 pb-6 px-4">
              <div className="max-w-3xl mx-auto relative group">
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
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={compareMode ? "Compare Mode Active: Benchmark a query side-by-side..." : "Ask anything..."}
                    disabled={isRunning}
                    className="w-full bg-transparent max-h-48 min-h-[44px] py-2.5 text-[15px] text-text-primary placeholder:text-text-secondary focus:outline-none resize-none disabled:opacity-50 custom-scrollbar"
                    rows={1}
                    style={{ height: 'auto' }}
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={isRunning || !input.trim()}
                    className="p-2 mb-1 mr-1 bg-text-primary hover:bg-white text-background rounded-xl disabled:bg-border disabled:text-text-secondary disabled:cursor-not-allowed transition-all"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
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
          {compareMode && (
            <ComparePanel 
              costRouted={latestComparisonMessage?.cost} 
              costBaseline={latestComparisonMessage?.baseline_cost} 
              judgeScore={latestComparisonMessage?.judge_score} 
            />
          )}
          <CostPanel metrics={metrics} />

          <DocumentsPanel files={uploadedFiles} onClear={handleClearDocuments} />

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
