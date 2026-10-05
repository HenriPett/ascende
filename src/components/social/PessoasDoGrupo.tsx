import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import CartaoDaPessoa from "@/components/social/CartaoDaPessoa";
import { FichaFantasma } from "@/components/social/FichaDaMetrica";
import type { PessoaDoGrupo } from "@/hooks/useGrupo";

/**
 * O BLOCO DE PESSOAS — a tela.
 *
 * O fundador entra aqui para ver O QUE CADA UM FEZ, então isto é o primeiro
 * pixel abaixo do cabeçalho (e da faixa do desafio, que é uma linha).
 *
 * ─── ELE NÃO TEM CABEÇALHO, E ISSO É A DECISÃO ────────────────────────────
 *
 * O bloco-lista "A semana de cada um" foi eliminado nesta revisão, e o QA
 * pegou o título dele ressuscitado como cabeçalho DESTA seção. Quem abre a
 * tela procurando a ausência encontrava o nome de volta — que é exatamente o
 * efeito que a eliminação queria evitar. Os cartões, com avatar e nome, são
 * auto-evidentes: sobra só o "atualizado há X", alinhado à direita, que é o
 * único texto de que a seção precisa.
 *
 * ALTURAS DESIGUAIS DE PROPÓSITO (`items-start`, sem altura igualada): cartões
 * de tamanhos diferentes reforçam que as vidas são diferentes. Igualar altura
 * é o primeiro passo para o olho ler duas linhas como uma comparação.
 */
export default function PessoasDoGrupo({
  pessoas, atualizadoHa, vigente, terminouEm, semanaIndisponivel, onAbrirConsentimento,
}: {
  pessoas: PessoaDoGrupo[];
  atualizadoHa: string;
  vigente: boolean;
  terminouEm: string;
  /** A consulta da semana falhou. Não é "ninguém compartilha": é "eu não sei". */
  semanaIndisponivel: boolean;
  onAbrirConsentimento: () => void;
}) {
  const ninguemCompartilha = pessoas.every((p) => p.metricas.length === 0);
  /* Num grupo VENCIDO o banco devolve NULL para todo mundo, em toda métrica —
     `total_da_semana` fecha a janela em `least(hoje, ends_on)` e a semana
     corrente já passou do fim. Sem este estado, os quatro cartões escreviam
     "Ainda não compartilha nada.", que é uma frase sobre a ESCOLHA de cada uma
     delas — e falsa sobre quatro pessoas ao mesmo tempo. Pior: o bloco caía no
     estado vazio oferecendo "Escolher o que eu compartilho", num grupo onde não
     há mais nada a compartilhar. É texto, não direito ao número: a janela da
     função não se toca (mexer lá é mexer em RLS). */
  const semNumeros = !vigente || semanaIndisponivel;

  return (
    <Card className="p-4 space-y-3">
      {/* Sem cabeçalho de seção — ver o docblock. Só o relógio, à direita: a
          única pista de que a tela está viva. Sem badge, sem contador de
          novidades, sem ponto vermelho; e se o socket cair, a única coisa que
          acontece é este texto parar de andar. */}
      {!!atualizadoHa && (
        <p className="text-caption2 text-muted-foreground text-right">{atualizadoHa}</p>
      )}

      {!vigente && (
        <p className="text-sm text-muted-foreground">
          Este grupo terminou {dataLonga(terminouEm)}. O que cada um fez fica no registro
          de cada um.
        </p>
      )}

      {vigente && semanaIndisponivel && (
        /* Erro de rede não vira frase sobre a escolha de ninguém. */
        <p className="text-sm text-muted-foreground">
          Os números da semana não carregaram agora. As pessoas do grupo continuam aqui.
        </p>
      )}

      {vigente && !semanaIndisponivel && ninguemCompartilha ? (
        <div className="py-6 text-center space-y-3">
          {/* As fichas-fantasma ensinam a FORMA REAL da tela antes de existir
              dado — tracejadas, sem número, sem fingir um valor que não há. */}
          <div className="flex flex-wrap justify-center gap-2">
            <FichaFantasma texto="Treinos" />
            <FichaFantasma texto="Água" />
          </div>
          <div className="space-y-1">
            <p className="text-subhead">Ninguém publicou nada ainda.</p>
            <p className="text-footnote text-muted-foreground max-w-sm mx-auto">
              Cada pessoa escolhe o que sai daqui — e a meta de cada um vem junto
              com a escolha.
            </p>
          </div>
          <Button variant="outline" className="min-h-11" onClick={onAbrirConsentimento}>
            Escolher o que eu compartilho
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3 items-start">
          {pessoas.map((p) => (
            <CartaoDaPessoa key={p.userId} pessoa={p} semNumeros={semNumeros} />
          ))}
        </div>
      )}

      {/* A FRASE-ÂNCORA. Ela não protege — o Fiel foi explícito: aviso não
          desfaz leitura pré-atentiva, e por isso a régua foi retirada na
          origem em vez de anotada aqui. Ela fica porque é VERDADE, e porque é
          aqui, uma vez só, que a tela responde de vez "por que não aparece
          peso". A doutrina se explica uma vez; não em toda seção, toda vez. */}
      <p className="text-caption2 text-muted-foreground border-t pt-2.5">
        Cada um contra o próprio combinado. Os números de pessoas diferentes não se
        comparam — as metas não são as mesmas. Peso, corpo e dinheiro não aparecem
        aqui em forma nenhuma: o que o grupo vê é o ato (treino, refeição, sono, água),
        nunca o resultado.
      </p>
    </Card>
  );
}

const dataLonga = (iso: string) =>
  iso
    ? `em ${new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}`
    : "";
