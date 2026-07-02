import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, Zap, Scale, BrainCircuit, ChevronRight } from 'lucide-react';

const LandingPage = () => {
  const navigate = useNavigate();

  const handleLogin = () => {
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-background font-sans text-text-primary overflow-hidden flex flex-col relative selection:bg-primary/20">
      
      {/* Background Glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] mix-blend-screen pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-secondary/15 rounded-full blur-[150px] mix-blend-screen pointer-events-none"></div>
      
      <div className="container mx-auto px-6 py-12 flex-1 flex flex-col z-10">
        
        {/* Header */}
        <header className="flex justify-between items-center mb-16">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center p-[1.5px] shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <div className="w-full h-full bg-surface rounded-[10px] flex items-center justify-center">
                <Compass className="w-6 h-6 text-primary" />
              </div>
            </div>
            <span className="font-bold text-xl tracking-wide">RouteGen<span className="text-primary font-normal"> AI</span></span>
          </div>
          <button 
            onClick={handleLogin}
            className="px-6 py-2 rounded-full border border-border hover:border-primary/50 text-sm font-medium transition-colors hover:bg-surface"
          >
            Sign In
          </button>
        </header>

        {/* Hero Section */}
        <div className="flex flex-col items-center text-center max-w-4xl mx-auto mt-10 md:mt-20">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold uppercase tracking-wider mb-8">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <span>Intelligent LLM Routing</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8 leading-tight">
            The Right Model. <br className="hidden md:block"/>
            <span className="bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-transparent bg-300% animate-gradient">
              Every Single Time.
            </span>
          </h1>
          
          <p className="text-text-secondary text-lg md:text-xl max-w-2xl mb-12 leading-relaxed">
            Stop overpaying for simple queries. RouteGen AI analyzes prompt complexity in real-time and routes it to the most cost-effective tier—Small, Large, or Reasoning—saving up to 80% on inference costs without sacrificing quality.
          </p>

          <button 
            onClick={handleLogin}
            className="group relative flex items-center justify-center space-x-3 bg-text-primary text-background px-8 py-4 rounded-full font-bold text-lg hover:scale-105 transition-all shadow-[0_0_30px_rgba(255,255,255,0.15)] hover:shadow-[0_0_40px_rgba(255,255,255,0.25)]"
          >
            <svg className="w-5 h-5 text-background" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            <span>Sign in with Google</span>
          </button>
        </div>

        {/* 3-Step Visual */}
        <div className="mt-32 max-w-5xl mx-auto w-full mb-20">
          <h2 className="text-center text-sm font-bold text-text-secondary uppercase tracking-widest mb-12">How Dynamic Routing Works</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            {/* Connecting lines for desktop */}
            <div className="hidden md:block absolute top-1/2 left-[15%] right-[15%] h-[2px] bg-gradient-to-r from-primary/0 via-primary/30 to-secondary/0 -translate-y-1/2 z-0"></div>
            
            <div className="bg-surface/60 backdrop-blur-md border border-border rounded-2xl p-6 relative z-10 shadow-lg hover:border-primary/50 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-2">1. Small Tier</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Simple factual queries and summarizations are instantly routed to blazing-fast models like LLaMA 3 8B, practically eliminating cost.
              </p>
            </div>

            <div className="bg-surface/60 backdrop-blur-md border border-border rounded-2xl p-6 relative z-10 shadow-lg hover:border-primary/50 transition-colors md:-translate-y-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                <Scale className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-2">2. Large Tier</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Standard logic and coding tasks are seamlessly handled by balanced models like Gemini 1.5 Pro, offering the perfect cost-to-quality ratio.
              </p>
            </div>

            <div className="bg-surface/60 backdrop-blur-md border border-border rounded-2xl p-6 relative z-10 shadow-lg hover:border-secondary/50 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-secondary/10 flex items-center justify-center mb-6">
                <BrainCircuit className="w-6 h-6 text-secondary" />
              </div>
              <h3 className="text-xl font-bold mb-2">3. Reasoning Tier</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Highly complex architectures and critical analysis prompts are escalated to heavyweights like LLaMA 3 70B for maximum accuracy.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default LandingPage;
