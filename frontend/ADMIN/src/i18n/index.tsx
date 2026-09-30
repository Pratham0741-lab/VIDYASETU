import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { hi } from './hi';

export type Lang = 'en' | 'hi';
export const LANGS: readonly Lang[] = ['en', 'hi'];
export type { MessageKey };

const CATALOGUES: Record<Lang, Partial<Record<MessageKey, string>>> = { en, hi };
const LANG_KEY = 'lang';

export type Vars = Record<string, string | number>;

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/** Text for a key in a language; English if the language lacks it. */
export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  return interpolate(CATALOGUES[lang][key] ?? en[key] ?? String(key), vars);
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'hi') return saved;
  } catch {
    // no storage: default
  }
  return 'en';
}

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Text for a dynamic key (e.g. a backend message key); `fallback` when unknown. */
  tk: (key: string, fallback: string, vars?: Vars) => string;
  formatDate: (iso: string | null | undefined, withTime?: boolean) => string;
  formatNumber: (n: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // not persisted
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
    return {
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      tk: (key, fallback, vars) => (isMessageKey(key) ? translate(lang, key, vars) : fallback),
      formatDate: (iso, withTime = false) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return d.toLocaleString(locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
        });
      },
      formatNumber: (n) => n.toLocaleString(locale),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}
