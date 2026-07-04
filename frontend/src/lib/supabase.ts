import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let clientInstance: any;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("⚠️ Missing Supabase environment variables! Running in local mock Auth mode.");
  
  const defaultSession = {
    access_token: 'mock-access-token',
    user: {
      id: 'mock-user-id',
      email: 'guest@routegen.ai',
      user_metadata: {
        first_name: 'Guest',
        last_name: 'User'
      }
    }
  };

  // Restore session from localStorage if available
  let currentSession = defaultSession;
  let isLoggedIn = true;

  try {
    const savedSession = localStorage.getItem('mock_session');
    if (savedSession) {
      currentSession = JSON.parse(savedSession);
    }
    const savedLoggedIn = localStorage.getItem('mock_logged_in');
    if (savedLoggedIn !== null) {
      isLoggedIn = savedLoggedIn === 'true';
    }
  } catch (e) {
    console.warn("Failed to read mock session from localStorage", e);
  }

  let authCallback: any = null;

  clientInstance = {
    isLoggedIn,
    auth: {
      async getSession() {
        if (!clientInstance.isLoggedIn) {
          return { data: { session: null }, error: null };
        }
        return { data: { session: currentSession }, error: null };
      },
      onAuthStateChange(callback: any) {
        authCallback = callback;
        if (clientInstance.isLoggedIn) {
          setTimeout(() => callback('SIGNED_IN', currentSession), 0);
        } else {
          setTimeout(() => callback('SIGNED_OUT', null), 0);
        }
        return {
          data: {
            subscription: {
              unsubscribe() {
                authCallback = null;
              }
            }
          }
        };
      },
      async signInWithPassword({ email }: any) {
        clientInstance.isLoggedIn = true;
        
        // Extract first name from email
        const emailUser = email ? email.split('@')[0] : 'guest';
        const firstName = emailUser.charAt(0).toUpperCase() + emailUser.slice(1);
        
        currentSession = {
          ...currentSession,
          user: {
            ...currentSession.user,
            email: email || 'guest@routegen.ai',
            user_metadata: {
              first_name: firstName,
              last_name: 'User'
            }
          }
        };
        
        try {
          localStorage.setItem('mock_session', JSON.stringify(currentSession));
          localStorage.setItem('mock_logged_in', 'true');
        } catch (e) {}

        if (authCallback) {
          authCallback('SIGNED_IN', currentSession);
        }
        return { data: { session: currentSession }, error: null };
      },
      async signUp({ email, options }: any) {
        clientInstance.isLoggedIn = true;
        
        const emailUser = email ? email.split('@')[0] : 'guest';
        const firstName = options?.data?.first_name || (emailUser.charAt(0).toUpperCase() + emailUser.slice(1));
        const lastName = options?.data?.last_name || 'User';

        currentSession = {
          ...currentSession,
          user: {
            ...currentSession.user,
            email: email || 'guest@routegen.ai',
            user_metadata: {
              first_name: firstName,
              last_name: lastName
            }
          }
        };
        
        try {
          localStorage.setItem('mock_session', JSON.stringify(currentSession));
          localStorage.setItem('mock_logged_in', 'true');
        } catch (e) {}

        if (authCallback) {
          authCallback('SIGNED_IN', currentSession);
        }
        return { data: { session: currentSession }, error: null };
      },
      async signInWithOAuth({ provider }: any) {
        clientInstance.isLoggedIn = true;
        
        currentSession = {
          ...currentSession,
          user: {
            ...currentSession.user,
            email: `${provider}@routegen.ai`,
            user_metadata: {
              first_name: provider.charAt(0).toUpperCase() + provider.slice(1),
              last_name: 'User'
            }
          }
        };
        
        try {
          localStorage.setItem('mock_session', JSON.stringify(currentSession));
          localStorage.setItem('mock_logged_in', 'true');
        } catch (e) {}

        if (authCallback) {
          authCallback('SIGNED_IN', currentSession);
        }
        return { data: { session: currentSession }, error: null };
      },
      async signOut() {
        clientInstance.isLoggedIn = false;
        
        try {
          localStorage.setItem('mock_logged_in', 'false');
        } catch (e) {}

        if (authCallback) {
          authCallback('SIGNED_OUT', null);
        }
        return { error: null };
      }
    }
  };
} else {
  clientInstance = createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = clientInstance;
