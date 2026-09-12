"use client";

import { useEffect, useState } from 'react';
import { getCurrentUser, isAdminSessionActive } from '@/lib/authService';
import { Loader2 } from 'lucide-react';

// This guard protects pages that require a standard user to be logged in.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (cancelled) return;
      if (!user) {
        // Force a full page reload to clear all state before redirecting.
        // This is the critical fix to prevent data leakage between user sessions.
        window.location.href = '/login';
      } else {
        setIsVerified(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isVerified) {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-background">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2">Verifying session...</p>
        </div>
    );
  }

  return <>{children}</>;
}

// This guard specifically protects the admin management pages.
export function AdminAuthGuard({ children }: { children: React.ReactNode }) {
    const [isVerified, setIsVerified] = useState(false);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        const active = await isAdminSessionActive();
        if (cancelled) return;
        if (!active) {
            // Force a full page reload to clear all state before redirecting.
            window.location.href = '/login';
        } else {
            setIsVerified(true);
        }
      })();
      return () => { cancelled = true; };
    }, []);

    if (!isVerified) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2">Verifying admin session...</p>
            </div>
        );
    }

    return <>{children}</>;
  }
