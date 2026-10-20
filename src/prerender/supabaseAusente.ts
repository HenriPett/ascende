// No pré-render, o cliente do Supabase é ESTE: um objeto que falha alto se
// alguém o usar. O App importa o cliente de verdade (via useAuth), mas as
// páginas públicas não têm sessão e não buscam nada no render — e o cliente
// real, no Node, abriria realtime e timers de sessão. Se um dia uma página
// pré-renderizada precisar de dado do banco no render, o build quebra aqui,
// em vez de publicar HTML com dado de quem rodou o build.
// (scripts/prerender.mjs troca "@/integrations/supabase/client" por este.)
export const supabase = new Proxy({}, {
  get(_alvo, prop) {
    if (prop === "then" || typeof prop === "symbol") return undefined;
    throw new Error(`pré-render: a página usou supabase.${String(prop)} durante o render — páginas pré-renderizadas não leem o banco`);
  },
});
