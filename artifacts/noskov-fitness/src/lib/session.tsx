import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';
import { loginHref } from '@/lib/api';

export interface Person { id: string; name: string; sex: 'male' | 'female'; units: 'lb' | 'kg' }
export interface Me { user: Person & { isCoach: boolean; canLogForOthers: boolean; hasPassword: boolean }; logFor: Person[]; today: string }

const Ctx = createContext<Me | undefined>(undefined);
export const useMe = () => useContext(Ctx);

/** Loads the signed-in person; sends everyone else to the sign-in page. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [path, navigate] = useLocation();
  const onLogin = path === '/login';
  const q = useGetMe({ query: { enabled: !onLogin, retry: false, queryKey: getGetMeQueryKey(), staleTime: 60000 } });
  const status = q.error && typeof q.error === 'object' && 'status' in q.error ? Number((q.error as { status: unknown }).status) : 0;
  useEffect(() => { if (!onLogin && status === 401) navigate(loginHref()); }, [onLogin, status, navigate]);
  return <Ctx.Provider value={onLogin ? undefined : (q.data as Me | undefined)}>{children}</Ctx.Provider>;
}

/** The person's local date (YYYY-MM-DD), so "today" matches their phone, not the server. */
export const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
