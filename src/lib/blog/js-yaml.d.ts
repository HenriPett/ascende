// Tipos mínimos do js-yaml, só do que o blog usa (o pacote não traz tipos e
// @types/js-yaml seria uma dependência a mais por duas assinaturas).
declare module "js-yaml" {
  export const JSON_SCHEMA: unknown;
  export function load(src: string, opts?: { schema?: unknown }): unknown;
  const yaml: { load: typeof load; JSON_SCHEMA: unknown };
  export default yaml;
}
