"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { api } from "@/lib/client";

interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  provider: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isLoggedIn: boolean;
  refreshUser: () => Promise<void>;
  setAuthenticatedUser: (user: User) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const authRequestId = useRef(0);

  const refreshUser = useCallback(async () => {
    const requestId = ++authRequestId.current;
    try {
      const res = await fetch("/api/v1/auth/me", { credentials: "include" });
      if (requestId !== authRequestId.current) return;
      if (res.ok) {
        const json = await res.json();
        setUser(json.data?.user || null);
      } else {
        setUser(null);
      }
    } catch {
      if (requestId === authRequestId.current) setUser(null);
    } finally {
      if (requestId === authRequestId.current) setLoading(false);
    }
  }, []);

  const setAuthenticatedUser = useCallback((nextUser: User) => {
    authRequestId.current += 1;
    setUser(nextUser);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    setUser(null);
    // Reload to clear any cached state
    window.location.href = "/";
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refreshUser());
  }, [refreshUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isLoggedIn: !!user,
        refreshUser,
        setAuthenticatedUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
