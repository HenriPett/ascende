// ASCENDE — Blog: a SPA precisa saber, no BUILD, se existe ao menos um post —
// para mostrar o link "Blog" só quando /blog existe (regra 5 do plano: sem
// post, nem página, nem link, nem sitemap).
//
// `__BLOG_TEM_POSTS__` é trocado pelo `define` do vite.config (o pipeline
// conta os posts válidos em content/blog). O `typeof` é a rede para onde o
// define não chega — o Vitest, por exemplo: lá a constante não existe, e a
// resposta certa é "não tem post", nunca um ReferenceError.
declare const __BLOG_TEM_POSTS__: boolean | undefined;

export const BLOG_TEM_POSTS: boolean =
  typeof __BLOG_TEM_POSTS__ !== "undefined" && __BLOG_TEM_POSTS__ === true;
