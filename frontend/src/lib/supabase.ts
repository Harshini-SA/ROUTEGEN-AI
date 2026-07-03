import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: any;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Missing Supabase environment variables! Webpage is running in offline demo mode.");
  
  // Safe mock client to prevent boot crash and allow offline previewing
  client = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithPassword: async () => {
        throw new Error("Supabase environment variables are missing. Authentication is disabled in demo mode.");
      },
      signUp: async () => {
        throw new Error("Supabase environment variables are missing. Authentication is disabled in demo mode.");
      },
      signInWithOAuth: async () => {
        throw new Error("Supabase environment variables are missing. Social login is disabled in demo mode.");
      },
      signOut: async () => ({ error: null })
    }
  };
} else {
  client = createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = client;
