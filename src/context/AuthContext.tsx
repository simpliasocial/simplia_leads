import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import { AuthContext, type UserRole } from './authContextValue';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [role, setRole] = useState<UserRole | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        let initialized = false;

        const fetchRole = async (userId: string) => {
            try {
                const { data, error } = await supabase
                    .from('user_profiles')
                    .select('role')
                    .eq('id', userId)
                    .single();
                
                if (error) {
                    console.error('Error fetching role for user:', userId, error);
                    if (active) setRole('operator');
                    return;
                }

                if (data?.role) {
                    if (active) setRole(data.role as UserRole);
                } else {
                    console.warn('No role found for user:', userId);
                    if (active) setRole('operator');
                }
            } catch (err) {
                console.error('Unexpected error in fetchRole:', err);
                if (active) setRole('operator');
            }
        };

        const clearSession = async () => {
            await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
            if (!active) return;
            setUser(null);
            setRole(null);
        };

        const bootstrapSession = async () => {
            try {
                const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
                if (sessionError) throw sessionError;

                let session = sessionData.session;
                if (session?.access_token) {
                    const { data: userData, error: userError } = await supabase.auth.getUser(session.access_token);
                    if (userError || !userData.user) {
                        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
                        if (refreshError || !refreshed.session) {
                            await clearSession();
                            return;
                        }
                        session = refreshed.session;
                    }
                }

                if (!active) return;
                setUser(session?.user ?? null);
                setRole(null);
                if (session?.user) await fetchRole(session.user.id);
            } catch (error) {
                console.error('Error validating stored session:', error);
                await clearSession();
            } finally {
                initialized = true;
                if (active) setLoading(false);
            }
        };

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (!initialized || event === 'INITIAL_SESSION') return;

            window.setTimeout(() => {
                if (!active) return;
                setUser(session?.user ?? null);
                setRole(null);
                if (session?.user) void fetchRole(session.user.id);
                setLoading(false);
            }, 0);
        });

        void bootstrapSession();

        return () => {
            active = false;
            subscription.unsubscribe();
        };
    }, []);

    const signIn = async (username: string, pass: string) => {
        // Mapping username to email as requested
        let email = username;
        if (username.toLowerCase() === 'admin') email = 'admin@simplia.com';
        else if (username.toLowerCase() === 'test') email = 'test@simplia.com';
        else if (!username.includes('@')) email = `${username}@simplia.com`;

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password: pass,
        });

        return { error };
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('isAuthenticated'); // Cleanup legacy if exists
    };

    return (
        <AuthContext.Provider value={{ user, role, loading, signIn, signOut }}>
            {children}
        </AuthContext.Provider>
    );
};
