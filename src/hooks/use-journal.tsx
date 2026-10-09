import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState, Platform } from "react-native";
import type { Session } from "@supabase/supabase-js";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import * as repository from "@/lib/repository";

const AuthContext = createContext<{
  owner: string;
  session: Session | null;
  ready: boolean;
}>({ owner: "local", session: null, ready: false });
export function JournalProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 30000 },
          mutations: { retry: false },
        },
      }),
  );
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);
  useEffect(() => {
    if (!supabase) return;
    const db = supabase;
    let alive = true;
    const { data: listener } = db.auth.onAuthStateChange((_event, next) => {
      if (alive) {
        setSession(next);
        setReady(true);
        queryClient.clear();
      }
    });
    db.auth
      .getSession()
      .then(({ data }) => {
        if (alive) {
          setSession(data.session);
          setReady(true);
        }
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        db.auth.startAutoRefresh();
        void queryClient.invalidateQueries();
      } else db.auth.stopAutoRefresh();
    });
    if (Platform.OS !== "web") db.auth.startAutoRefresh();
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
      appState.remove();
      db.auth.stopAutoRefresh();
    };
  }, [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{ owner: session?.user.id ?? "local", session, ready }}
      >
        {children}
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}
/** Where the journal is cached for `owner`, for reading or patching it. */
export const journalKey = (owner: string) => ["journal", owner];

export function useAccount() {
  return useContext(AuthContext);
}
export function useJournal() {
  const { owner, ready } = useAccount();
  return useQuery({
    queryKey: journalKey(owner),
    queryFn: () => repository.readJournal(owner),
    enabled: ready,
    refetchInterval: owner === "local" ? false : 30 * 60 * 1000,
  });
}
export function useJournalMutation<T, R>(
  action: (owner: string, input: T) => Promise<R>,
) {
  const { owner } = useAccount();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: T) => action(owner, input),
    onSuccess: () => cache.invalidateQueries({ queryKey: journalKey(owner) }),
  });
}
