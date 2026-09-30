import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clearTokens, hasRefreshToken, onSessionExpired, refreshAccessToken } from '../api/client';
import * as ep from '../api/endpoints';
import type { ApplicantProfile, Me } from '../api/responses';
import { useI18n, type Lang } from '../i18n';

export type AuthStatus = 'loading' | 'anonymous' | 'signed-in';

/** Why the user is not signed in (shown on the login screen). */
export type SignOutReason = 'expired' | 'not-applicant' | null;

interface AuthState {
  status: AuthStatus;
  me: Me | null;
  profile: ApplicantProfile | null;
  signOutReason: SignOutReason;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reloadProfile: () => Promise<void>;
  /** Switches the UI language; when signed in, also saves it as preferred_language. */
  changeLanguage: (lang: Lang) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export class NotApplicantError extends Error {
  constructor() {
    super('not-applicant');
    this.name = 'NotApplicantError';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLang } = useI18n();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<ApplicantProfile | null>(null);
  const [signOutReason, setSignOutReason] = useState<SignOutReason>(null);
  const started = useRef(false);

  const reset = useCallback((reason: SignOutReason) => {
    clearTokens();
    setMe(null);
    setProfile(null);
    setSignOutReason(reason);
    setStatus('anonymous');
  }, []);

  /** /auth/me role check, then the applicant profile. Non-applicants are refused and logged out. */
  const establish = useCallback(async () => {
    const who = await ep.getMe();
    if (who.role !== 'APPLICANT') {
      await ep.logout();
      reset('not-applicant');
      throw new NotApplicantError();
    }
    const p = await ep.getProfile();
    setMe(who);
    setProfile(p);
    if (p.preferred_language === 'en' || p.preferred_language === 'hi') setLang(p.preferred_language as Lang);
    setSignOutReason(null);
    setStatus('signed-in');
  }, [reset, setLang]);

  // Session restore on page load, from the refresh token in sessionStorage.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      if (!hasRefreshToken() || !(await refreshAccessToken())) {
        reset(null);
        return;
      }
      try {
        await establish();
      } catch (e) {
        if (!(e instanceof NotApplicantError)) reset(null);
      }
    })();
  }, [establish, reset]);

  // Global "session expired" path: a refresh failed somewhere.
  useEffect(() => onSessionExpired(() => reset('expired')), [reset]);

  const login = useCallback(
    async (email: string, password: string) => {
      await ep.login({ email, password });
      try {
        await establish();
      } catch (e) {
        if (!(e instanceof NotApplicantError)) reset(null);
        throw e;
      }
    },
    [establish, reset],
  );

  const logout = useCallback(async () => {
    await ep.logout();
    reset(null);
  }, [reset]);

  const reloadProfile = useCallback(async () => {
    setProfile(await ep.getProfile());
  }, []);

  const changeLanguage = useCallback(
    (lang: Lang) => {
      setLang(lang);
      if (status !== 'signed-in' || profile?.preferred_language === lang) return;
      ep.updateProfile({ preferred_language: lang })
        .then((p) => setProfile(p))
        .catch(() => {
          // Kept locally; the server copy is updated on the next switch.
        });
    },
    [setLang, status, profile],
  );

  const value = useMemo<AuthState>(
    () => ({ status, me, profile, signOutReason, login, logout, reloadProfile, changeLanguage }),
    [status, me, profile, signOutReason, login, logout, reloadProfile, changeLanguage],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

