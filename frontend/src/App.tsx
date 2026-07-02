import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import AuthPage from './components/AuthPage';
import AuthWrapper from './components/AuthWrapper';
import ChatApp from './components/ChatApp';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        
        {/* Protected Routes */}
        <Route element={<AuthWrapper />}>
          <Route path="/chat" element={
            <div className="h-screen w-screen bg-background font-sans text-text-primary overflow-hidden flex selection:bg-primary/20">
              <ChatApp />
            </div>
          } />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
