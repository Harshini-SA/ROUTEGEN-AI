import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { EyeOff, Eye, Loader2, AlertCircle } from 'lucide-react';

const AuthPage = () => {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [isLogin, setIsLogin] = useState(false);
  
  // Form State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Feedback State
  const [error, setError] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<'google' | 'github' | 'email' | null>(null);

  const validateForm = () => {
    setError(null);
    if (!email || !password) {
      setError("Email and Password are required.");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Invalid email format.");
      return false;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return false;
    }
    if (!isLogin && (!firstName.trim() || !lastName.trim())) {
      setError("First and Last Name are required for sign up.");
      return false;
    }
    return true;
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setLoadingProvider('email');
    setError(null);

    try {
      if (isLogin) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (signInError) throw signInError;
        navigate('/chat');
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
        // Depending on Supabase settings, email confirmation might be required
        navigate('/chat');
      }
    } catch (err: any) {
      setError(err.message || "An error occurred during authentication.");
    } finally {
      setLoadingProvider(null);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setLoadingProvider(provider);
    setError(null);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin + '/chat'
        }
      });
      if (oauthError) throw oauthError;
    } catch (err: any) {
      setError(err.message || `Failed to authenticate with ${provider}.`);
      setLoadingProvider(null);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-[#050505] text-white font-sans selection:bg-primary/20">
      
      {/* Left Pane: Visuals */}
      <div className="hidden lg:flex w-1/2 relative flex-col justify-between p-12 overflow-hidden">
        {/* Deep Green Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0c2f21] via-[#081e15] to-[#040c08] z-0"></div>
        <div className="absolute top-[20%] left-[-10%] w-[500px] h-[500px] bg-[#10b981]/20 rounded-full blur-[150px] mix-blend-screen pointer-events-none z-0"></div>
        
        {/* Content Top */}
        <div className="relative z-10 mt-20 max-w-md">
          <h1 className="text-5xl font-semibold mb-6 leading-tight">
            Get Started<br/>with Us
          </h1>
          <p className="text-gray-400 text-lg">
            Complete these easy steps to register your account.
          </p>
        </div>

        {/* Content Bottom: Stepper */}
        <div className="relative z-10 flex space-x-4 w-full">
          {/* Step 1 (Active) */}
          <div className="flex-1 bg-white text-black p-6 rounded-2xl flex flex-col justify-between shadow-xl transform transition-transform hover:-translate-y-1">
            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold mb-8">
              1
            </div>
            <p className="font-semibold text-lg leading-tight">Sign up your<br/>account</p>
          </div>

          {/* Step 2 (Inactive) */}
          <div className="flex-1 bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-2xl flex flex-col justify-between text-white/50 transition-colors">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold mb-8">
              2
            </div>
            <p className="font-semibold text-lg leading-tight">Set up your<br/>workspace</p>
          </div>

          {/* Step 3 (Inactive) */}
          <div className="flex-1 bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-2xl flex flex-col justify-between text-white/50 transition-colors">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold mb-8">
              3
            </div>
            <p className="font-semibold text-lg leading-tight">Set up your<br/>profile</p>
          </div>
        </div>
      </div>

      {/* Right Pane: Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 lg:p-12 relative z-10">
        <div className="w-full max-w-md">
          
          <div className="text-center mb-8">
            <h2 className="text-3xl font-semibold mb-3">
              {isLogin ? 'Welcome Back' : 'Sign Up Account'}
            </h2>
            <p className="text-gray-400 text-sm">
              {isLogin ? 'Enter your details to access your account.' : 'Enter your personal data to create your account.'}
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-6 p-4 bg-danger/10 border border-danger/20 rounded-xl flex items-start space-x-3 text-danger">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm leading-relaxed">{error}</p>
            </div>
          )}

          {/* OAuth Providers */}
          <div className="flex space-x-4 mb-8">
            <button 
              onClick={() => handleOAuth('google')}
              disabled={!!loadingProvider}
              className="flex-1 flex items-center justify-center space-x-2 py-3 px-4 rounded-xl border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingProvider === 'google' ? (
                <Loader2 className="w-5 h-5 animate-spin text-white" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              <span className="text-sm font-medium">Google</span>
            </button>

            <button 
              onClick={() => handleOAuth('github')}
              disabled={!!loadingProvider}
              className="flex-1 flex items-center justify-center space-x-2 py-3 px-4 rounded-xl border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingProvider === 'github' ? (
                <Loader2 className="w-5 h-5 animate-spin text-white" />
              ) : (
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                </svg>
              )}
              <span className="text-sm font-medium">Github</span>
            </button>
          </div>

          <div className="flex items-center space-x-4 mb-8">
            <div className="flex-1 h-px bg-white/10"></div>
            <span className="text-gray-500 text-xs uppercase tracking-widest">Or</span>
            <div className="flex-1 h-px bg-white/10"></div>
          </div>

          {/* Form */}
          <form className="space-y-5" onSubmit={handleEmailAuth}>
            
            {!isLogin && (
              <div className="flex space-x-4">
                <div className="flex-1 space-y-1.5">
                  <label className="text-xs text-gray-400 pl-1">First Name</label>
                  <input 
                    type="text" 
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="e.g. John" 
                    disabled={!!loadingProvider}
                    className="w-full bg-[#161616] border border-transparent focus:border-white/20 rounded-xl px-4 py-3 text-sm outline-none transition-colors disabled:opacity-50"
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <label className="text-xs text-gray-400 pl-1">Last Name</label>
                  <input 
                    type="text" 
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="e.g. Francisco" 
                    disabled={!!loadingProvider}
                    className="w-full bg-[#161616] border border-transparent focus:border-white/20 rounded-xl px-4 py-3 text-sm outline-none transition-colors disabled:opacity-50"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 pl-1">Email</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. johnfrans@gmail.com" 
                disabled={!!loadingProvider}
                className="w-full bg-[#161616] border border-transparent focus:border-white/20 rounded-xl px-4 py-3 text-sm outline-none transition-colors disabled:opacity-50"
              />
            </div>

            <div className="space-y-1.5 relative">
              <label className="text-xs text-gray-400 pl-1">Password</label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"} 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password" 
                  disabled={!!loadingProvider}
                  className="w-full bg-[#161616] border border-transparent focus:border-white/20 rounded-xl px-4 py-3 text-sm outline-none transition-colors pr-10 disabled:opacity-50"
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={!!loadingProvider}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
                >
                  {showPassword ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
              {!isLogin && (
                <p className="text-xs text-gray-500 pl-1 pt-1">Must be at least 8 characters.</p>
              )}
            </div>

            <button 
              type="submit"
              disabled={!!loadingProvider}
              className="w-full bg-white text-black font-semibold rounded-xl py-3 mt-6 hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              {loadingProvider === 'email' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{isLogin ? 'Logging In...' : 'Signing Up...'}</span>
                </>
              ) : (
                <span>{isLogin ? 'Log In' : 'Sign Up'}</span>
              )}
            </button>
          </form>

          {/* Footer toggle */}
          <div className="mt-8 text-center text-sm text-gray-400">
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <button 
              onClick={() => {
                setIsLogin(!isLogin);
                setError(null);
              }}
              disabled={!!loadingProvider}
              className="text-white font-semibold hover:underline disabled:opacity-50"
            >
              {isLogin ? 'Sign up' : 'Log in'}
            </button>
          </div>

        </div>
      </div>

    </div>
  );
};

export default AuthPage;
