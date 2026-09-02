// ASCENDE — O worker que lê o export do App Saúde.
//
// Existe por um número: a leitura do arquivo real (39 MB de zip, 876 MB de
// XML) travava a thread principal por 15.982 ms sem desenhar UM quadro. A
// barra de progresso e o botão Cancelar existiam no código e não existiam na
// tela. Aqui dentro, o mesmo trabalho não disputa a thread com nada.
//
// Este arquivo é de propósito uma casca: toda a lógica está em
// appleHealthZip.ts (I/O) e appleHealth.ts (parsing puro), e as duas rodam
// igual dentro e fora do worker. Quem consertar um caso de leitura mexe lá,
// não aqui — e o fallback em thread continua valendo o mesmo conserto.
import { readAppleHealthInThread, type WorkerResponse } from "@/lib/appleHealthZip";

const responder = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

/* Progresso no máximo a cada 100 ms.
   HIPÓTESE, não medição: o leitor emite progresso a cada pedaço do stream
   (dezenas a centenas num arquivo de 39 MB), e cada mensagem vira um
   `setState` na thread principal — ou seja, uma renderização do componente
   inteiro por pedaço. Dez quadros por segundo já dão barra fluida, e o resto
   é trabalho jogado fora. Se a medição do QA não mudar com isto, o gargalo é
   outro e este comentário fica como o que já foi tentado. */
const PROGRESS_MS = 100;
let ultimoProgresso = 0;

self.onmessage = async (ev: MessageEvent<{ file: File | Blob }>) => {
  try {
    ultimoProgresso = 0;
    const outcome = await readAppleHealthInThread(ev.data.file, {
      onProgress: (progress) => {
        const agora = Date.now();
        // O 100% sempre passa: é ele que fecha a barra antes da revisão.
        if (progress.ratio < 1 && agora - ultimoProgresso < PROGRESS_MS) return;
        ultimoProgresso = agora;
        responder({ type: "progress", progress });
      },
      // Aqui não há interface para ceder: o único efeito seria esperar.
      yieldBetweenChunks: false,
    });
    responder({ type: "done", outcome });
  } catch (e) {
    // O erro vira dado: classe não sobrevive ao postMessage, e é o `name` que
    // a tela usa para separar "zip corrompido" de "erro inesperado".
    const err = e as Error;
    responder({
      type: "error",
      name: err?.name ?? "Error",
      message: err?.message ?? "Falha ao ler o arquivo.",
    });
  }
};
