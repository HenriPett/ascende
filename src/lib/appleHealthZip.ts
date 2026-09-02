// ASCENDE — Importação do App Saúde: a camada de I/O (abrir o zip e alimentar
// o parser).
//
// O ARQUIVO REAL: 39 MB de zip que viram 876 MB de XML. Isso decide tudo aqui.
//   • `readAsText`/`file.text()` estão fora: a string de 876 MB estoura a aba
//     antes de o parser ver o primeiro registro.
//   • Descompactar o zip inteiro na memória também: seria a mesma string.
// A única saída é STREAM: ler o zip aos pedaços, inflar aos pedaços, e passar
// cada pedaço para o scanner, que só guarda totais por dia. A memória fica
// constante e proporcional ao PEDAÇO, não ao arquivo.
//
// POR QUE fflate, E NÃO DecompressionStream
// `DecompressionStream('deflate-raw')` existe no navegador e descomprime bem —
// mas não lê a ESTRUTURA do zip. Para chegar em `apple_health_export/exportar.xml`
// no meio de centenas de .gpx seria preciso escrever o leitor de diretório
// central à mão (já fiz isso no webhook do WhatsApp, para arquivos pequenos) e,
// pior, o zip do App Saúde é grande demais para localizar a entrada relendo o
// arquivo: precisaríamos de acesso aleatório ao File. A `Unzip` da fflate faz o
// streaming por entrada, com ~8 KB, e deixa PULAR as entradas que não
// interessam sem descomprimir nenhum byte delas — que é o que faz os .gpx
// saírem de graça.
//
// POR QUE UM WEB WORKER — E POR QUE O RACIOCÍNIO ANTERIOR ESTAVA ERRADO
// Este comentário já disse o contrário: que a conta acontecia "em pedaços
// entre awaits" e que a interface continuava respondendo. A medição desmentiu,
// com o arquivo real de 39 MB:
//
//   • maior intervalo SEM NENHUM QUADRO DE TELA: 15.982 ms
//   • 731 quadros na sessão inteira, TODOS fora da janela de leitura
//   • um setInterval(200ms) disparou 62 vezes e só 4 com a tela de leitura
//     visível — todas depois dos 16 s, já com a barra em 100%
//
// O erro do raciocínio: `await reader.read()` só devolve a thread quando há
// espera DE VERDADE. Lendo um arquivo local, o pedaço já está pronto, a
// promessa resolve na microtask seguinte, e `unzip.push` + o scanner rodam
// SÍNCRONOS ali dentro. Resultado: a barra de progresso e o botão Cancelar que
// construímos não existiam na prática — a pessoa via a tela morta por 16 s (e
// bem mais num iPhone), sem saída. É o pior momento possível do app.
//
// Agora a leitura roda num Worker: a thread principal só recebe mensagens de
// progresso e o resultado no fim. Cancelar virou `terminate()`, que interrompe
// de verdade — o AbortSignal antigo era lido entre pedaços que nunca chegavam
// a rodar. O parser continua puro e vai inteiro para dentro do worker, sem
// nenhuma mudança.
//
// O QUE ESTE ARRANJO ENTREGA, E O QUE NÃO ENTREGA
// Entrega: a aba respira. O QA confirmou que nunca mais travou.
// NÃO entrega velocidade. O tempo total do arquivo real foi medido em 12 s
// (thread principal, congelada), 24 s (worker) e 17-23 s depois de tirar o
// `setTimeout` entre pedaços — com variação grande entre execuções. Ler em
// segundo plano custa algo, e o custo é aceito de propósito: 20 s com barra
// andando e botão de cancelar é melhor que 12 s de tela morta sem saída.
// Se alguém for otimizar, meça antes: as duas tentativas óbvias (tirar o
// yield, afinar as mensagens de progresso) já foram feitas.
//
// NÃO DESFAÇA sem medir de novo: o teste é olhar o maior intervalo entre
// quadros durante a leitura do arquivo real, não a sensação em arquivo pequeno.

import { Unzip, UnzipInflate } from "fflate";
import { createAppleHealthScanner, looksLikeAppleHealth, type AppleHealthResult } from "@/lib/appleHealth";

/** Progresso da leitura, em bytes do arquivo ORIGINAL (o que a pessoa vê como
 *  tamanho no Finder). `total` é o tamanho do arquivo; `read` anda com o que já
 *  foi consumido do zip. */
export interface AppleHealthProgress {
  read: number;
  total: number;
  /** 0..1, pronto para a barra. */
  ratio: number;
  /** Bytes de XML já descompactados — útil para explicar por que demora. */
  xmlBytes: number;
}

export interface ReadAppleHealthOptions {
  onProgress?: (p: AppleHealthProgress) => void;
  /** Ceder a thread entre pedaços. Faz sentido no fallback, que roda na
   *  thread da interface; DENTRO do worker é só espera pura — o setTimeout
   *  tem piso de alguns ms e, com centenas de pedaços, virava segundos de
   *  nada (a leitura do arquivo real passou de ~12 s para ~24 s). */
  yieldBetweenChunks?: boolean;
  /** Cancelamento: a pessoa fechou o diálogo no meio de um arquivo de 39 MB. */
  signal?: AbortSignal;
}

/** Falha de leitura em linguagem de usuário. */
export class AppleHealthReadError extends Error {
  // `name` explícito porque a classe NÃO sobrevive ao postMessage do worker:
  // do outro lado chega um objeto simples, e é por ele que a tela reconhece
  // "zip corrompido" e "cancelado".
  name = "AppleHealthReadError";
}

/**
 * O que a leitura encontrou, para a tela poder ser específica.
 *
 * `vazio` existe porque "é um export do App Saúde, mas não tem registro
 * nenhum" e "não reconheci este arquivo" mandam a pessoa para lugares
 * diferentes: no primeiro, o export foi interrompido no iPhone e o caminho é
 * exportar de novo; no segundo, o arquivo é outro. Dizer "não reconheci" para
 * um export legítimo manda ela procurar defeito onde não tem.
 */
export type AppleHealthOutcome =
  | { status: "ok"; result: AppleHealthResult }
  | { status: "vazio" }
  | { status: "desconhecido" };

/** Nome da entrada do XML dentro do zip. O Apple exporta em
 *  `apple_health_export/exportar.xml` (pt-BR) ou `export.xml` (en). */
const XML_ENTRY = /(^|\/)(exportar|export)\.xml$/i;

/* Pedaço de leitura do arquivo. 1 MB é grande o bastante para o inflate render
   e pequeno o bastante para a interface não travar entre um e outro. */
const READ_CHUNK = 1024 * 1024;

/**
 * Lê o export do App Saúde na THREAD ATUAL.
 *
 * É esta função que roda DENTRO do worker (e no fallback, quando o navegador
 * não tem worker de módulo). Na tela, use `readAppleHealthFile`: chamar esta
 * aqui direto é congelar a interface por dezesseis segundos.
 *
 * Aceita o `.zip` inteiro (o caminho normal, é o que o iPhone manda) ou o
 * `.xml` solto, para quem já descompactou.
 */
export async function readAppleHealthInThread(
  file: File | Blob,
  opts: ReadAppleHealthOptions = {},
): Promise<AppleHealthOutcome> {
  const name = "name" in file ? file.name.toLowerCase() : "";
  const isZip = name.endsWith(".zip") || (!name.endsWith(".xml") && await sniffZip(file));
  return isZip ? readFromZip(file, opts) : readFromXml(file, opts);
}

/** Assinatura "PK\x03\x04" no começo do arquivo. */
async function sniffZip(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AppleHealthReadError("Importação cancelada.");
}

/** XML solto: mesmo streaming, sem a camada de zip. */
async function readFromXml(
  file: File | Blob, opts: ReadAppleHealthOptions,
): Promise<AppleHealthOutcome> {
  const scanner = createAppleHealthScanner();
  const decoder = new TextDecoder("utf-8");
  const total = file.size;
  let read = 0;
  let header = "";

  for await (const bytes of readChunks(file, opts.signal)) {
    read += bytes.length;
    const text = decoder.decode(bytes, { stream: true });
    if (header.length < HEADER_WINDOW) header += text.slice(0, HEADER_WINDOW - header.length);
    scanner.push(text);
    opts.onProgress?.({ read, total, ratio: total ? read / total : 0, xmlBytes: read });
  }
  scanner.push(decoder.decode());
  const result = scanner.finish();
  if (!looksLikeAppleHealth(header) && result.stats.rows === 0) return { status: "desconhecido" };
  return result.events.length ? { status: "ok", result } : { status: "vazio" };
}

/**
 * Zip: acha a entrada do XML, descompacta em stream e joga no scanner.
 *
 * As centenas de `.gpx` de rota de treino são puladas sem custo — o
 * `UnzipInflate` só é ligado na entrada que interessa; nas outras, não
 * chamamos `start()` e a fflate descarta os bytes.
 */
async function readFromZip(
  file: File | Blob, opts: ReadAppleHealthOptions,
): Promise<AppleHealthOutcome> {
  const scanner = createAppleHealthScanner();
  const decoder = new TextDecoder("utf-8");
  const total = file.size;
  let read = 0;
  let xmlBytes = 0;
  let foundXml = false;
  let header = "";
  let failure: Error | null = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (entry) => {
    if (!XML_ENTRY.test(entry.name)) return;   // .gpx e companhia: nem abre
    // SÓ A PRIMEIRA. Um zip com `export.xml` E `exportar.xml` (ou uma segunda
    // cópia numa subpasta) intercalaria dois fluxos no MESMO TextDecoder e no
    // mesmo scanner: uma tag partida pela metade receberia a cauda do outro
    // arquivo, e o registro sairia com dado trocado. Melhor ler um inteiro do
    // que dois pela metade.
    if (foundXml) return;
    foundXml = true;
    entry.ondata = (err, data, final) => {
      if (err) { failure = err; return; }
      xmlBytes += data.length;
      const text = decoder.decode(data, { stream: !final });
      if (header.length < HEADER_WINDOW) header += text.slice(0, HEADER_WINDOW - header.length);
      scanner.push(text);
    };
    entry.start();
  };

  for await (const bytes of readChunks(file, opts.signal)) {
    read += bytes.length;
    unzip.push(bytes, false);
    if (failure) throw new AppleHealthReadError("Não consegui abrir esse zip (pode estar corrompido).");
    opts.onProgress?.({ read, total, ratio: total ? read / total : 0, xmlBytes });
    if (opts.yieldBetweenChunks !== false) await yieldToUi();
  }
  unzip.push(new Uint8Array(0), true);

  // Zip sem exportar.xml: não é do App Saúde.
  if (!foundXml) return { status: "desconhecido" };
  const result = scanner.finish();
  // Achamos o arquivo do App Saúde, mas ele não trouxe registro nenhum: o
  // export foi interrompido no iPhone. É outra conversa que "não reconheci".
  if (!looksLikeAppleHealth(header) && result.stats.rows === 0) return { status: "desconhecido" };
  return result.events.length ? { status: "ok", result } : { status: "vazio" };
}

/* Janela do cabeçalho para reconhecer o arquivo. Generosa de propósito: o
   export real abre com um DTD de vários KB e o elemento <HealthData> só
   aparece depois dele. Com 4 KB, o arquivo legítimo do fundador era recusado. */
const HEADER_WINDOW = 64 * 1024;

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Lê o arquivo em pedaços, preferindo o stream nativo quando existe. */
async function* readChunks(file: Blob, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  abortIfNeeded(signal);
  const streamOf = (file as Blob & { stream?: () => ReadableStream<Uint8Array> }).stream;
  if (typeof streamOf === "function") {
    const reader = streamOf.call(file).getReader();
    try {
      for (;;) {
        abortIfNeeded(signal);
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length) yield value;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  // Sem `stream()` (navegador antigo): fatia o Blob na mão.
  for (let at = 0; at < file.size; at += READ_CHUNK) {
    abortIfNeeded(signal);
    yield new Uint8Array(await file.slice(at, at + READ_CHUNK).arrayBuffer());
  }
}

/* ── A leitura fora da thread principal ───────────────────────────────────
   O protocolo é curto de propósito: o worker recebe o File e devolve
   progresso e resultado. Nada de estado compartilhado, nada de callback
   atravessando a fronteira. */

type WorkerRequest = { file: File | Blob };

export type WorkerResponse =
  | { type: "progress"; progress: AppleHealthProgress }
  | { type: "done"; outcome: AppleHealthOutcome }
  | { type: "error"; name: string; message: string };

/** Nasce um worker de módulo, ou `null` quando o ambiente não tem (teste em
 *  Node, navegador antigo, CSP que barra worker). Aí o chamador cai no
 *  caminho em thread — mais lento de usar, mas melhor que não importar. */
function spawnWorker(): Worker | null {
  if (typeof Worker !== "function") return null;
  try {
    return new Worker(new URL("./appleHealthWorker.ts", import.meta.url), { type: "module" });
  } catch (e) {
    console.error("worker do App Saúde indisponível, lendo na thread principal", e);
    return null;
  }
}

/**
 * Lê o export do App Saúde SEM travar a interface.
 *
 * O File vai por `postMessage` — ele é clonável e o clone não copia os 39 MB:
 * Blob é referência para os bytes, que o navegador guarda fora do heap do JS.
 *
 * CANCELAR agora funciona de verdade. Antes, `signal` era conferido entre
 * pedaços — e os pedaços rodavam num bloco síncrono que nunca soltava a
 * thread, então o botão nem chegava a ser desenhado. `terminate()` mata o
 * worker no meio do inflate, sem esperar nada.
 */
export function readAppleHealthFile(
  file: File | Blob,
  opts: ReadAppleHealthOptions = {},
): Promise<AppleHealthOutcome> {
  const worker = spawnWorker();
  if (!worker) return readAppleHealthInThread(file, opts);

  return new Promise<AppleHealthOutcome>((resolve, reject) => {
    const onAbort = () => {
      encerrar();
      reject(new AppleHealthReadError("Importação cancelada."));
    };
    const encerrar = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === "progress") { opts.onProgress?.(msg.progress); return; }
      encerrar();
      if (msg.type === "done") { resolve(msg.outcome); return; }
      // A classe do erro não atravessa o postMessage: remontamos pelo nome,
      // porque é `instanceof AppleHealthReadError` que a tela usa para dizer
      // "zip corrompido" em vez de "erro inesperado".
      reject(msg.name === "AppleHealthReadError"
        ? new AppleHealthReadError(msg.message)
        : new Error(msg.message));
    };

    worker.onerror = (ev) => {
      encerrar();
      reject(new Error(ev.message || "Falha ao ler o arquivo em segundo plano."));
    };

    if (opts.signal?.aborted) { onAbort(); return; }
    opts.signal?.addEventListener("abort", onAbort);
    worker.postMessage({ file } satisfies WorkerRequest);
  });
}
