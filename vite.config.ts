import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { existsSync, readdirSync } from "fs";

/* O LINK "BLOG" SÓ EXISTE SE EXISTIR POST (plano do blog, regra 5).
   Decidido no build, não no navegador: com zero posts, `__BLOG_TEM_POSTS__` é
   `false` em tempo de compilação e nenhum link para /blog é RENDERIZADO (o
   SiteFooter recebe o flag como padrão de uma prop, então o ramo fica no JS,
   desligado; o que importa — o link na página — não existe). Conta todo .md da pasta menos o
   INDICE; se algum estiver errado, o passo do blog no fim do `npm run build`
   recusa o build inteiro — então "tem arquivo" e "tem post válido" nunca
   divergem num deploy.
   `BLOG_CONTENT_DIR` é só para o preview com fixtures (scripts/blog.mjs
   recusa fixtures indo para dist/). */
function temPostsNoBlog(): boolean {
  const pasta = path.resolve(__dirname, process.env.BLOG_CONTENT_DIR ?? "content/blog");
  if (!existsSync(pasta)) return false;
  return readdirSync(pasta).some((n) => n.endsWith(".md") && n !== "INDICE.md");
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  define: {
    __BLOG_TEM_POSTS__: JSON.stringify(temPostsNoBlog()),
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});
