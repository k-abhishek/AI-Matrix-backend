import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth as useClerkAuth, useUser as useClerkUser, useClerk } from '@clerk/react';
import apiClient from '../api/client';

export type AppUser = ReturnType<typeof useClerkUser>['user'];

export interface AuthContextType {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  user: AppUser;
  token: string | null;
  getToken: (options?: { template?: string; skipCache?: boolean }) => Promise<string | null>;
  signOut: () => Promise<void>;
  openUserProfile: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/**
 * Internal provider that runs within ClerkProvider context when Clerk is configured.
 */
const ClerkAuthConsumer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoaded, isSignedIn, userId, getToken: clerkGetToken, signOut: clerkSignOut } = useClerkAuth();
  const { user } = useClerkUser();
  const clerk = useClerk();
  const [token, setToken] = useState<string | null>(null);

  const getToken = useCallback(
    async (options?: { template?: string; skipCache?: boolean }): Promise<string | null> => {
      try {
        if (!clerkGetToken) return null;
        const currentToken = await clerkGetToken(options);
        setToken(currentToken);
        return currentToken;
      } catch (err) {
        console.warn('[AuthContext] Error retrieving Clerk access token:', err);
        return null;
      }
    },
    [clerkGetToken]
  );

  // Wire Clerk token retrieval directly into the global apiClient
  useEffect(() => {
    apiClient.setAuthTokenProvider(async () => {
      try {
        return await getToken();
      } catch (err) {
        console.warn('[ApiClient] Failed to attach Clerk token:', err);
        return null;
      }
    });

    if (isSignedIn) {
      getToken();
    } else {
      setToken(null);
    }
  }, [getToken, isSignedIn]);

  const signOut = useCallback(async () => {
    try {
      await clerkSignOut();
      setToken(null);
    } catch (err) {
      console.error('[AuthContext] Error during sign out:', err);
    }
  }, [clerkSignOut]);

  const openUserProfile = useCallback(() => {
    clerk?.openUserProfile?.();
  }, [clerk]);

  const contextValue = useMemo<AuthContextType>(
    () => ({
      isLoaded: isLoaded ?? false,
      isSignedIn: isSignedIn ?? false,
      userId: userId ?? null,
      user: user ?? null,
      token,
      getToken,
      signOut,
      openUserProfile,
    }),
    [isLoaded, isSignedIn, userId, user, token, getToken, signOut, openUserProfile]
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

/**
 * Fallback provider when Clerk publishable key is not present.
 */
const FallbackAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const contextValue = useMemo<AuthContextType>(
    () => ({
      isLoaded: true,
      isSignedIn: false,
      userId: null,
      user: null,
      token: null,
      getToken: async () => null,
      signOut: async () => {},
      openUserProfile: () => {},
    }),
    []
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (!PUBLISHABLE_KEY) {
    return <FallbackAuthProvider>{children}</FallbackAuthProvider>;
  }

  return <ClerkAuthConsumer>{children}</ClerkAuthConsumer>;
};

export const useAuthContext = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
