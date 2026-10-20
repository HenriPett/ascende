// ASCENDE — O que o build pré-renderiza, e as transformações (puras) do HTML.
//
// O shell da SPA (dist/index.html do vite build) chega com <div id="root">
// vazio: sem JavaScript, um buscador ou agente via 41 caracteres. Para as
// páginas PÚBLICAS, o build (scripts/prerender.mjs) desenha a página com o
// React no Node e grava o resultado dentro do #root, com o <head> da página
// (title, description, canonical). O navegador recebe a página pronta e o
// src/main.tsx monta a SPA por cima — o mesmo markup.
//
// O shell vazio continua existindo como dist/app-shell.html: é ele que o
// netlify.toml serve para /app, /auth e /onboarding.
import { SITE_URL } from "@/lib/blog/tipos";

export interface PaginaPreRenderizada {
  rota: string;
  /** Relativo a dist/. O Netlify serve /privacidade de privacidade.html. */
  arquivo: string;
  /** A versão em Markdown (negociação de conteúdo e agentes). */
  md: string;
  /** `null` na home: o <head> do index.html já é o dela. */
  cabeca: { title: string; description: string } | null;
}

export const PAGINAS_PRE_RENDERIZADAS: readonly PaginaPreRenderizada[] = [
  { rota: "/", arquivo: "index.html", md: "index.md", cabeca: null },
  {
    rota: "/privacidade", arquivo: "privacidade.html", md: "privacidade.md",
    cabeca: {
      title: "Política de Privacidade — Ascende",
      description: "Como o Ascende trata os seus dados pessoais, conforme a LGPD: o que coleta, para quê, com quem compartilha e como exercer os seus direitos.",
    },
  },
  {
    rota: "/termos", arquivo: "termos.html", md: "termos.md",
    cabeca: {
      title: "Termos e Condições — Ascende",
      description: "As regras de uso do Ascende: a conta, os planos, as responsabilidades de cada parte e os limites do serviço.",
    },
  },
  {
    rota: "/aviso-legal", arquivo: "aviso-legal.html", md: "aviso-legal.md",
    cabeca: {
      title: "Aviso Legal — Ascende",
      description: "O Ascende organiza a sua rotina e não substitui médicos, nutricionistas, psicólogos ou consultores de investimento.",
    },
  },
  {
    rota: "/recusas", arquivo: "recusas.html", md: "recusas.md",
    cabeca: {
      title: "O que o Ascende recusa",
      description: "Os nãos públicos do Ascende: não vender dados, não aceitar anúncios, não usar notificação de culpa — cada um com a razão por trás dele.",
    },
  },
  {
    rota: "/sobre", arquivo: "sobre.html", md: "sobre.md",
    cabeca: {
      title: "Sobre o Ascende",
      description: "O que é o Ascende, para quem é, o que faz hoje, o que recusa, como funcionam os planos e quem opera.",
    },
  },
];

/** A 404 da casa: estática, servida pelo Netlify com status 404 para todo
 *  caminho sem arquivo e sem regra (netlify.toml não tem mais catch-all). */
export const PAGINA_404 = { arquivo: "404.html", md: "404.md", title: "Página não encontrada — Ascende" };

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escTexto = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Troca exatamente UMA ocorrência; zero ou duas é erro (o template mudou e
 *  o pré-render sairia com o <head> de outra página sem ninguém ver). */
function trocarUma(html: string, re: RegExp, novo: string, oque: string): string {
  const n = (html.match(new RegExp(re.source, "g")) ?? []).length;
  if (n !== 1) throw new Error(`pré-render: esperava 1 ${oque} no index.html, achei ${n}`);
  return html.replace(re, novo);
}

const meta = (attr: "name" | "property", chave: string) =>
  new RegExp(`<meta ${attr}="${chave}" content="[^"]*"\\s*/?>`);

/** O <head> da página: title, description, canonical, og:url e os títulos e
 *  descrições do Open Graph e do Twitter. `canonical: null` tira canonical e
 *  og:url (a 404 não tem endereço canônico). */
export function aplicarCabeca(html: string, c: { title: string; description: string; canonical: string | null }): string {
  let h = html;
  h = trocarUma(h, /<title>[^<]*<\/title>/, `<title>${escTexto(c.title)}</title>`, "<title>");
  h = trocarUma(h, meta("name", "description"), `<meta name="description" content="${escAttr(c.description)}" />`, "meta description");
  for (const p of ["og:title", "twitter:title"] as const) {
    h = trocarUma(h, meta(p.startsWith("og") ? "property" : "name", p), `<meta ${p.startsWith("og") ? "property" : "name"}="${p}" content="${escAttr(c.title)}" />`, p);
  }
  for (const p of ["og:description", "twitter:description"] as const) {
    h = trocarUma(h, meta(p.startsWith("og") ? "property" : "name", p), `<meta ${p.startsWith("og") ? "property" : "name"}="${p}" content="${escAttr(c.description)}" />`, p);
  }
  if (c.canonical) {
    h = trocarUma(h, /<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${escAttr(c.canonical)}" />`, "canonical");
    h = trocarUma(h, meta("property", "og:url"), `<meta property="og:url" content="${escAttr(c.canonical)}" />`, "og:url");
  } else {
    h = trocarUma(h, /\s*<link rel="canonical" href="[^"]*"\s*\/?>/, "", "canonical");
    h = trocarUma(h, /\s*<meta property="og:url" content="[^"]*"\s*\/?>/, "", "og:url");
  }
  return h;
}

/** Os JSON-LD da home (SoftwareApplication, Organization) descrevem o site,
 *  não a política de privacidade: só a home os carrega. */
export function semJsonLd(html: string): string {
  return html.replace(/\s*<!--(?:(?!-->)[\s\S])*?-->(?=\s*<script type="application\/ld\+json">)/g, "")
    .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
}

export const CAMINHO_DO_TEMA_DO_SITE = "/tema.js";

/** O script do tema ANTES do CSS: sem ele, quem usa o modo escuro veria a
 *  página pré-renderizada clara até o JS da SPA carregar. Externo porque a
 *  CSP (`script-src 'self'`) não deixa script inline. */
export function comTema(html: string): string {
  return trocarUma(html, /(\n\s*)<link rel="icon"/, `$1<script src="${CAMINHO_DO_TEMA_DO_SITE}"></script>$1<link rel="icon"`, "<link rel=icon>");
}

/** O markup dentro do #root. `data-prerender` avisa o main.tsx para carregar
 *  o chunk da página antes de montar (sem flash do Splash). */
export function comConteudo(html: string, markup: string, { app = true } = {}): string {
  return trocarUma(html, /<div id="root"><\/div>/, `<div id="root"${app ? " data-prerender" : ""}>${markup}</div>`, '<div id="root">');
}

/** A 404 é HTML puro: sem o JS da SPA (que montaria o NotFound do app por
 *  cima, com outra mensagem) e fora do índice. */
export function paginaSemApp(html: string): string {
  let h = html.replace(/\s*<script type="module"[^>]*><\/script>/g, "").replace(/\s*<link rel="modulepreload"[^>]*>/g, "");
  h = trocarUma(h, /(\n\s*)<meta name="viewport"/, `$1<meta name="robots" content="noindex" />$1<meta name="viewport"`, "meta viewport");
  return h;
}

export const canonicaDe = (rota: string) => (rota === "/" ? `${SITE_URL}/` : `${SITE_URL}${rota}`);

