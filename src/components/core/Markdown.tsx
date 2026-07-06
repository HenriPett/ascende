import { type ReactNode } from "react";

// Renderizador de markdown enxuto, suficiente para as respostas do Conselheiro:
// títulos, negrito, itálico, código e listas (com hífen, asterisco ou numeradas).

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

export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const cls = h[1].length <= 2
        ? "font-display font-semibold text-[0.95rem] mt-2.5 mb-1 first:mt-0"
        : "font-semibold mt-2 mb-0.5 first:mt-0";
      blocks.push(<p key={key++} className={cls}>{inline(h[2])}</p>);
      i++;
      continue;
    }

    if (isBullet(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>);
        i++;
      }
      blocks.push(<ul key={key++} className="list-disc pl-5 space-y-0.5 my-1.5">{items}</ul>);
      continue;
    }

    if (isNumbered(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>);
        i++;
      }
      blocks.push(<ol key={key++} className="list-decimal pl-5 space-y-0.5 my-1.5">{items}</ol>);
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !isHeading(lines[i]) && !isBullet(lines[i]) && !isNumbered(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++} className="my-1 first:mt-0 last:mb-0 leading-relaxed">{inline(para.join(" "))}</p>);
  }

  return <div>{blocks}</div>;
}
