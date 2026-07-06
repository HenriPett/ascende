import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const currentUserId = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      currentUserId.current = data.session?.user?.id ?? null;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      const incoming = s?.user?.id ?? null;
      if (event === "TOKEN_REFRESHED" && incoming && incoming === currentUserId.current) {
        setSession((prev) => (prev && s ? { ...s, user: prev.user } : s));
        setLoading(false);
        return;
      }
      currentUserId.current = incoming;
      setSession(s);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}
