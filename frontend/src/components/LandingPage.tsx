import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  Compass, Scale, BrainCircuit, 
  Coins, Leaf, Cpu, Eye, EyeOff, Loader2, AlertCircle, 
  X, Lightbulb, Smartphone, Car, Sparkles, Activity,
  CheckCircle, Plus, Users, Lock, ChevronRight, ArrowRight
} from 'lucide-react';

// Heuristic prompt classification matching python backend
const negationWords = new Set(["not", "never", "none", "no", "cannot", "don't", "won't", "shouldn't", "mustn't", "neither", "nor"]);
const conditionalWords = new Set(["if", "unless", "given", "provided", "assuming", "whether", "case"]);
const structuredKeywords = new Set(["json", "code", "table", "csv", "xml", "html", "dictionary", "array", "list", "format"]);

const analyzePrompt = (text: string) => {
  const normalized = text.toLowerCase();
  const words = normalized.match(/\b\w+\b/g) || [];
  const sentences = normalized.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  const tokenCount = Math.round(words.length * 1.3);
  const sentenceCount = sentences.length > 0 ? sentences.length : 1;
  const questionCount = (text.match(/\?/g) || []).length;
  
  const longWords = words.filter(w => w.length > 8);
  const technicalTermRatio = words.length > 0 ? longWords.length / words.length : 0;
  
  const structuredOutputRequired = Array.from(structuredKeywords).some(kw => normalized.includes(kw));
  const negationCount = words.filter(w => negationWords.has(w)).length;
  const conditionalCount = words.filter(w => conditionalWords.has(w)).length;
  const avgWordLength = words.length > 0 ? words.reduce((acc, w) => acc + w.length, 0) / words.length : 0;
  
  // Scoring dimensions
  const lenScore = Math.min(10.0, Math.max(1.0, (tokenCount / 100.0) + 1.0));
  const ambScore = Math.min(10.0, Math.max(1.0, questionCount * 2.0 + (avgWordLength - 4)));
  const domScore = Math.min(10.0, Math.max(1.0, technicalTermRatio * 30.0 + 1.0));
  const fmtScore = structuredOutputRequired ? 8.0 : 2.0;
  const rsnScore = Math.min(10.0, Math.max(1.0, (negationCount * 1.5) + (conditionalCount * 2.0) + 1.0));
  
  let totalScore = (
    lenScore * 0.20 +
    ambScore * 0.20 +
    domScore * 0.25 +
    fmtScore * 0.15 +
    rsnScore * 0.20
  );
  
  totalScore = Math.min(10.0, Math.max(1.0, Math.round(totalScore * 10) / 10));
  
  let tier: 'small' | 'large' | 'reasoning' = 'small';
  if (totalScore <= 4.0) {
    tier = 'small';
  } else if (totalScore <= 7.0) {
    tier = 'large';
  } else {
    tier = 'reasoning';
  }
  
  return {
    score: totalScore,
    tier,
    breakdown: {
      length: Math.round(lenScore * 10) / 10,
      ambiguity: Math.round(ambScore * 10) / 10,
      domain: Math.round(domScore * 10) / 10,
      format: Math.round(fmtScore * 10) / 10,
      reasoning: Math.round(rsnScore * 10) / 10
    },
    metrics: {
      tokens: tokenCount,
      words: words.length,
      sentences: sentenceCount
    }
  };
};

interface TierInfo {
  name: string;
  model: string;
  energyPerQuery: number; // in Wh
  costPerMTokens: number; // in USD
  typicalLatency: number; // in ms
  description: string;
  useCase: string;
  color: string;
  glowColor: string;
}

const TIER_SPECS: Record<'small' | 'large' | 'reasoning', TierInfo> = {
  small: {
    name: 'Small Tier',
    model: 'Llama 3.2 (3B) / 8B',
    energyPerQuery: 1.2, // 1.2 Wh
    costPerMTokens: 0.15, // $0.15 / M tokens
    typicalLatency: 180, // 180 ms
    description: 'Blazing-fast, ultra-low cost model running on commodity hardware. Fits standard parsing tasks.',
    useCase: 'Data extraction, simple summaries, formatting, spelling corrections',
    color: 'from-cyan-500 to-blue-600',
    glowColor: 'rgba(6,182,212,0.4)'
  },
  large: {
    name: 'Large Tier',
    model: 'Gemini 1.5 Pro',
    energyPerQuery: 8.5, // 8.5 Wh
    costPerMTokens: 1.25, // $1.25 / M tokens
    typicalLatency: 520, // 520 ms
    description: 'Balanced frontier model combining excellent logical coherence and code comprehension.',
    useCase: 'Coding support, multi-step queries, creative drafts, research context mapping',
    color: 'from-indigo-500 to-purple-600',
    glowColor: 'rgba(99,102,241,0.4)'
  },
  reasoning: {
    name: 'Reasoning Tier',
    model: 'Llama 3 70B / DeepSeek R1',
    energyPerQuery: 38.0, // 38 Wh
    costPerMTokens: 4.50, // $4.50 / M tokens
    typicalLatency: 1100, // 1.1s
    description: 'Heavyweight cognitive agent configured for advanced math, logical validation, and compilation.',
    useCase: 'Advanced programming, architectural verification, deep reasoning, multi-layered constraints',
    color: 'from-purple-600 to-pink-600',
    glowColor: 'rgba(168,85,247,0.4)'
  }
};

const DIRECT_MODEL = {
  name: 'Frontier AI (Direct Approach)',
  model: 'GPT-4o / Claude 3.5 Sonnet',
  energyPerQuery: 145.0, // 145 Wh per query average
  costPerMTokens: 15.00, // $15.00 / M tokens
  typicalLatency: 1500 // 1.5s
};

const PRESETS = [
  {
    label: "Small Task",
    text: "Fix typo and formatting: 'there is no place like home, lets go.'",
    desc: "Typo fix"
  },
  {
    label: "Medium Task",
    text: "Convert the following array of users into a formatted CSV string containing name and age: [{name: 'Alice', age: 30}, {name: 'Bob', age: 24}].",
    desc: "Data transform"
  },
  {
    label: "Complex Task",
    text: "Prove that the square root of 2 is irrational by contradiction. Detail the mathematical induction steps.",
    desc: "Mathematical proof"
  },
  {
    label: "Coding Architect",
    text: "Draft a high-concurrency event-driven task queue system in Rust using tokio channels and thread pools. Ensure zero data loss under network failure.",
    desc: "Rust backend design"
  }
];

const LandingPage = () => {
  const navigate = useNavigate();
  
  // Simulation State
  const [inputText, setInputText] = useState(PRESETS[0].text);
  const [activeAnalysis, setActiveAnalysis] = useState(analyzePrompt(PRESETS[0].text));
  const [isTyping, setIsTyping] = useState(false);

  // Auth Dialog States
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authType, setAuthType] = useState<'individual' | 'enterprise'>('individual');
  const [ssoType, setSsoType] = useState<'domain' | 'token'>('domain');
  
  // GitHub Auto-Import State
  const [autoImportGithub, setAutoImportGithub] = useState(true);

  // Enterprise SSO Inputs
  const [ssoDomain, setSsoDomain] = useState('');
  const [ssoToken, setSsoToken] = useState('');

  // Onboarding Workspace States
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<'create_team' | 'github_imported'>('create_team');
  const [teamName, setTeamName] = useState('');

  // Password fields
  const [showPassword, setShowPassword] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Feedback states
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<'google' | 'github' | 'email' | 'sso' | null>(null);

  // Recalculate analysis when typing
  useEffect(() => {
    setIsTyping(true);
    const timer = setTimeout(() => {
      setActiveAnalysis(analyzePrompt(inputText));
      setIsTyping(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [inputText]);

  // Auth Validations
  const validateAuthForm = () => {
    setAuthError(null);
    if (!email || !password) {
      setAuthError("Email and password are required.");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setAuthError("Invalid email format.");
      return false;
    }
    if (password.length < 8) {
      setAuthError("Password must be at least 8 characters.");
      return false;
    }
    if (authMode === 'signup' && (!firstName.trim() || !lastName.trim())) {
      setAuthError("First and Last name are required for registration.");
      return false;
    }
    return true;
  };

  // Onboarding Step Triggers
  const triggerOnboardingCheck = () => {
    setIsAuthOpen(false);
    setShowOnboarding(true);
    setOnboardingStep('create_team');
  };

  // Submit Handlers
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAuthForm()) return;
    
    setAuthLoading('email');
    setAuthError(null);

    try {
      if (authMode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (signInError) throw signInError;
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: firstName,
              last_name: lastName,
            }
          }
        });
        if (signUpError) throw signUpError;
      }
      triggerOnboardingCheck();
    } catch (err: any) {
      setAuthError(err.message || "An authentication error occurred.");
    } finally {
      setAuthLoading(null);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setAuthLoading(provider);
    setAuthError(null);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin + '/chat'
        }
      });
      if (oauthError) throw oauthError;

      if (!import.meta.env.VITE_SUPABASE_URL) {
        // Simulation for Offline Demo Mode
        setTimeout(() => {
          setAuthLoading(null);
          setIsAuthOpen(false);
          setShowOnboarding(true);
          if (provider === 'github' && autoImportGithub) {
            setOnboardingStep('github_imported');
          } else {
            setOnboardingStep('create_team');
          }
        }, 1200);
      }
    } catch (err: any) {
      setAuthError(err.message || `Failed to authenticate with ${provider}.`);
      setAuthLoading(null);
    }
  };

  const handleSSOAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (ssoType === 'domain' && !ssoDomain.trim()) {
      setAuthError("Corporate Email or Domain is required for SSO.");
      return;
    }
    if (ssoType === 'token' && !ssoToken.trim()) {
      setAuthError("Team SSO Reference Token is required.");
      return;
    }

    setAuthLoading('sso');
    // Simulate SSO check against Identity Provider
    setTimeout(() => {
      setAuthLoading(null);
      setIsAuthOpen(false);
      setShowOnboarding(true);
      setOnboardingStep('create_team');
      if (ssoType === 'domain') {
        const parsed = ssoDomain.split('@');
        const domain = parsed[parsed.length - 1];
        setTeamName(domain.split('.')[0].toUpperCase() + " Workspace");
      } else {
        setTeamName("Token Activated Team");
      }
    }, 1500);
  };

  const finalizeOnboarding = () => {
    setShowOnboarding(false);
    navigate('/chat');
  };

  const toggleAuthMode = () => {
    setAuthMode(authMode === 'login' ? 'signup' : 'login');
    setAuthError(null);
  };

  // Calculations for Sandbox
  const activeTier = activeAnalysis.tier;
  const spec = TIER_SPECS[activeTier];
  const totalTokens = activeAnalysis.metrics.tokens + 250; // Add standard completion budget

  const directCost = (totalTokens * DIRECT_MODEL.costPerMTokens) / 1000000;
  const routedCost = (totalTokens * spec.costPerMTokens) / 1000000;
  const costSavingsPercent = ((directCost - routedCost) / directCost) * 100;
  
  const directEnergy = DIRECT_MODEL.energyPerQuery;
  const routedEnergy = spec.energyPerQuery;
  const energySavedWh = directEnergy - routedEnergy;
  const carbonSavedGrams = (energySavedWh / 1000) * 380; // 380g CO2 per kWh standard grid index

  // Tangible equivalents
  const bulbHours = Math.round((energySavedWh / 9) * 10) / 10;
  const phoneCharges = Math.round((energySavedWh / 10) * 10) / 10;
  const evMeters = Math.round((energySavedWh / 200) * 1000);

  return (
    <div className="min-h-screen bg-background font-sans text-text-primary bg-grid-dots overflow-x-hidden flex flex-col relative selection:bg-primary/20">
      
      {/* Background Neon Glows */}
      <div className="absolute top-[-10%] left-[-15%] w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] mix-blend-screen pointer-events-none animate-pulse-slow"></div>
      <div className="absolute bottom-[-10%] right-[-15%] w-[700px] h-[700px] bg-secondary/10 rounded-full blur-[160px] mix-blend-screen pointer-events-none animate-pulse-slow-reverse"></div>
      
      {/* Main Container */}
      <div className="container mx-auto px-6 py-8 flex-1 flex flex-col z-10">
        
        {/* Header Navigation */}
        <header className="flex justify-between items-center mb-12">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center p-[1.5px] shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:scale-105 transition-transform">
              <div className="w-full h-full bg-surface rounded-[10px] flex items-center justify-center">
                <Compass className="w-6 h-6 text-primary" />
              </div>
            </div>
            <span className="font-bold text-xl tracking-wide bg-gradient-to-r from-text-primary to-text-secondary bg-clip-text">
              RouteGen<span className="text-primary font-semibold">AI</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-text-secondary">
            <a href="#simulator" className="hover:text-text-primary transition-colors">Simulator</a>
            <a href="#difference" className="hover:text-text-primary transition-colors">Core Difference</a>
            <a href="#efficiency" className="hover:text-text-primary transition-colors">Efficiency Metrics</a>
          </nav>

          <div className="flex items-center space-x-4">
            <button 
              onClick={() => { setAuthType('individual'); setAuthMode('login'); setIsAuthOpen(true); }}
              className="px-5 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-colors animate-fade-in"
            >
              Log in
            </button>
            <button 
              onClick={() => { setAuthType('individual'); setAuthMode('signup'); setIsAuthOpen(true); }}
              className="px-5 py-2.5 rounded-full bg-gradient-to-r from-primary to-secondary text-background font-bold text-sm hover:scale-105 hover:shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all animate-fade-in"
            >
              Get Started
            </button>
          </div>
        </header>

        {/* Hero Headline */}
        <div className="text-center max-w-4xl mx-auto mt-6 mb-16 flex flex-col items-center">
          <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold tracking-wider uppercase mb-8 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-duration-1000"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Green AI routing architecture</span>
          </div>
          
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
            Stop Querying the Frontier.<br />
            <span className="bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent bg-300% animate-gradient">
              Route Intelligently. Save 80%.
            </span>
          </h1>
          
          <p className="text-text-secondary text-base md:text-lg max-w-2xl leading-relaxed">
            Other AIs send every input to massive, power-hungry models. 
            <strong className="text-text-primary font-semibold"> RouteGen AI</strong> classifies your prompts in real-time, routing to the smallest model that fits your quality need—saving token fees, carbon emissions, and processing power.
          </p>
        </div>

        {/* Interactive Simulator Section */}
        <section id="simulator" className="w-full max-w-6xl mx-auto scroll-mt-24 mb-24">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold tracking-tight mb-2">Live Router Playground</h2>
            <p className="text-text-secondary text-sm">Type any query or select a preset to see RouteGen's routing decisions & metrics update instantly.</p>
          </div>

          {/* Preset Buttons */}
          <div className="flex flex-wrap justify-center gap-3 mb-8">
            {PRESETS.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => setInputText(preset.text)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  inputText === preset.text 
                  ? 'bg-primary/20 border-primary text-text-primary shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                  : 'bg-surface/40 border-border hover:border-text-secondary/30 text-text-secondary hover:text-text-primary'
                }`}
              >
                <span className="block text-[10px] uppercase text-primary font-bold tracking-wider mb-0.5">{preset.label}</span>
                {preset.desc}
              </button>
            ))}
          </div>

          {/* Sandbox Core Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            
            {/* Input Panel (Col 5) */}
            <div className="lg:col-span-5 flex flex-col bg-surface/40 backdrop-blur-md border border-border rounded-2xl p-6 shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-primary/50 to-secondary/30"></div>
              
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-text-secondary flex items-center gap-1.5">
                  <Cpu className="w-4 h-4 text-primary" /> Prompt Sandbox
                </span>
                <span className="text-[11px] text-text-secondary bg-surface px-2.5 py-1 rounded-md border border-border">
                  {activeAnalysis.metrics.tokens} tokens
                </span>
              </div>

              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type your AI instruction here..."
                maxLength={800}
                className="w-full flex-1 min-h-[220px] bg-background/50 border border-border/80 focus:border-primary/50 rounded-xl p-4 text-sm leading-relaxed outline-none resize-none transition-colors"
              />

              <div className="mt-4 pt-4 border-t border-border flex justify-between items-center text-xs text-text-secondary">
                <span>Try adding conditionals ("if") or keywords like "JSON"</span>
                <span>{inputText.length}/800 chars</span>
              </div>
            </div>

            {/* Visual routing flow pipeline (Col 2) */}
            <div className="lg:col-span-2 flex flex-col justify-center items-center py-4 lg:py-0">
              <div className="flex lg:flex-col items-center justify-between w-full h-full max-h-[300px] lg:max-h-full px-8 lg:px-0">
                <div className="flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center font-bold text-xs text-primary shadow-inner">
                    IN
                  </div>
                  <span className="text-[10px] text-text-secondary uppercase font-bold tracking-wider mt-1">Prompt</span>
                </div>

                {/* Vertical/Horizontal Arrow Path */}
                <div className="flex-1 flex lg:flex-col items-center justify-center relative w-full h-12 lg:h-full py-2">
                  <svg className="w-12 h-8 lg:w-8 lg:h-full" viewBox="0 0 24 100" preserveAspectRatio="none">
                    <line x1="12" y1="0" x2="12" y2="100" stroke="#27272a" strokeWidth="2" />
                    <line 
                      x1="12" 
                      y1="0" 
                      x2="12" 
                      y2="100" 
                      stroke="url(#beamGrad)" 
                      strokeWidth="2.5" 
                      className="animate-beam" 
                    />
                    <defs>
                      <linearGradient id="beamGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#06b6d4" stopOpacity="0" />
                        <stop offset="50%" stopColor="#a855f7" stopOpacity="1" />
                        <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>

                <div className="flex flex-col items-center">
                  <div className={`w-14 h-14 rounded-2xl bg-surface border flex flex-col items-center justify-center font-bold shadow-lg transition-all duration-300 ${
                    isTyping ? 'border-primary scale-110 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'border-border'
                  }`}>
                    <Activity className={`w-6 h-6 text-secondary ${isTyping ? 'animate-pulse' : ''}`} />
                  </div>
                  <span className="text-[10px] text-text-secondary uppercase font-bold tracking-wider mt-1 text-center">Router</span>
                </div>
              </div>
            </div>

            {/* Dashboard details (Col 5) */}
            <div className="lg:col-span-5 flex flex-col space-y-6">
              
              {/* Routed Output Tier Spec */}
              <div className="bg-surface/40 backdrop-blur-md border border-border rounded-2xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between">
                <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${spec.color} opacity-[0.08] blur-xl pointer-events-none`}></div>
                
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <span className="text-[10px] uppercase font-extrabold text-primary tracking-widest block mb-0.5">Route Selection</span>
                      <h3 className="text-xl font-extrabold text-text-primary tracking-tight">{spec.name}</h3>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r ${spec.color} text-background`}>
                      Score: {activeAnalysis.score} / 10
                    </span>
                  </div>

                  <p className="text-text-secondary text-sm leading-relaxed mb-4">{spec.description}</p>
                  
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border/60">
                    <div>
                      <span className="text-[10px] uppercase text-text-secondary block font-semibold mb-0.5">Assigned Engine</span>
                      <span className="text-sm font-bold text-text-primary flex items-center gap-1.5">
                        <Cpu className="w-4 h-4 text-secondary" /> {spec.model}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-text-secondary block font-semibold mb-0.5">Primary Intent</span>
                      <span className="text-xs text-text-primary font-medium line-clamp-1">{spec.useCase}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Dynamic Cost Savings Comparison */}
              <div className="bg-surface/40 backdrop-blur-md border border-border rounded-2xl p-6 shadow-xl flex flex-col justify-between">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-text-secondary flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-primary" /> Financial Metrics
                  </span>
                  <span className="text-[11px] font-bold text-success bg-success/10 border border-success/20 px-2 py-0.5 rounded">
                    Save {costSavingsPercent.toFixed(1)}%
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-background/40 p-4 rounded-xl border border-border/50">
                    <span className="text-[10px] font-semibold text-text-secondary block mb-1 uppercase">Direct Frontier AI</span>
                    <span className="text-lg font-bold text-text-secondary block">${directCost.toFixed(6)}</span>
                    <span className="text-[10px] text-text-secondary block mt-0.5">$15.00 / M tokens</span>
                  </div>
                  
                  <div className="bg-background/40 p-4 rounded-xl border border-primary/20 shadow-[0_0_15px_rgba(6,182,212,0.05)] relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-2 h-full bg-primary/20"></div>
                    <span className="text-[10px] font-bold text-primary block mb-1 uppercase">Routed AI</span>
                    <span className="text-lg font-bold text-primary block">${routedCost.toFixed(6)}</span>
                    <span className="text-[10px] text-text-secondary block mt-0.5">${spec.costPerMTokens.toFixed(2)} / M tokens</span>
                  </div>
                </div>
              </div>

            </div>

          </div>
        </section>

        {/* Why is this AI Different section */}
        <section id="difference" className="w-full max-w-6xl mx-auto scroll-mt-24 mb-24">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-extrabold tracking-tight mb-4">How RouteGen AI Differs From Other AIs</h2>
            <p className="text-text-secondary text-sm md:text-base leading-relaxed">
              Standard AI wrapper apps query a massive, expensive LLM for everything. RouteGen acts as a smart middleware router that measures prompt complexity on 5 cognitive vectors to find the most efficient fit.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            
            {/* Feature 1 */}
            <div className="bg-surface/30 border border-border hover:border-primary/30 rounded-2xl p-6 transition-all hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
                <BrainCircuit className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-bold mb-2">Cognitive Feature Scoring</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Rather than checking keywords, our classifier extracts features like technical depth ratio, logical negatives, output formatting, and prompt length before matching.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-surface/30 border border-border hover:border-primary/30 rounded-2xl p-6 transition-all hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center mb-6">
                <Scale className="w-6 h-6 text-secondary" />
              </div>
              <h3 className="text-lg font-bold mb-2">Multi-Tier Redundancy</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Supports Llama 3 8B, Gemini 1.5 Pro, and Reasoning instances dynamically. Escalar fallback routes ensure that if a smaller model output fails assertions, it auto-escalates.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-surface/30 border border-border hover:border-primary/30 rounded-2xl p-6 transition-all hover:-translate-y-1">
              <div className="w-12 h-12 rounded-xl bg-success/10 border border-success/20 flex items-center justify-center mb-6">
                <Leaf className="w-6 h-6 text-success" />
              </div>
              <h3 className="text-lg font-bold mb-2">Green Energy Optimization</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Reduces massive electricity requirements of heavy inference clusters by moving simple, everyday workloads to energy-efficient models.
              </p>
            </div>

          </div>

          {/* Visual vector display bar */}
          <div className="mt-16 bg-surface/20 border border-border rounded-2xl p-8 relative overflow-hidden">
            <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" /> Current Query Cognitive Breakdown
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-6">
              {[
                { label: "Token Length", val: activeAnalysis.breakdown.length, desc: "Total token volume" },
                { label: "Ambiguity Score", val: activeAnalysis.breakdown.ambiguity, desc: "Questions & uncertainty" },
                { label: "Domain Depth", val: activeAnalysis.breakdown.domain, desc: "Technical terminology ratio" },
                { label: "Formatting Needs", val: activeAnalysis.breakdown.format, desc: "JSON/Code syntax required" },
                { label: "Reasoning Weight", val: activeAnalysis.breakdown.reasoning, desc: "Negations & conditionals" }
              ].map((item, idx) => (
                <div key={idx} className="bg-background/40 p-4 rounded-xl border border-border">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[11px] font-semibold text-text-secondary uppercase">{item.label}</span>
                    <span className="text-xs font-bold text-primary">{item.val}/10</span>
                  </div>
                  <div className="w-full bg-surface h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-primary h-full rounded-full transition-all duration-300"
                      style={{ width: `${item.val * 10}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-text-secondary block mt-2 leading-tight">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Green power efficiency analytics section */}
        <section id="efficiency" className="w-full max-w-6xl mx-auto scroll-mt-24 mb-24">
          <div className="bg-gradient-to-br from-surface/80 to-background border border-border rounded-3xl p-8 md:p-12 relative overflow-hidden">
            
            {/* Background elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-success/5 rounded-full blur-[100px] pointer-events-none"></div>
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              
              <div className="lg:col-span-7 space-y-6">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-success bg-success/10 border border-success/20 px-3 py-1 rounded-full">
                  <Leaf className="w-4 h-4" /> Eco-computational Impact
                </span>
                
                <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
                  Computing Shouldn't Cost the Planet.
                </h2>
                
                <p className="text-text-secondary text-sm md:text-base leading-relaxed">
                  Frontier LLMs consume significant energy due to their massive parameter scale. Running simple text transformations on trillion-parameter nodes is like driving a heavy commercial semi-truck to buy milk. RouteGen maps tasks to lightweight clusters, creating major carbon offset dividends.
                </p>

                <div className="grid grid-cols-3 gap-4 pt-4">
                  <div className="bg-background/60 p-4 rounded-2xl border border-border flex flex-col justify-between">
                    <span className="text-[10px] uppercase font-bold text-text-secondary block mb-2">Energy Reduced</span>
                    <div>
                      <span className="text-2xl font-black text-success block">{(energySavedWh).toFixed(1)}</span>
                      <span className="text-xs text-text-secondary font-medium">Watt-hours (Wh)</span>
                    </div>
                  </div>

                  <div className="bg-background/60 p-4 rounded-2xl border border-border flex flex-col justify-between">
                    <span className="text-[10px] uppercase font-bold text-text-secondary block mb-2">CO2 Diverted</span>
                    <div>
                      <span className="text-2xl font-black text-success block">{(carbonSavedGrams).toFixed(1)}</span>
                      <span className="text-xs text-text-secondary font-medium">grams CO2</span>
                    </div>
                  </div>

                  <div className="bg-background/60 p-4 rounded-2xl border border-border flex flex-col justify-between">
                    <span className="text-[10px] uppercase font-bold text-text-secondary block mb-2">Power Efficiency</span>
                    <div>
                      <span className="text-2xl font-black text-success block">{(directEnergy / routedEnergy).toFixed(1)}x</span>
                      <span className="text-xs text-text-secondary font-medium">more efficient</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Equivalence Visual Board */}
              <div className="lg:col-span-5 bg-background/50 border border-border rounded-2xl p-6 flex flex-col justify-between space-y-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-text-secondary pb-3 border-b border-border/80">
                  Green Equivalence Values
                </h3>
                
                <div className="space-y-5">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
                      <Lightbulb className="w-5 h-5 text-yellow-500" />
                    </div>
                    <div>
                      <span className="text-xs text-text-secondary block leading-none mb-1">LED Lightbulb Duration</span>
                      <span className="text-sm font-bold text-text-primary">Keep a 9W LED bulb on for <span className="text-success">{bulbHours} hours</span></span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                      <Smartphone className="w-5 h-5 text-blue-500" />
                    </div>
                    <div>
                      <span className="text-xs text-text-secondary block leading-none mb-1">Smartphone Charges</span>
                      <span className="text-sm font-bold text-text-primary">Charge a dead battery <span className="text-success">{phoneCharges} times</span></span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <Car className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div>
                      <span className="text-xs text-text-secondary block leading-none mb-1">EV Driving Equivalent</span>
                      <span className="text-sm font-bold text-text-primary">Drive an electric vehicle <span className="text-success">{evMeters} meters</span></span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 text-[10px] text-text-secondary text-center italic">
                  Calculated based on average 380g CO2 per kWh grid capacity metrics.
                </div>

              </div>

            </div>

          </div>
        </section>

        {/* Action comparison table */}
        <section className="w-full max-w-6xl mx-auto mb-24">
          <h2 className="text-2xl font-bold tracking-tight mb-8 text-center">Approach Feature Matrix</h2>
          
          <div className="overflow-x-auto border border-border rounded-2xl bg-surface/10 backdrop-blur-md">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface/30">
                  <th className="p-4 text-xs font-bold text-text-secondary uppercase">Capabilities</th>
                  <th className="p-4 text-xs font-bold text-text-secondary uppercase">Direct Single LLM</th>
                  <th className="p-4 text-xs font-bold text-primary uppercase">RouteGen AI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 text-sm">
                <tr>
                  <td className="p-4 font-semibold text-text-primary">Inference Cost structure</td>
                  <td className="p-4 text-text-secondary">Fixed expensive rate ($15.00 / M)</td>
                  <td className="p-4 text-success font-medium">Dynamic, down to $0.15 / M tokens</td>
                </tr>
                <tr>
                  <td className="p-4 font-semibold text-text-primary">Typical execution latency</td>
                  <td className="p-4 text-text-secondary">High overhead (~1500ms) for trivial requests</td>
                  <td className="p-4 text-success font-medium">Sub-200ms routing for low-tier tasks</td>
                </tr>
                <tr>
                  <td className="p-4 font-semibold text-text-primary">Carbon and energy footprint</td>
                  <td className="p-4 text-text-secondary">Heavy (145 Wh per query)</td>
                  <td className="p-4 text-success font-medium">Highly optimized (1.2 Wh to 38 Wh)</td>
                </tr>
                <tr>
                  <td className="p-4 font-semibold text-text-primary">Reliability & Fallbacks</td>
                  <td className="p-4 text-text-secondary">Prone to downtime or direct token timeouts</td>
                  <td className="p-4 text-success font-medium">Automatic fallback escalation on assertion fail</td>
                </tr>
                <tr>
                  <td className="p-4 font-semibold text-text-primary">Routing Transparency</td>
                  <td className="p-4 text-text-secondary">Zero observability inside prompts</td>
                  <td className="p-4 text-success font-medium">Full Langfuse traceability per step</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-auto py-8 border-t border-border flex flex-col md:flex-row justify-between items-center text-xs text-text-secondary">
          <span>&copy; {new Date().getFullYear()} RouteGen AI. Built for Intelligent Model Routing.</span>
          <div className="flex space-x-6 mt-4 md:mt-0">
            <span className="cursor-pointer hover:text-text-primary">Privacy Policy</span>
            <span className="cursor-pointer hover:text-text-primary">Terms of Service</span>
            <span className="cursor-pointer hover:text-text-primary">Langfuse Observability Docs</span>
          </div>
        </footer>

      </div>

      {/* Centered Modal Overlay (Auth & Onboarding) */}
      <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${
        isAuthOpen || showOnboarding ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}>
        
        {/* Backdrop Overlay */}
        <div 
          onClick={() => {
            // Prevent clicking outside from closing during critical onboarding
            if (!showOnboarding) {
              setIsAuthOpen(false);
            }
          }}
          className="absolute inset-0 bg-[#000]/70 backdrop-blur-md transition-opacity" 
        />
        
        {/* Centered Auth Card Modal */}
        {isAuthOpen && (
          <div className="bg-[#09090b]/95 border border-border w-full max-w-lg rounded-2xl shadow-2xl relative z-10 p-8 flex flex-col transition-all duration-300 transform scale-100 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
              <span className="text-xs font-bold uppercase tracking-widest text-text-secondary">
                {authMode === 'login' ? 'Authentication' : 'Registration'}
              </span>
              <button 
                onClick={() => setIsAuthOpen(false)}
                className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-center mb-6">
              <h2 className="text-2xl font-black tracking-tight mb-2">
                {authMode === 'login' ? 'Log in to RouteGen' : 'Get Started'}
              </h2>
              <p className="text-text-secondary text-xs">
                {authMode === 'login' 
                  ? 'Access your saved workspaces, routing analytics, and dashboard metrics.' 
                  : 'Start optimizing model expenses in minutes. Create a sandbox.'}
              </p>
            </div>

            {/* Dual Tabs (Developer vs Enterprise SSO) */}
            <div className="flex bg-surface/50 border border-border p-1 rounded-xl mb-6">
              <button
                onClick={() => { setAuthType('individual'); setAuthError(null); }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                  authType === 'individual'
                  ? 'bg-primary text-background shadow-md font-extrabold'
                  : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Individual Developer
              </button>
              <button
                onClick={() => { setAuthType('enterprise'); setAuthError(null); }}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                  authType === 'enterprise'
                  ? 'bg-primary text-background shadow-md font-extrabold'
                  : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Enterprise Team SSO
              </button>
            </div>

            {/* Error Banner */}
            {authError && (
              <div className="mb-4 p-4 bg-danger/10 border border-danger/20 rounded-xl flex items-start space-x-3 text-danger">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">{authError}</p>
              </div>
            )}

            {/* TAB CONTENT: INDIVIDUAL DEVELOPER */}
            {authType === 'individual' ? (
              <div className="space-y-4">
                {/* OAuth Actions */}
                <div className="flex space-x-4">
                  <button 
                    onClick={() => handleOAuth('google')}
                    disabled={!!authLoading}
                    className="flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl border border-border bg-[#121214]/50 hover:bg-[#1f1f22]/50 transition-colors text-xs font-semibold disabled:opacity-50"
                  >
                    {authLoading === 'google' ? (
                      <Loader2 className="w-4 h-4 animate-spin text-text-primary" />
                    ) : (
                      <svg className="w-4.5 h-4.5" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                    )}
                    <span>Google</span>
                  </button>

                  <button 
                    onClick={() => handleOAuth('github')}
                    disabled={!!authLoading}
                    className="flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl border border-border bg-[#121214]/50 hover:bg-[#1f1f22]/50 transition-colors text-xs font-semibold disabled:opacity-50"
                  >
                    {authLoading === 'github' ? (
                      <Loader2 className="w-4 h-4 animate-spin text-text-primary" />
                    ) : (
                      <svg className="w-4.5 h-4.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                      </svg>
                    )}
                    <span>GitHub</span>
                  </button>
                </div>

                {/* GitHub Organizations Auto-Import Checkbox */}
                <div className="p-3 bg-surface/30 border border-border rounded-xl flex items-start space-x-3">
                  <input
                    type="checkbox"
                    id="import-github-orgs"
                    checked={autoImportGithub}
                    onChange={(e) => setAutoImportGithub(e.target.checked)}
                    className="mt-0.5 rounded border-border text-primary focus:ring-primary w-4 h-4 bg-background"
                  />
                  <label htmlFor="import-github-orgs" className="text-[11px] text-text-secondary leading-tight cursor-pointer">
                    <span className="text-text-primary font-bold block mb-0.5">Auto-import GitHub Organizations</span>
                    If signed in via GitHub, our system will check your GitHub teams and automatically create a shared routing workspace for them.
                  </label>
                </div>

                {/* Separator Divider */}
                <div className="flex items-center space-x-3 my-2">
                  <div className="flex-1 h-px bg-border/50"></div>
                  <span className="text-[10px] text-text-secondary uppercase tracking-wider font-semibold">Or use email</span>
                  <div className="flex-1 h-px bg-border/50"></div>
                </div>

                {/* Form Fields */}
                <form onSubmit={handleEmailAuth} className="space-y-4">
                  {authMode === 'signup' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-text-secondary">First Name</label>
                        <input 
                          type="text" 
                          placeholder="Jane"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          disabled={!!authLoading}
                          className="w-full bg-[#121214] border border-border/80 focus:border-primary/50 rounded-xl px-3.5 py-2.5 text-xs outline-none transition-colors"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-text-secondary">Last Name</label>
                        <input 
                          type="text" 
                          placeholder="Doe"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          disabled={!!authLoading}
                          className="w-full bg-[#121214] border border-border/80 focus:border-primary/50 rounded-xl px-3.5 py-2.5 text-xs outline-none transition-colors"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary">Email Address</label>
                    <input 
                      type="email" 
                      placeholder="jane.doe@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={!!authLoading}
                      className="w-full bg-[#121214] border border-border/80 focus:border-primary/50 rounded-xl px-3.5 py-2.5 text-xs outline-none transition-colors"
                    />
                  </div>

                  <div className="space-y-1 relative">
                    <label className="text-[10px] uppercase font-bold text-text-secondary">Password</label>
                    <div className="relative">
                      <input 
                        type={showPassword ? "text" : "password"} 
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={!!authLoading}
                        className="w-full bg-[#121214] border border-border/80 focus:border-primary/50 rounded-xl pl-3.5 pr-10 py-2.5 text-xs outline-none transition-colors"
                      />
                      <button 
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button 
                    type="submit"
                    disabled={!!authLoading}
                    className="w-full py-3 mt-4 rounded-xl bg-gradient-to-r from-primary to-secondary text-background font-bold text-sm hover:scale-[1.02] transition-transform flex items-center justify-center space-x-2 disabled:opacity-50"
                  >
                    {authLoading === 'email' ? (
                      <Loader2 className="w-4 h-4 animate-spin text-background" />
                    ) : (
                      <span>{authMode === 'login' ? 'Log in with Email' : 'Register Account'}</span>
                    )}
                  </button>
                </form>

                {/* Toggle Footer link */}
                <div className="mt-4 text-center">
                  <button 
                    type="button" 
                    onClick={toggleAuthMode}
                    className="text-xs font-semibold text-primary hover:underline hover:text-primary-hover"
                  >
                    {authMode === 'login' ? "Don't have an account? Sign Up" : 'Already have an account? Log In'}
                  </button>
                </div>
              </div>
            ) : (
              /* TAB CONTENT: ENTERPRISE TEAM SSO */
              <div className="space-y-4">
                
                {/* SSO Toggle Sub-tabs */}
                <div className="flex space-x-2 bg-surface/30 p-1 rounded-xl border border-border/85">
                  <button
                    onClick={() => { setSsoType('domain'); setAuthError(null); }}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-colors ${
                      ssoType === 'domain'
                      ? 'bg-surface text-text-primary shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Corporate Domain
                  </button>
                  <button
                    onClick={() => { setSsoType('token'); setAuthError(null); }}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-colors ${
                      ssoType === 'token'
                      ? 'bg-surface text-text-primary shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Team SSO Token
                  </button>
                </div>

                <form onSubmit={handleSSOAuth} className="space-y-4 pt-2">
                  {ssoType === 'domain' ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-text-secondary leading-normal">
                        Enter your corporate email. We will automatically resolve your enterprise Single Sign-On (SAML 2.0 / OIDC) login gateway.
                      </p>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-text-secondary">Corporate Email / Domain</label>
                        <input 
                          type="text" 
                          placeholder="e.g. employee@neuralnexus.com"
                          value={ssoDomain}
                          onChange={(e) => setSsoDomain(e.target.value)}
                          disabled={authLoading === 'sso'}
                          className="w-full bg-[#121214] border border-border focus:border-primary/50 rounded-xl px-3.5 py-2.5 text-xs outline-none transition-colors"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px] text-text-secondary leading-normal">
                        Enter the secret SSO reference token generated by your organization's workspace administrator.
                      </p>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-text-secondary">Team SSO Token</label>
                        <input 
                          type="text" 
                          placeholder="e.g. rg_team_12345678"
                          value={ssoToken}
                          onChange={(e) => setSsoToken(e.target.value)}
                          disabled={authLoading === 'sso'}
                          className="w-full bg-[#121214] border border-border focus:border-primary/50 rounded-xl px-3.5 py-2.5 text-xs outline-none transition-colors"
                        />
                      </div>
                    </div>
                  )}

                  <button 
                    type="submit"
                    disabled={authLoading === 'sso'}
                    className="w-full py-3 mt-4 rounded-xl bg-gradient-to-r from-primary to-secondary text-background font-bold text-sm hover:scale-[1.02] transition-transform flex items-center justify-center space-x-2 disabled:opacity-50"
                  >
                    {authLoading === 'sso' ? (
                      <Loader2 className="w-4 h-4 animate-spin text-background" />
                    ) : (
                      <>
                        <Lock className="w-4 h-4 text-background" />
                        <span>{ssoType === 'domain' ? 'Authenticate via Domain SSO' : 'Join using SSO Token'}</span>
                      </>
                    )}
                  </button>
                </form>

                <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl flex items-start space-x-3 text-xs text-text-secondary leading-normal">
                  <CheckCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <span>
                    Supported IdPs: Okta, Microsoft Entra ID (Azure AD), Google Workspace SAML, Ping Identity, and custom Auth0 tokens.
                  </span>
                </div>

              </div>
            )}
          </div>
        )}

        {/* Centered Post-Login Onboarding Modal (Workspace Setup / Org Association Check) */}
        {showOnboarding && (
          <div className="bg-[#09090b]/95 border border-border w-full max-w-lg rounded-2xl shadow-2xl relative z-10 p-8 flex flex-col transition-all duration-300 scale-100 max-h-[90vh]">
            
            {onboardingStep === 'github_imported' ? (
              /* MOCK ONBOARDING: GITHUB ORG AUTO-IMPORTED SUCCESS */
              <div className="text-center space-y-6">
                <div className="w-14 h-14 rounded-full bg-success/15 border border-success/30 flex items-center justify-center mx-auto text-success">
                  <CheckCircle className="w-8 h-8" />
                </div>
                
                <div>
                  <span className="text-[10px] uppercase font-bold text-primary tracking-widest block mb-1">SSO Connection Complete</span>
                  <h2 className="text-2xl font-black text-text-primary tracking-tight">GitHub Organizations Discovered</h2>
                  <p className="text-text-secondary text-xs mt-2 leading-relaxed max-w-md mx-auto">
                    We inspected your GitHub profile teams and automatically initialized workspaces to trace cost efficiency and fallback assertions.
                  </p>
                </div>

                <div className="bg-surface/30 border border-border rounded-2xl p-4 text-left divide-y divide-border/60">
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-xs font-bold text-text-primary flex items-center gap-2">
                      <svg className="w-4 h-4 text-secondary" viewBox="0 0 24 24" fill="currentColor">
                        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                      </svg>
                      neural-nexus
                    </span>
                    <span className="text-[10px] font-bold text-success bg-success/10 border border-success/20 px-2 py-0.5 rounded">
                      Workspace Auto-Created
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-xs font-bold text-text-primary flex items-center gap-2">
                      <svg className="w-4 h-4 text-secondary" viewBox="0 0 24 24" fill="currentColor">
                        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                      </svg>
                      hackindia-org
                    </span>
                    <span className="text-[10px] font-bold text-success bg-success/10 border border-success/20 px-2 py-0.5 rounded">
                      Workspace Auto-Created
                    </span>
                  </div>
                </div>

                <button 
                  onClick={finalizeOnboarding}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-background font-bold text-sm hover:scale-[1.02] transition-transform flex items-center justify-center space-x-2"
                >
                  <span>Enter Dashboard Workspace</span>
                  <ArrowRight className="w-4.5 h-4.5 text-background" />
                </button>
              </div>
            ) : (
              /* MOCK ONBOARDING: ASSOCIATE ORG ALERT & WORKSPACE CREATION */
              <div className="space-y-6 text-center">
                <div className="w-14 h-14 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto text-primary">
                  <Users className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                  <span className="text-[10px] uppercase font-bold text-primary tracking-widest block">Profile Scan</span>
                  <h2 className="text-2xl font-black text-text-primary tracking-tight">Account Check</h2>
                  
                  {/* Alert Banner matches user request */}
                  <div className="mt-4 p-4 bg-primary/10 border border-primary/20 rounded-xl text-left text-xs text-text-primary leading-normal flex items-start space-x-3">
                    <AlertCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <span>
                      Create a new team workspace to track your LangGraph models.
                    </span>
                  </div>
                </div>

                <div className="space-y-4 text-left pt-2">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-text-secondary pl-1">Workspace Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Neural Nexus Development"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      className="w-full bg-[#121214] border border-border focus:border-primary/50 rounded-xl px-3.5 py-2.5 text-xs outline-none transition-colors"
                    />
                  </div>
                  
                  <div className="p-3 bg-surface/40 border border-border rounded-xl text-[11px] text-text-secondary leading-normal flex items-start space-x-2.5">
                    <input type="checkbox" defaultChecked className="mt-0.5 rounded border-border text-primary focus:ring-primary w-4 h-4 bg-background" />
                    <span>Associate corporate domain to block public domain registration.</span>
                  </div>
                </div>

                <div className="flex space-x-4 pt-2">
                  <button 
                    onClick={finalizeOnboarding}
                    className="flex-1 py-3 rounded-xl border border-border hover:bg-surface/50 text-text-secondary hover:text-text-primary transition-colors text-xs font-semibold"
                  >
                    Skip For Now
                  </button>
                  <button 
                    onClick={finalizeOnboarding}
                    disabled={!teamName.trim()}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-background font-bold text-xs hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Create Workspace
                  </button>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

    </div>
  );
};

export default LandingPage;
