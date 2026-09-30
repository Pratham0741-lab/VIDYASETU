import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clearTokens, hasRefreshToken, onSessionExpired, refreshAccessToken } from '../api/client';
import * as ep from '../api/endpoints';
import type { Me } from '../api/responses';
import { useI18n, type Lang } from '../i18n';

export type AuthStatus = 'loading' | 'anonymous' | 'signed-in';

/** Why the user is not signed in (shown on the login screen). */
export type SignOutReason = 'expired' | 'applicant' | null;

interface AuthState {
  status: AuthStatus;
  me: Me | null;
  signOutReason: SignOutReason;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Switches the UI language; when signed in, also saves it as the officer's notice language. */
  changeLanguage: (lang: Lang) => void;
}

const AuthContext = createContext<AuthState | null>(null);

/** Thrown by login() for an APPLICANT account: this portal is for officers only. */
export class ApplicantRefusedError extends Error {
  constructor() {
    super('applicant-refused');
    this.name = 'ApplicantRefusedError';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLang } = useI18n();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [signOutReason, setSignOutReason] = useState<SignOutReason>(null);
  const savedLang = useRef<string | null>(null);
  const started = useRef(false);

  const reset = useCallback((reason: SignOutReason) => {
    clearTokens();
    setMe(null);
    savedLang.current = null;
    setSignOutReason(reason);
    setStatus('anonymous');
  }, []);

  /** /auth/me role check. Applicant accounts are refused and logged out. */
  const establish = useCallback(async () => {
    const who = await ep.getMe();
    if (who.role === 'APPLICANT') {
      await ep.logout();
      reset('applicant');
      throw new ApplicantRefusedError();
    }
    setMe(who);
    setSignOutReason(null);
    setStatus('signed-in');
    // The officer's saved notice language (optional; failures keep the local choice).
    ep.getPreferences()
      .then((p) => {
        savedLang.current = p.preferred_language;
        if (!p.is_default && (p.preferred_language === 'en' || p.preferred_language === 'hi')) setLang(p.preferred_language);
      })
      .catch(() => undefined);
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
        if (!(e instanceof ApplicantRefusedError)) reset(null);
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
        if (!(e instanceof ApplicantRefusedError)) reset(null);
        throw e;
      }
    },
    [establish, reset],
  );

  const logout = useCallback(async () => {
    await ep.logout();
    reset(null);
  }, [reset]);

  const changeLanguage = useCallback(
    (lang: Lang) => {
      setLang(lang);
      // AUDITOR is read-only everywhere, including its own preferences.
      if (status !== 'signed-in' || !me || me.role === 'AUDITOR' || savedLang.current === lang) return;
      ep.setPreferences({ preferred_language: lang })
        .then((p) => {
          savedLang.current = p.preferred_language;
        })
        .catch(() => {
          // Kept locally; the server copy is updated on the next switch.
        });
    },
    [setLang, status, me],
  );

  const value = useMemo<AuthState>(
    () => ({ status, me, signOutReason, login, logout, changeLanguage }),
    [status, me, signOutReason, login, logout, changeLanguage],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
