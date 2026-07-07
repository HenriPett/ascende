import { type ReactNode } from "react";

// Renderizador de markdown enxuto para as respostas do Conselheiro e os planos:
// títulos, negrito, itálico, código, listas, tabelas e divisores.
// `doc` liga o modo documento (planos): tipografia maior e seções bem separadas.

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_]+)_|`([^`]+)`)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) nodes.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<em key={key++}>{m[3]}</em>);
    else if (m[4] !== undefined) nodes.push(<em key={key++}>{m[4]}</em>);
    else if (m[5] !== undefined)
      nodes.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {m[5]}
        </code>
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const isBullet = (l: string) => /^\s*[-*]\s+/.test(l);
const isNumbered = (l: string) => /^\s*\d+\.\s+/.test(l);
const isHeading = (l: string) => /^#{1,6}\s+/.test(l);
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isHr = (l: string) => /^\s*-{3,}\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(l);

function splitRow(l: string): string[] {
  return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function Markdown({ content, doc = false }: { content: string; doc?: boolean }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  // Classes por modo: chat (compacto) vs documento (planos)
  const cls = doc
    ? {
        h12: "font-display font-semibold text-lg mt-6 mb-2 first:mt-0 pb-1.5 border-b",
        h3: "font-semibold text-[0.95rem] mt-4 mb-1.5 first:mt-0",
        p: "my-2 first:mt-0 last:mb-0 leading-relaxed",
        ul: "list-disc pl-5 space-y-1 my-2",
        ol: "list-decimal pl-5 space-y-1 my-2",
      }
    : {
        h12: "font-display font-semibold text-[0.95rem] mt-2.5 mb-1 first:mt-0",
        h3: "font-semibold mt-2 mb-0.5 first:mt-0",
        p: "my-1 first:mt-0 last:mb-0 leading-relaxed",
        ul: "list-disc pl-5 space-y-0.5 my-1.5",
        ol: "list-decimal pl-5 space-y-0.5 my-1.5",
      };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Divisor
    if (isHr(line)) {
      blocks.push(<div key={key++} className={doc ? "ascend-line my-5" : "ascend-line my-3"} aria-hidden />);
      i++;
      continue;
    }

    // Tabela: linha | ... | seguida do separador |---|
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && !isTableSep(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-2.5 overflow-x-auto rounded-lg border">
          <table className="w-full text-[0.85rem]">
            <thead>
              <tr className="bg-muted/60">
                {header.map((c, j) => (
                  <th key={j} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t">
                  {r.map((c, cj) => (
                    <td key={cj} className="px-3 py-1.5 align-top">{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push(
        <p key={key++} className={h[1].length <= 2 ? cls.h12 : cls.h3}>{inline(h[2])}</p>
      );
      i++;
      continue;
    }

    if (isBullet(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>);
        i++;
      }
      blocks.push(<ul key={key++} className={cls.ul}>{items}</ul>);
      continue;
    }

    if (isNumbered(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>);
        i++;
      }
      blocks.push(<ol key={key++} className={cls.ol}>{items}</ol>);
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !isHeading(lines[i]) && !isBullet(lines[i]) && !isNumbered(lines[i]) &&
      !isTableRow(lines[i]) && !isHr(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++} className={cls.p}>{inline(para.join(" "))}</p>);
  }

  return <div>{blocks}</div>;
}