import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import BatchReview, { DuplicateBadge } from "@/components/core/BatchReview";
import { toast } from "sonner";
import {
  Upload, Loader2, Check, FileQuestion, MessageCircle, Moon, Dumbbell, Scale,
  Droplet, Smartphone, X, AlertTriangle, UtensilsCrossed,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { fileToText } from "@/lib/files";
import { dateISOInSP, formatSP } from "@/lib/dates";
import { saveImportedEvents } from "@/lib/captureEvents";
import {
  parseHealthCsv, formatLabel, MAX_IMPORT_EVENTS, PARSER_VERSION, SUPPORTED_SOURCES,
  type ImportResult, type ImportedEvent, type HealthCsvFormat,
} from "@/lib/healthImport";
import {
  appleHealthLabel, APPLE_HEALTH_SOURCE_LABEL,
  PARSER_VERSION as APPLE_PARSER_VERSION,
} from "@/lib/appleHealth";
import {
  readAppleHealthFile, AppleHealthReadError, type AppleHealthProgress,
} from "@/lib/appleHealthZip";
import {
  hashFile, fingerprintLargeFile, findSourceByHash, createSource, createReceipt,
  existingRecordKeys, markAlreadyImported,
  confirmSource, markSourcePartial, markSourceFailed, awardImportMilestone,
  buildReceiptSummary, importOutcome,
  type DataSource, type ImportReceipt, type ImportWarning,
} from "@/lib/dataSources";

/* Importação de dados de saúde, com revisão em LOTE.
 *
 * Dois caminhos, e a diferença entre eles é o tamanho:
 *
 *   CSV de app (Sleep Cycle, Hevy, Withings…) — kilobytes, lido de uma vez.
 *   EXPORT DO APP SAÚDE do iPhone — um zip com XML que passa de 800 MB, lido
 *     em streaming no próprio aparelho, com progresso e cancelamento.
 *
 * Os dois compartilham tudo depois da leitura: mesma revisão em lote, mesma
 * fonte, mesmo recibo. Nenhum dos dois passa por IA — o arquivo é lido de
 * forma determinística aqui, e a pessoa VÊ cada registro antes de gravar. O
 * Conselheiro dizia "absorvi seu arquivo" e não absorvia; o que corrigiu isso
 * foi mostrar a lista, não melhorar o prompt. */

/** Ícone e cor por TIPO DE REGISTRO, não por formato de arquivo.
 *  O export do App Saúde traz sono + treino + peso + água no mesmo arquivo,
 *  então um ícone por formato não diz nada: quem olha a lista precisa saber o
 *  que é cada LINHA. */
/* Teto da consulta de histórico. O servidor corta a resposta antes disso, e é
   por isso que o número existe aqui: se a lista voltar cheia, sabemos que ela
   foi truncada e a conferência não vale. */
const HISTORICO_MAX = 1000;

const KIND_META: Record<string, { icon: LucideIcon; colorVar: string; plural: string }> = {
  sleep: { icon: Moon, colorVar: "--vitalidade", plural: "noites de sono" },
  workout: { icon: Dumbbell, colorVar: "--vitalidade", plural: "treinos" },
  weight: { icon: Scale, colorVar: "--alimentacao", plural: "pesagens" },
  water: { icon: Droplet, colorVar: "--alimentacao", plural: "dias de hidratação" },
  // "registros de alimentação", e não "refeições": o mesmo formato cobre
  // linha-por-refeição (MyFitnessPal) e total-do-dia (Cronometer), e chamar
  // 120 dias de total de "120 refeições" seria mentira.
  meal: { icon: UtensilsCrossed, colorVar: "--alimentacao", plural: "registros de alimentação" },
};

/** O resultado pode vir do CSV ou do export do App Saúde. As duas formas são
 *  idênticas fora do `format`, e é por isso que a revisão é uma só. */
type ImportedFormat = HealthCsvFormat | "apple_health";
type AnyImportResult = Omit<ImportResult, "format"> & { format: ImportedFormat };

/** Como a leitura falhou. Cada uma tem próximo passo diferente, e por isso
 *  mensagem própria: "não consegui ler" sem dizer o que fazer é um beco. */
type ReadFailure = "corrompido" | "memoria" | "generico";

const isAppleFile = (name: string) => /\.(zip|xml)$/i.test(name.trim());

const mb = (bytes: number) => `${Math.round(bytes / 1048576).toLocaleString("pt-BR")} MB`;

/** Data de uma importação anterior, no fuso do app. */
const shortStamp = (iso: string) =>
  formatSP(iso, { day: "2-digit", month: "short", year: "numeric" });

/**
 * O que dizer quando o teto cortou os registros mais antigos.
 *
 * A segunda oração é o ponto: o texto anterior ("mais antigas ficaram de
 * fora") sugeria teto POR IMPORTAÇÃO, então a pessoa reimportava o mesmo
 * arquivo esperando o resto — e não vinha nada, porque o corte é do arquivo,
 * não da vez. Recortar o período no app de origem funciona (muda o hash,
 * abre fonte nova, e o que já entrou volta desmarcado), só não estava escrito
 * em lugar nenhum.
 */
function truncationMessage(stats: AnyImportResult["stats"]): string {
  const faixa = stats.truncatedRange
    ? `, de ${longDate(stats.truncatedRange.from)} a ${longDate(stats.truncatedRange.to)}`
    : "";
  const periodo = stats.truncatedRange ? "desse período mais antigo" : "do período mais antigo";
  return `Ficaram de fora os ${stats.truncated.toLocaleString("pt-BR")} registros mais antigos${faixa}. `
    + "Importar este mesmo arquivo de novo vai trazer exatamente os mesmos registros — "
    + `para trazer o resto, exporte um arquivo só ${periodo} e importe separado.`;
}

/** "1 registro" / "40 registros": o número e a palavra têm de concordar, e
 *  ler "1 registros" no recibo faz o resto do texto perder crédito. */
const plural = (n: number, um: string, muitos: string) =>
  `${n.toLocaleString("pt-BR")} ${n === 1 ? um : muitos}`;

const longDate = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "short", day: "2-digit", month: "short", year: "2-digit",
  });

/** Detalhe curto de cada linha, por tipo. */
/** A linha da revisão. Numa lista MISTA (o export do iPhone traz sono, treino,
 *  peso e água juntos, e agora pode vir alimentação pelo CSV), cada linha
 *  precisa dizer o que ela é sem depender do ícone ao lado. */
function eventDetail(ev: ImportedEvent): string {
  if (ev.kind === "sleep") return `${String(ev.hours ?? 0).replace(".", ",")}h de sono`;
  if (ev.kind === "weight") return `${String(ev.kg ?? 0).replace(".", ",")} kg`;
  if (ev.kind === "water") return `${(ev.ml ?? 0).toLocaleString("pt-BR")} ml de água`;
  if (ev.kind === "meal") {
    // A descrição já vem como "Almoço: 620 kcal" (ou "Dia inteiro: ..."); a
    // proteína entra porque é o macro que a pessoa acompanha no app.
    const rotulo = (ev.description ?? "").replace(/^:\s*/, "").trim();
    const partes = [
      rotulo || (ev.calories ? `${ev.calories} kcal` : "Alimentação"),
      ev.protein_g ? `${ev.protein_g} g de proteína` : null,
    ].filter(Boolean);
    return partes.join(" · ");
  }
  if (ev.kind === "workout") {
    const partes = [ev.description, ev.duration_min ? `${ev.duration_min} min` : null].filter(Boolean);
    return partes.join(" · ") || "Treino";
  }
  // Tipo que a tela ainda não conhece: o resumo do parser é melhor do que
  // chamar de treino o que não é — foi o que aconteceu quando a alimentação
  // chegou e caiu no ramo do treino por descarte.
  return ev.summary || ev.description || "Registro";
}

/** Quantos registros de cada tipo, na ordem em que aparecem no arquivo. */
function countByKind(events: ImportedEvent[]): { kind: string; n: number }[] {
  const ordem: string[] = [];
  const contas = new Map<string, number>();
  for (const ev of events) {
    if (!contas.has(ev.kind)) ordem.push(ev.kind);
    contas.set(ev.kind, (contas.get(ev.kind) ?? 0) + 1);
  }
  return ordem.map((kind) => ({ kind, n: contas.get(kind) ?? 0 }));
}

/** O que a tela diz que reconheceu. No export misto é o rótulo composto
 *  ("580 noites de sono, 362 dias de treino e 24 pesagens"); no CSV, o do
 *  formato único. */
function recognizedLabel(result: AnyImportResult): string {
  return result.format === "apple_health"
    ? appleHealthLabel(result.events)
    : formatLabel(result.format, result.events.length);
}

export default function HealthImport() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [reading, setReading] = useState(false);
  /** Progresso da LEITURA (o export grande). Null no caminho do CSV, que é
   *  instantâneo e não precisa de barra. */
  const [readProgress, setReadProgress] = useState<AppleHealthProgress | null>(null);
  const [unknownFile, setUnknownFile] = useState<string | null>(null);
  /** É um export do App Saúde, mas veio SEM registro — export interrompido no
   *  iPhone. Diferente de "não reconheci": o caminho é exportar de novo, e
   *  mandar a pessoa procurar defeito no arquivo errado custa a tarde dela. */
  const [emptyExport, setEmptyExport] = useState<string | null>(null);
  /** Confirmou e NADA entrou. A tela não pode fechar em silêncio nesse caso:
   *  painel sumindo sem aviso é lido como sucesso, e foi assim que a pessoa
   *  achou que gravou 1.010 registros que nunca entraram. */
  const [nothingNew, setNothingNew] = useState<
    null | { fromThisFile: number; fromHistory: number; discarded: number }
  >(null);
  /** Importação que DEU CERTO. Fica na tela pelo mesmo motivo do bloco acima:
   *  o toast some em três segundos, e quem acabou de trazer dez anos de
   *  história merece ver, com calma, o que entrou. */
  const [imported, setImported] = useState<
    null | { accepted: number; label: string; duplicates: number; discarded: number }
  >(null);
  const [readFailure, setReadFailure] = useState<{ kind: ReadFailure; name: string } | null>(null);
  const [result, setResult] = useState<AnyImportResult | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [dup, setDup] = useState<boolean[]>([]);
  /** A conferência do que já está no histórico rodou? `false` significa que
   *  não deu para conferir — não que não há duplicata. */
  const [dupCheckOk, setDupCheckOk] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  // Identidade do arquivo lido. O `hash` é o que reconhece a reimportação:
  // sem ele, o mesmo export abriria uma fonte nova a cada envio.
  const [file, setFile] = useState<{ name: string; hash: string } | null>(null);
  /** Quando este mesmo arquivo já entrou antes — data da importação anterior. */
  const [seenBefore, setSeenBefore] = useState<{ at: string; deleted: boolean } | null>(null);

  /* Cancelamento. Arquivo de 876 MB sem como desistir é armadilha: a pessoa
     escolheu errado, ou está no 4G, e a única saída seria fechar o app. */
  const abortRef = useRef<AbortController | null>(null);
  const canceladoRef = useRef(false);

  const reset = () => {
    setResult(null); setChecked([]); setDup([]); setDupCheckOk(true);
    setUnknownFile(null); setEmptyExport(null); setNothingNew(null); setImported(null);
    setProgress(0);
    setFile(null); setSeenBefore(null); setReadProgress(null); setReadFailure(null);
  };

  const cancelarLeitura = () => {
    canceladoRef.current = true;
    abortRef.current?.abort();
  };

  /**
   * Já registrado? Vem DESMARCADO — reimportar o mesmo export não duplica.
   *
   * DUAS REGRAS, e usar a errada foi o pior bug desta tela: a revisão oferecia
   * "1.010 novos", a gravação considerava tudo já existente e gravava ZERO.
   *
   * • JÁ IMPORTAMOS ESTE ARQUIVO ANTES (mesmo hash → mesma fonte): a pergunta
   *   é o que AQUELA FONTE já gravou, pela chave (data_source_id,
   *   source_record_key) — exatamente o que `saveImportedEvents` consulta na
   *   hora de gravar. É a MESMA regra dos dois lados, e é isso que faz a tela
   *   prometer o que ela vai cumprir.
   * • ARQUIVO NOVO: aí não há fonte para perguntar, e a comparação é com o
   *   HISTÓRICO, por tipo e dia — a pessoa pode ter registrado aquela noite à
   *   mão ou por outro arquivo.
   *
   * `checked: false` quer dizer "a conferência NÃO rodou", que é diferente de
   * "não há duplicata" — e a tela diz qual dos dois.
   */
  const marcarDuplicados = async (
    parsed: AnyImportResult, fonteAnterior: DataSource | null,
  ): Promise<{ duplicates: boolean[]; checked: boolean }> => {
    const nenhum = parsed.events.map(() => false);
    if (!user || !parsed.range) return { duplicates: nenhum, checked: false };

    // Caminho 1: a fonte já existe. Pergunta a ela, não ao calendário.
    if (fonteAnterior) {
      const jaGravadas = await existingRecordKeys("life_events", user.id, fonteAnterior.id);
      return { duplicates: markAlreadyImported(parsed.events, jaGravadas), checked: true };
    }

    // Caminho 2: arquivo novo, comparação com o histórico por tipo e dia.
    const kinds = [...new Set(parsed.events.map((ev) => ev.kind))];
    const { data, error } = await supabase.from("life_events")
      .select("kind,occurred_at")
      .eq("user_id", user.id)
      .in("kind", kinds)
      .gte("occurred_at", `${parsed.range.from}T00:00:00-03:00`)
      .lte("occurred_at", `${parsed.range.to}T23:59:59-03:00`)
      .limit(HISTORICO_MAX);
    // Falha aqui não impede a importação, mas NÃO PODE PASSAR CALADA: sem a
    // conferência, tudo volta marcado, e "nada duplicado" é exatamente o que
    // a tela mostraria se não houvesse nenhuma duplicata mesmo. A pessoa
    // precisa saber que a conferência não rodou para decidir com os olhos.
    if (error) {
      console.error("checagem de duplicatas", error.message);
      return { duplicates: nenhum, checked: false };
    }
    const linhas = data ?? [];
    // O SERVIDOR corta a resposta (o PostgREST tem teto próprio de linhas), e
    // uma lista cortada faz a revisão chamar de NOVO o que já está gravado —
    // foi assim que a tela ofereceu 1.010 registros que a gravação recusou
    // inteiros. Se veio cheio, a conferência não é confiável e a tela avisa.
    if (linhas.length >= HISTORICO_MAX) {
      console.error("conferência de duplicatas truncada pelo servidor", linhas.length);
      return { duplicates: nenhum, checked: false };
    }
    const existentes = new Set(
      linhas.map((r) => `${r.kind}|${dateISOInSP(String(r.occurred_at))}`),
    );
    return {
      duplicates: parsed.events.map((ev) => existentes.has(`${ev.kind}|${ev.day}`)),
      checked: true,
    };
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    reset();
    setReading(true);
    canceladoRef.current = false;

    try {
      /* Roteamento por EXTENSÃO, não por adivinhação de conteúdo: o CSV é
         texto e cabe na memória; o export do App Saúde não cabe, e tentar
         `fileToText` num zip de 876 MB derruba a aba antes de qualquer
         mensagem aparecer. */
      const apple = isAppleFile(picked.name);

      let parsed: AnyImportResult | null;
      let hash: string;

      if (apple) {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const outcome = await readAppleHealthFile(picked, {
          signal: ctrl.signal,
          onProgress: setReadProgress,
        });
        // O leitor distingue "não é do App Saúde" de "é, mas está vazio", e a
        // tela precisa dizer coisas diferentes para cada um.
        if (outcome.status === "vazio") { setEmptyExport(picked.name); return; }
        parsed = outcome.status === "ok" ? outcome.result : null;
        // Impressão digital em vez de hash do conteúdo: ver
        // fingerprintLargeFile() para o motivo (o arquivo não cabe na memória).
        hash = await fingerprintLargeFile(picked);
      } else {
        const text = await fileToText(picked);
        parsed = parseHealthCsv(text);
        // Hash do TEXTO, não dos bytes: é a leitura de texto que alimenta o
        // parser, então tem de ser sempre a mesma representação.
        hash = await hashFile(text);
      }

      // Formato desconhecido: dizer com todas as letras. Fingir que importou é
      // exatamente a reclamação que originou esta tela.
      if (!parsed || !parsed.events.length) {
        setUnknownFile(picked.name);
        return;
      }

      setFile({ name: picked.name, hash });
      let previous: DataSource | null = null;
      if (user) {
        previous = await findSourceByHash(user.id, hash);
        /* Fonte EXCLUÍDA continua valendo para reconhecer o arquivo, e é de
           propósito: excluir a fonte tira a TRILHA da lista, não os registros
           do histórico (é o que a própria tela de Fontes promete). Se
           ignorássemos a fonte apagada, reimportar o mesmo arquivo duplicaria
           tudo que continua lá — o oposto do que a pessoa pediu ao excluir.
           O que muda é o texto: ela precisa saber que a trilha some, e os
           registros não. */
        setSeenBefore(previous
          ? { at: previous.created_at, deleted: previous.status === "deleted" }
          : null);
      }

      const { duplicates, checked: dupOk } = await marcarDuplicados(parsed, previous);
      setResult(parsed);
      setDup(duplicates);
      setDupCheckOk(dupOk);
      setChecked(duplicates.map((d) => !d));
    } catch (err) {
      /* CANCELAR NÃO É ERRO. Toast vermelho para quem apertou "cancelar"
         transforma uma escolha da pessoa em falha do app. */
      if (canceladoRef.current) {
        toast.info("Leitura cancelada. Nada foi importado.");
        reset();
        return;
      }
      setReadFailure({ kind: classifyFailure(err), name: picked.name });
    } finally {
      setReading(false);
      setReadProgress(null);
      abortRef.current = null;
    }
  };

  const confirm = async () => {
    if (!user || !result) return;
    const selected = result.events.filter((_, i) => checked[i]);
    if (!selected.length) { toast.info("Marque ao menos um registro para importar."); return; }

    const apple = result.format === "apple_health";
    setSaving(true);
    setProgress(0);
    // Declarada FORA do try: se a gravação estourar no meio, o catch precisa
    // conseguir marcar esta fonte como falha em vez de deixá-la eternamente
    // em "previewed", mentindo que a importação está só aguardando.
    let source: DataSource | null = null;
    try {
      // ── 1. A fonte. SEM ELA NÃO GRAVAMOS NADA — mesma regra da fatura
      //    (useStatementConfirm.tsx), e pelo mesmo motivo.
      //
      //    O índice único que impede o mesmo registro de entrar duas vezes é
      //    PARCIAL: só vale quando `data_source_id` E `source_record_key`
      //    existem na linha (setup.sql). E `saveImportedEvents` só escreve as
      //    duas quando recebe `dataSourceId`. Gravar sem a trilha desligava a
      //    proteção EXATAMENTE no caminho de erro — que é onde a pessoa tenta
      //    de novo. Um CSV de 555 noites viraria 1.110 registros no histórico,
      //    e todo indicador que soma noites passaria a contar cada uma duas
      //    vezes, sem nada para desfazer.
      //
      //    Perder a tentativa é barato: o hash reconhece o mesmo arquivo no
      //    reenvio, e o que já entrou volta desmarcado.
      try {
        source = await createSource({
          userId: user.id,
          // O export do App Saúde é outra coisa que um CSV de um app só: um
          // arquivo, vários tipos, e vindo do aparelho. A distinção aparece na
          // tela de Fontes, onde a pessoa vai procurar o que trouxe.
          kind: apple ? "health_export" : "health_csv",
          displayName: file?.name ?? (apple ? "Export do App Saúde" : "Arquivo de saúde"),
          fileHash: file?.hash ?? null,
          parserVersion: apple ? APPLE_PARSER_VERSION : PARSER_VERSION,
          periodStart: result.range?.from ?? null,
          periodEnd: result.range?.to ?? null,
        });
      } catch (e) {
        console.error("fonte do arquivo de saúde", e);
        toast.error(
          "Não consegui abrir a trilha deste arquivo, então NÃO gravei nada. "
          + "Tente de novo — reenviar o mesmo arquivo é seguro.",
        );
        return;
      }

      // ── 2. Os registros. `source.id` sempre presente: é o par
      //    (data_source_id, source_record_key) que o índice único enxerga.
      const { accepted, duplicates } = await saveImportedEvents(
        user.id, selected,
        (done, total) => setProgress(Math.round((done / total) * 100)),
        { dataSourceId: source.id },
      );

      // ── 3. As contas do recibo, particionando os REGISTROS RECONHECIDOS.
      //
      //    A unidade é a mesma dos dois lados, e isso é o ponto: `stats.rows`
      //    são LINHAS do arquivo, e o parser agrupa linhas em sessões (1.500
      //    linhas de exercício viram 40 treinos). Gravar total=1.500 ao lado
      //    de aceitos=40 fazia o recibo, lido seis meses depois, parecer que
      //    1.460 registros evaporaram numa importação que deu certo. A
      //    contagem de linhas cruas vai para os avisos, onde ela explica em
      //    vez de acusar.
      //
      //    "Duplicado" tem três origens e todas contam: o que já veio deste
      //    mesmo arquivo antes, o que o próprio arquivo repetia no mesmo dia,
      //    e o que a pessoa deixou desmarcado porque já estava no histórico.
      //    `stats.duplicates` (registros que o próprio arquivo repetia e o
      //    parser colapsou) NÃO entra: eles nunca viraram evento reconhecido,
      //    e somá-los fazia a partição dar 1.999 numa revisão de 1.998. Vão
      //    para os avisos, como as linhas ilegíveis.
      const leftOutAsExisting = result.events.filter((_, i) => dup[i] && !checked[i]).length;
      const duplicateRows = duplicates + leftOutAsExisting;
      //    E o que ela desmarcou POR ESCOLHA — que antes não entrava em conta
      //    nenhuma e sumia do recibo: 100 noites, 70 importadas, e as 30 que
      //    ela deixou de fora não estavam em lugar algum.
      const discardedRows = result.events.filter((_, i) => !checked[i] && !dup[i]).length;
      const outcome = importOutcome({
        acceptedRows: accepted,
        duplicateRows,
        discardedRows,
        unreadableLines: result.stats.skipped,
      });
      // No export misto o rótulo composto só vale se TUDO que foi selecionado
      // entrou; se o banco deduplicou parte, ele passaria a descrever mais do
      // que gravou — aí é melhor a frase genérica do buildReceiptSummary.
      const acceptedLabel = apple
        ? (accepted === selected.length ? appleHealthLabel(selected) : undefined)
        : formatLabel(result.format as HealthCsvFormat, accepted);
      const summary = buildReceiptSummary({
        acceptedRows: accepted, duplicateRows, rejectedRows: outcome.rejectedRows, acceptedLabel,
      });

      let receipt: ImportReceipt | null = null;
      {
        const warnings: ImportWarning[] = [];
        if (result.stats.truncated > 0) {
          warnings.push({
            code: "teto_importacao",
            message: truncationMessage(result.stats),
            count: result.stats.truncated,
          });
        }
        // Linha ilegível: fora da partição (nunca virou registro), mas dita.
        if (result.stats.skipped > 0) {
          // Sem `count`: a tela mostra "(46×)" ao lado, e "46 linhas não deram
          // para ler (46×)" lê como se o aviso tivesse acontecido 46 vezes.
          // O número já está na frase.
          warnings.push({
            code: "linha_ilegivel",
            message: result.stats.skipped === 1
              ? "1 linha do arquivo não deu para ler."
              : `${result.stats.skipped.toLocaleString("pt-BR")} linhas do arquivo não deram para ler.`,
          });
        }
        // As linhas cruas explicam a diferença entre o que o arquivo tinha e
        // o que virou registro — sem isso, agrupar parece perder dado.
        if (result.stats.rows !== outcome.totalRows) {
          warnings.push({
            code: "linhas_lidas",
            message: `${plural(result.stats.rows, "linha lida", "linhas lidas")} do arquivo `
              + `${result.stats.rows === 1 ? "virou" : "viraram"} `
              + `${plural(outcome.totalRows, "registro", "registros")}.`,
          });
        }
        if (result.stats.duplicates > 0) {
          warnings.push({
            code: "repetidos_no_arquivo",
            message: result.stats.duplicates === 1
              ? "1 registro vinha repetido no próprio arquivo, no mesmo dia, e foi unido a outro."
              : `${result.stats.duplicates.toLocaleString("pt-BR")} registros vinham repetidos no próprio arquivo, no mesmo dia, e foram unidos.`,
          });
        }
        receipt = await createReceipt({
          sourceId: source.id,
          userId: user.id,
          totalRows: outcome.totalRows,
          acceptedRows: accepted,
          duplicateRows,
          rejectedRows: outcome.rejectedRows,
          warnings,
          summary,
        });
        // 'partial' quer dizer UMA coisa: o arquivo tinha linha que não deu
        // para ler. Desmarcar 30 noites é a revisão funcionando, e não pode
        // deixar a fonte marcada para sempre como importação incompleta.
        await (outcome.status === "partial"
          ? markSourcePartial(source.id)
          : confirmSource(source.id));
      }

      // ── 4. O marco: +15 XP por importação, uma vez POR FONTE. Reimportar o
      //    mesmo arquivo não paga de novo.
      const awarded = accepted > 0 ? await awardImportMilestone(source.id) : false;

      // NADA ENTROU: a tela FICA, e explica. Fechar o painel sem palavra
      // nenhuma é o modo de falha mais caro possível aqui — a pessoa acabou de
      // ler "1.010 selecionados", clicou em importar, e o silêncio diz que deu
      // certo. Toast não basta: some em três segundos e pode nem aparecer.
      if (accepted === 0) {
        setNothingNew({
          fromThisFile: duplicates,
          fromHistory: leftOutAsExisting,
          discarded: discardedRows,
        });
        setResult(null);
        qc.invalidateQueries();
        return;
      }

      // §4.4: nenhum fluxo diz "absorvido" sem recibo persistente. Se o recibo
      // não nasceu, os registros ENTRARAM (isso é verdade e não vamos
      // esconder) mas não há o que auditar depois — e a tela diz isso.
      if (receipt) {
        toast.success(awarded ? `${summary.replace(/\.$/, "")} · +15 XP` : summary);
      } else {
        toast.warning(
          `${summary.replace(/\.$/, "")} — mas não consegui emitir o recibo desta importação. `
          + "Os registros estão no seu histórico; a trilha do arquivo, não.",
        );
      }
      // O resumo FICA na tela, como no caso em que nada entra. Depois de
      // trazer dez anos de história, ver o painel sumir e sobrar um toast de
      // três segundos é perder justamente a hora de conferir o que entrou.
      setImported({
        accepted,
        label: acceptedLabel ?? plural(accepted, "registro", "registros"),
        duplicates: duplicateRows,
        discarded: discardedRows,
      });
      setResult(null);
      setChecked([]);
      setDup([]);
      qc.invalidateQueries();
    } catch {
      // A fonte fica marcada como falha: sem isso ela apareceria em Fontes
      // como "não confirmada", sugerindo que basta confirmar.
      if (source) {
        try { await markSourceFailed(source.id); } catch { /* nada mais a fazer */ }
      }
      toast.error("Não consegui gravar tudo. Nada foi perdido — tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = checked.filter(Boolean).length;
  const porTipo = result ? countByKind(result.events) : [];
  /* Cor de destaque do cabeçalho: a do tipo, quando há um só. Com tipos
     mistos vira dourado — três cores de pilar disputando a mesma borda viram
     semáforo, e o cabeçalho deixa de ser legível de relance. */
  const accent = porTipo.length === 1
    ? `hsl(var(${KIND_META[porTipo[0].kind]?.colorVar ?? "--gold"}))`
    : "hsl(var(--gold))";

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        /* .zip e .xml entram para o export do App Saúde; .csv continua o
           caminho dos apps individuais. */
        accept=".csv,.zip,.xml,text/csv,text/plain,application/zip,application/xml,text/xml"
        className="hidden"
        onChange={onPick}
      />

      {/* ── Estado inicial ───────────────────────────────────────────── */}
      {!result && !unknownFile && !emptyExport && !nothingNew && !imported
        && !readFailure && !reading && (
        <>
          <p className="text-sm text-muted-foreground">
            Traga o histórico que já existe nos seus outros aplicativos. O arquivo é lido{" "}
            <strong>aqui no seu aparelho</strong>, sem passar por IA — nada é interpretado ou
            resumido, e cada registro entra com a data original.
          </p>

          {/* O caminho do iPhone primeiro: é UM arquivo que traz sono, treino,
              peso e água de uma vez, então resolve mais que qualquer CSV. */}
          <div className="rounded-xl border p-3 space-y-1.5">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--vitalidade))" }} />
              Tudo de uma vez, do iPhone
            </p>
            <p className="text-xs text-muted-foreground">
              No iPhone: <strong>Ajustes do app Saúde</strong> → toque na sua foto de perfil →{" "}
              <strong>Exportar todos os dados de saúde</strong>. Depois traga o{" "}
              <code className="rounded bg-muted px-1">.zip</code> para cá — ele vem com sono,
              treino, peso e hidratação juntos.
            </p>
            <p className="text-[11px] text-muted-foreground">
              O arquivo costuma passar de 500 MB. Ele é lido no aparelho, em partes, e nunca
              é enviado para nenhum servidor.
            </p>
          </div>

          {/* A lista de apps vem de SUPPORTED_SOURCES: mantê-la à mão aqui já
              tinha deixado a tela desatualizada uma vez. Fica recolhida porque
              é longa, e a promessa honesta é a FORMA das colunas, não a marca —
              por isso "e outros". */}
          <details className="rounded-xl border p-3">
            <summary className="text-sm font-medium cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              Ou um CSV de um app específico
            </summary>
            <div className="mt-2 space-y-2">
              {SUPPORTED_SOURCES.map((grupo) => (
                <div key={grupo.brings}>
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <Check className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--success))" }} />
                    {grupo.brings}
                  </p>
                  <p className="text-[11px] text-muted-foreground pl-4">
                    {grupo.app} e outros
                  </p>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">
                O que vale é o formato das colunas, não a marca do app: um export não citado
                funciona se tiver as mesmas colunas.
              </p>
            </div>
          </details>

          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="w-3.5 h-3.5 mr-1.5" /> Escolher arquivo
          </Button>
        </>
      )}

      {/* ── Leitura em andamento ─────────────────────────────────────────
          O export de 876 MB leva ~10 s no desktop e bem mais no celular. Sem
          barra e sem cancelar, a tela parece travada e a única saída seria
          fechar o app. */}
      {reading && (
        <div className="rounded-xl border p-3.5 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
            {readProgress ? "Lendo o export do App Saúde..." : "Lendo o arquivo..."}
          </p>
          {readProgress && (
            <>
              <Progress value={Math.round(readProgress.ratio * 100)} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {mb(readProgress.read)} de {mb(readProgress.total)}
                {readProgress.xmlBytes > 0 && (
                  <> · {mb(readProgress.xmlBytes)} de dados já lidos</>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Arquivo grande demora — ele está sendo lido em partes, aqui no seu aparelho.
              </p>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={cancelarLeitura}>
                <X className="w-3.5 h-3.5 mr-1.5" /> Cancelar
              </Button>
            </>
          )}
        </div>
      )}

      {/* ── Formato desconhecido: nunca fingir que importou ──────────── */}
      {imported && (
        <div className="rounded-xl border p-4 space-y-2.5">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--success))" }} />
            {imported.label} no seu histórico
          </p>
          <p className="text-sm text-muted-foreground">
            {imported.duplicates > 0 && (
              <>
                <strong>{imported.duplicates.toLocaleString("pt-BR")}</strong>{" "}
                {imported.duplicates === 1 ? "já estava" : "já estavam"} registrados e não
                {imported.duplicates === 1 ? " entrou" : " entraram"} de novo.{" "}
              </>
            )}
            {imported.discarded > 0 && (
              <>
                Você deixou <strong>{imported.discarded.toLocaleString("pt-BR")}</strong> de fora
                na revisão.{" "}
              </>
            )}
            O recibo desta importação — com o que entrou, o que já existia e os avisos do
            arquivo — fica guardado em <strong>Fontes e importações</strong>, em Ajustes.
          </p>
          <div className="flex flex-wrap gap-2 pt-0.5">
            <Button variant="outline" size="sm" onClick={() => { reset(); fileRef.current?.click(); }}>
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Importar outro arquivo
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>Fechar</Button>
          </div>
        </div>
      )}

      {nothingNew && (
        <div className="rounded-xl border p-4 space-y-2.5">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--success))" }} />
            Nada novo entrou — e está tudo certo
          </p>
          <p className="text-sm text-muted-foreground">
            {nothingNew.fromThisFile > 0 && (
              <>
                <strong>{nothingNew.fromThisFile.toLocaleString("pt-BR")}</strong>{" "}
                {nothingNew.fromThisFile === 1 ? "registro já tinha vindo" : "registros já tinham vindo"}
                {" "}deste mesmo arquivo numa importação anterior.{" "}
              </>
            )}
            {nothingNew.fromHistory > 0 && (
              <>
                <strong>{nothingNew.fromHistory.toLocaleString("pt-BR")}</strong>{" "}
                {nothingNew.fromHistory === 1 ? "já estava" : "já estavam"} no seu histórico, no
                mesmo dia.{" "}
              </>
            )}
            {nothingNew.discarded > 0 && (
              <>
                Você deixou <strong>{nothingNew.discarded.toLocaleString("pt-BR")}</strong> de fora
                na revisão.{" "}
              </>
            )}
            Seu histórico continua igual: <strong>nenhum registro foi duplicado</strong>, e o
            recibo desta tentativa está em Fontes e importações.
          </p>
          <div className="flex flex-wrap gap-2 pt-0.5">
            <Button variant="outline" size="sm" onClick={() => { reset(); fileRef.current?.click(); }}>
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Importar outro arquivo
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>Fechar</Button>
          </div>
        </div>
      )}

      {emptyExport && (
        <div className="rounded-xl border p-4 space-y-2.5">
          <p className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--warning))" }} />
            "{emptyExport}" é um export do App Saúde, mas veio vazio
          </p>
          <p className="text-sm text-muted-foreground">
            Abri o arquivo e ele está no formato certo — só não tem nenhum registro dentro.
            Isso costuma acontecer quando a exportação é interrompida no iPhone antes de
            terminar. <strong>Não importei nada</strong>.
          </p>
          <p className="text-sm text-muted-foreground">
            Refaça a exportação (Ajustes do app Saúde → sua foto de perfil →{" "}
            <strong>Exportar todos os dados de saúde</strong>) e espere o iPhone avisar que
            terminou antes de compartilhar o arquivo.
          </p>
          <div className="flex flex-wrap gap-2 pt-0.5">
            <Button variant="outline" size="sm" onClick={() => { reset(); fileRef.current?.click(); }}>
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Escolher outro arquivo
            </Button>
          </div>
        </div>
      )}

      {unknownFile && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3.5 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <FileQuestion className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--warning))" }} />
            Não reconheci o formato de "{unknownFile}"
          </p>
          <p className="text-sm text-muted-foreground">
            Eu leio o <strong>.zip do App Saúde do iPhone</strong> e CSV de apps de sono, treino
            e peso — o que vale é o formato das colunas. Este arquivo não tem nenhum desses
            formatos, então <strong>não importei nada</strong>, em vez de adivinhar números.
          </p>
          <p className="text-sm text-muted-foreground">
            Se for um documento em texto (um exame, um plano, um relatório), leve ao Conselheiro:
            lá o conteúdo é interpretado de verdade.
          </p>
          <div className="flex flex-wrap gap-2 pt-0.5">
            <Button variant="outline" size="sm" onClick={() => { reset(); fileRef.current?.click(); }}>
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Tentar outro arquivo
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link to="/app/conselheiro">
                <MessageCircle className="w-3.5 h-3.5 mr-1.5" /> Levar ao Conselheiro
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* ── Falha de leitura: cada uma com o próximo passo ───────────── */}
      {readFailure && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3.5 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "hsl(var(--warning))" }} />
            {readFailure.kind === "corrompido" && `Não consegui abrir "${readFailure.name}"`}
            {readFailure.kind === "memoria" && "O arquivo é grande demais para este aparelho"}
            {readFailure.kind === "generico" && `Não consegui ler "${readFailure.name}"`}
          </p>
          <p className="text-sm text-muted-foreground">
            {readFailure.kind === "corrompido" && (
              <>O arquivo parece incompleto ou corrompido — costuma acontecer quando o download
                do export foi interrompido. Baixe o export de novo no iPhone e traga o zip
                inteiro, sem descompactar.</>
            )}
            {readFailure.kind === "memoria" && (
              <>A memória do navegador acabou antes de terminar. Tente no computador, ou feche
                as outras abas e tente de novo — o arquivo em si está bem, foi o aparelho que
                não deu conta.</>
            )}
            {readFailure.kind === "generico" && (
              <>Não foi possível ler o conteúdo. Se for um export do App Saúde, traga o{" "}
                <code className="rounded bg-muted px-1">.zip</code> como o iPhone gerou; se for
                CSV, confira se o arquivo abre numa planilha.</>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground">Nada foi importado.</p>
          <Button variant="outline" size="sm" onClick={() => { reset(); fileRef.current?.click(); }}>
            <Upload className="w-3.5 h-3.5 mr-1.5" /> Tentar outro arquivo
          </Button>
        </div>
      )}

      {/* ── Revisão em lote ──────────────────────────────────────────
          O esqueleto (marcar todos, contador, lista, botões) vem do
          BatchReview, o mesmo da revisão de fatura. Aqui ficam só o cabeçalho
          do reconhecimento, o progresso da gravação e o desenho de cada
          linha — que agora precisa dizer QUE TIPO é, porque o export do App
          Saúde mistura sono, treino, peso e água no mesmo arquivo. */}
      {result && (
        <BatchReview
          items={result.events}
          checked={checked}
          dup={dup}
          saving={saving}
          itemsDisabled={saving}
          listClassName="max-h-80 overflow-y-auto overscroll-contain divide-y rounded-lg border"
          itemStyle={{ contentVisibility: "auto", containIntrinsicSize: "0 46px" }}
          itemKey={(ev, i) => `${ev.kind}-${ev.day}-${i}`}
          counterSuffix=" selecionados"
          confirmLabel={<>Importar {selectedCount} selecionado{selectedCount === 1 ? "" : "s"}</>}
          confirmDisabled={!selectedCount}
          onToggle={(i, v) => setChecked((c) => c.map((x, j) => (j === i ? v : x)))}
          onToggleAll={(v) => setChecked(result.events.map(() => v))}
          onCancel={reset}
          onConfirm={confirm}
          header={
            <>
              <div className="rounded-xl border p-3.5 space-y-2" style={{ borderLeftWidth: 3, borderLeftColor: accent }}>
                <p className="text-sm font-medium">
                  Reconheci {recognizedLabel(result)}
                  <span className="text-muted-foreground font-normal"> · {result.format === "apple_health" ? APPLE_HEALTH_SOURCE_LABEL : result.sourceLabel}</span>
                </p>

                {/* Um selo por TIPO presente. Com o export misto, "580 noites,
                    362 treinos e 24 pesagens" numa frase só é difícil de
                    conferir de relance; os selos deixam cada número separado e
                    com a cor da área a que ele pertence. */}
                {porTipo.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {porTipo.map(({ kind, n }) => {
                      const meta = KIND_META[kind];
                      if (!meta) return null;
                      const cor = `hsl(var(${meta.colorVar}))`;
                      return (
                        <span
                          key={kind}
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                          style={{ color: cor, borderColor: `hsl(var(${meta.colorVar}) / 0.35)` }}
                        >
                          <meta.icon className="w-3 h-3 shrink-0" />
                          <strong className="font-semibold">{n.toLocaleString("pt-BR")}</strong>
                          <span className="text-muted-foreground">{meta.plural}</span>
                        </span>
                      );
                    })}
                  </div>
                )}

                {result.range && (
                  <p className="text-xs text-muted-foreground">
                    De {longDate(result.range.from)} a {longDate(result.range.to)}.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {result.stats.rows.toLocaleString("pt-BR")} linhas lidas
                  {result.format === "workout" && ` · agrupadas em ${result.events.length} sessões`}
                  {result.stats.duplicates > 0 && ` · ${result.stats.duplicates} do mesmo dia foram unidas`}
                  {result.stats.skipped > 0 && ` · ${result.stats.skipped} sem dado aproveitável`}
                </p>
                {result.stats.truncated > 0 && (
                  <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
                    {truncationMessage(result.stats)}
                  </p>
                )}
              </div>

              {seenBefore && (
                <p className="text-xs rounded-md border border-primary/30 bg-primary/5 p-2.5">
                  Você já importou este arquivo em{" "}
                  <strong>{shortStamp(seenBefore.at)}</strong>
                  {seenBefore.deleted
                    ? " e removeu a trilha dele depois. Os registros continuam no seu histórico, "
                      + "então eles vêm desmarcados aqui — só o que for novo entra."
                    : ". Pode importar de novo sem medo: o que já está gravado não entra duas "
                      + "vezes, e não rende XP outra vez."}
                </p>
              )}

              {!dupCheckOk && (
                <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
                  Não consegui conferir o que já está no seu histórico agora — então
                  <strong> tudo veio marcado</strong>. Isso é diferente de "não há repetido":
                  se você já importou este período, revise a lista antes de confirmar.
                </p>
              )}

              {dupCheckOk && dup.some(Boolean) && (
                <p className="text-xs text-muted-foreground rounded-md border p-2.5">
                  {dup.filter(Boolean).length} registro{dup.filter(Boolean).length > 1 ? "s já existem" : " já existe"} no
                  seu histórico, no mesmo dia. Vieram <strong>desmarcados</strong> para não duplicar —
                  marque se quiser registrar assim mesmo.
                </p>
              )}
            </>
          }
          progress={saving ? (
            <div className="space-y-1.5">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                Gravando em lotes... {progress}%
              </p>
            </div>
          ) : null}
          footer={
            <p className="text-[11px] text-muted-foreground">
              Os registros entram com a <strong>data original</strong>, não com a de hoje — o
              histórico fica no lugar certo nos Indicadores e no Conselheiro. O arquivo não sai
              do seu aparelho.
            </p>
          }
          renderItem={(ev, _i, isDup) => {
            const meta = KIND_META[ev.kind];
            return (
              <>
                {/* O ícone é por TIPO, não por arquivo: numa lista mista, é ele
                    que diz se aquela linha é uma noite de sono ou uma pesagem. */}
                {meta && (
                  <meta.icon
                    className="w-4 h-4 shrink-0"
                    style={{ color: `hsl(var(${meta.colorVar}))` }}
                    aria-hidden
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {eventDetail(ev)}
                    {isDup && <DuplicateBadge />}
                  </p>
                  <p className="text-xs text-muted-foreground">{longDate(ev.day)}</p>
                </div>
                {!!ev.muscles?.length && (
                  <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">
                    {ev.muscles.join(", ")}
                  </span>
                )}
              </>
            );
          }}
        />
      )}

    </div>
  );
}

/** Traduz a exceção da leitura no tipo de falha que a tela sabe explicar.
 *
 *  `AppleHealthReadError` é o que o leitor lança para zip inválido ou
 *  incompleto. Estouro de memória chega como RangeError ou como erro de
 *  alocação do próprio motor — não há tipo padrão, então olhamos o nome e a
 *  mensagem. O resto cai em genérico, que também tem próximo passo. */
function classifyFailure(err: unknown): ReadFailure {
  if (err instanceof AppleHealthReadError) return "corrompido";
  if (err instanceof RangeError) return "memoria";
  const texto = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/alloc|memory|heap|quota/i.test(texto)) return "memoria";
  return "generico";
}
