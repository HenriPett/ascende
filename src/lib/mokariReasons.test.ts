// ASCENDE — A regra 3 do Mokari não pode morrer por divergência de cópia.
//
// A lista de motivos de XP que vêm do corpo (peso, composição corporal) existe
// em TRÊS lugares, e cada um por um motivo legítimo:
//
//   src/lib/mokari.ts            IGNORED_XP_REASONS — o cálculo com entrada
//                                por array filtra aqui
//   migração 20260908120000      xp_total_mokari() — a soma agregada filtra em
//                                SQL, ao lado do gatilho que grava os motivos
//   supabase/setup.sql           o espelho, para instalação nova nascer certa
//
// Três cópias divergem. E a divergência aqui é do pior tipo: silenciosa e
// favorável ao erro. Se alguém acrescentar um motivo de peso só no TypeScript,
// o `xp_total_mokari` continua somando aquele XP, o estágio do Mokari volta a
// reagir ao corpo, e NADA acusa — é justamente a regra que a Fase 5 mais
// protegeu, furada por uma string.
//
// Este teste é a trava. Falha e aponta os dois lugares.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { IGNORED_XP_REASONS } from "@/lib/mokari";

const MIGRACAO = "supabase/migrations/20260908120000_mokari_totais.sql";
const SETUP = "supabase/setup.sql";
const BEGIN = "IGNORED_XP_REASONS:BEGIN";
const END = "IGNORED_XP_REASONS:END";

/** Extrai a lista SQL entre os marcadores. Falha alto se os marcadores
 *  sumirem — apagá-los desligaria esta trava sem ninguém notar. */
function reasonsFromSql(path: string): string[] {
  const sql = readFileSync(path, "utf-8");
  const i = sql.indexOf(BEGIN);
  const j = sql.indexOf(END);
  expect(i, `${path}: marcador ${BEGIN} ausente — não apague, é a trava da regra 3`)
    .toBeGreaterThan(-1);
  expect(j, `${path}: marcador ${END} ausente`).toBeGreaterThan(i);
  return [...sql.slice(i, j).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("regra 3 — a lista de motivos de peso não pode divergir", () => {
  it("a migração tem exatamente os motivos do TypeScript", () => {
    expect(reasonsFromSql(MIGRACAO)).toEqual([...IGNORED_XP_REASONS]);
  });

  it("o setup.sql tem exatamente os mesmos", () => {
    // Instalação nova nasce do setup.sql: se ele ficar atrás, um ambiente
    // limpo passa a contar XP de peso no estágio.
    expect(reasonsFromSql(SETUP)).toEqual([...IGNORED_XP_REASONS]);
  });

  it("a lista não está vazia — trava que se auto-desliga não é trava", () => {
    expect(IGNORED_XP_REASONS.length).toBeGreaterThan(0);
  });

  it("cobre as duas formas que o banco grava: rótulo e legado", () => {
    // O gatilho atual grava "Peso registrado"; linhas antigas usam
    // "Registro: <kind>". Perder uma das formas deixa XP de peso passar.
    expect(IGNORED_XP_REASONS).toContain("Peso registrado");
    expect(IGNORED_XP_REASONS).toContain("Registro: weight");
  });

  it("a função certa é usada: xp_total_mokari existe e xp_total NÃO serve", () => {
    const sql = readFileSync(MIGRACAO, "utf-8");
    expect(sql).toContain("create or replace function public.xp_total_mokari");
    // O corpo da função nova não pode simplesmente chamar xp_total.
    expect(sql).not.toMatch(/select\s+public\.xp_total\s*\(/i);
  });
});
