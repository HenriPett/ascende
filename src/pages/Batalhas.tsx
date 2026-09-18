import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Swords, Plus, Loader2, LifeBuoy, Archive, ArchiveRestore, MessageCircle, UtensilsCrossed } from "lucide-react";
import {
  type Battle, type BattleCheckin as Checkin,
  BATTLE_TEMPLATES, COMMON_TRIGGERS, MILESTONES,
  computeBattleStats, isFoodBattle, battleLabel,
} from "@/lib/battles";
import { CheckinRow } from "@/components/core/BattleCheckin";
import { todayISO } from "@/lib/format";
import FirstTimeTip from "@/components/core/FirstTimeTip";
import QueryError from "@/components/core/QueryError";
import { useGuides } from "@/hooks/useGuides";
import { cn } from "@/lib/utils";

/* ─── Criação ─── */
/* `open` é CONTROLADO pela página porque existe um segundo ponto de entrada: o
   estado vazio, que precisava abrir este mesmo diálogo sem duplicá-lo. Antes o
   cartão vazio apenas DESCREVIA o botão ("Toque em 'Nova batalha'"), e o botão
   descrito vive no topo da tela, fora do campo de visão de quem está lendo o
   cartão — mandar procurar um botão é fricção sem retorno. */
function CreateBattle({
  onCreated, open, onOpenChange,
}: { onCreated: () => void; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const setOpen = onOpenChange;
  const [name, setName] = useState("");
  const [discreet, setDiscreet] = useState("");
  const [triggers, setTriggers] = useState<string[]>([]);
  const [customTrigger, setCustomTrigger] = useState("");
  const [plan, setPlan] = useState(["", "", ""]);
  const [visibleToAi, setVisibleToAi] = useState(true);
  const [saving, setSaving] = useState(false);

  const foodWarning = isFoodBattle(name);
  // O "não às bets" dito no ponto de contato onde ele custa (página /recusas, item 2).
  const betsBattle = /apost|\bbets?\b|raspadinha|tigrinho/i.test(name);

  const applyTemplate = (t: (typeof BATTLE_TEMPLATES)[number]) => {
    setName(t.name);
    setTriggers(t.triggers);
  };

  const toggleTrigger = (t: string) =>
    setTriggers((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const addCustomTrigger = () => {
    const t = customTrigger.trim().toLowerCase();
    if (t && !triggers.includes(t)) setTriggers((s) => [...s, t]);
    setCustomTrigger("");
  };

  const create = async () => {
    if (!user || !name.trim()) { toast.error("Dê um nome à batalha."); return; }
    if (foodWarning) return; // o aviso na tela já redireciona
    const emergency = plan.map((p) => p.trim()).filter(Boolean);
    if (!emergency.length) {
      toast.error("Defina pelo menos 1 ação para o plano de emergência — é ele que te segura na hora da vontade.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("battles").insert({
      user_id: user.id,
      name: name.trim(),
      discreet_name: discreet.trim() || null,
      triggers,
      emergency_plan: emergency,
      visible_to_ai: visibleToAi,
    });
    setSaving(false);
    if (error) { toast.error("Não consegui criar a batalha. Tente de novo."); return; }
    toast.success("Batalha criada. O primeiro check-in é hoje à noite — um dia de cada vez.");
    setOpen(false);
    setName(""); setDiscreet(""); setTriggers([]); setPlan(["", "", ""]); setVisibleToAi(true);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="shrink-0"><Plus className="w-4 h-4 mr-1.5" /> Nova batalha</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Nova batalha</DialogTitle>
          <DialogDescription>
            Uma luta pessoal que você escolheu enfrentar. Aqui vale honestidade, não perfeição.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Templates */}
          <div className="flex flex-wrap gap-1.5">
            {BATTLE_TEMPLATES.map((t) => (
              <button
                key={t.name}
                onClick={() => applyTemplate(t)}
                title={t.hint}
                className={cn(
                  "text-xs rounded-full border px-3 py-1.5 transition-colors",
                  name === t.name ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                )}
              >
                {t.name}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bname">Contra o que você está lutando?</Label>
            <Input id="bname" maxLength={60} value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Escolha acima ou escreva a sua" />
          </div>

          {foodWarning && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm space-y-2">
              <p className="font-medium flex items-center gap-1.5">
                <UtensilsCrossed className="w-4 h-4 text-vitalidade" /> Comida não é inimigo
              </p>
              <p className="text-muted-foreground text-xs">
                Guerra contra comida costuma alimentar exatamente a compulsão que se quer vencer.
                O caminho que funciona é construir o positivo: um hábito como <em>"fazer uma refeição
                de verdade"</em> em Vitalidade. Se a questão for gasto com delivery, crie a
                batalha "Compras por impulso". E se a relação com comida anda pesada, um
                nutricionista ou psicólogo é o melhor aliado que existe.
              </p>
              {/* O compromisso positivo nasce da conversa: o Conselheiro
                  propõe e grava com confirmação, que é o caminho que sobrou
                  quando a lista de hábitos saiu da Vitalidade — ela era
                  transversal e vivia no pilar errado. */}
              <Button asChild size="sm" variant="outline">
                <Link to={`/app/conselheiro?q=${encodeURIComponent("Me ajude a criar um compromisso diário positivo com a comida, em vez de uma batalha contra ela")}`}>
                  Criar compromisso positivo
                </Link>
              </Button>
            </div>
          )}

          {betsBattle && !foodWarning && (
            <div className="rounded-md border border-gold/40 bg-gold/5 p-3 text-sm space-y-1">
              <p className="font-medium">Você não está só nessa</p>
              <p className="text-muted-foreground text-xs">
                O Ascende jamais aceitará anúncio de casa de aposta — seria lucrar duas vezes
                com a sua queda. Esta batalha é sua, e nós estamos do seu lado dela. É promessa
                pública, assinada na nossa página <a href="/recusas" target="_blank" rel="noreferrer" className="underline underline-offset-2">O que o Ascende recusa</a>.
              </p>
            </div>
          )}

          {!foodWarning && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="bdiscreet">Nome discreto (opcional)</Label>
                <Input id="bdiscreet" maxLength={40} value={discreet} onChange={(e) => setDiscreet(e.target.value)}
                  placeholder='Ex.: "Batalha 1" — aparece no lugar do nome real' />
                <p className="text-xs text-muted-foreground">
                  É o que aparece na tela Hoje e nas listas — o nome real fica só aqui dentro.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Quando costuma bater?</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set([...COMMON_TRIGGERS, ...triggers])].map((t) => (
                    <button key={t} onClick={() => toggleTrigger(t)}
                      className={cn(
                        "text-xs rounded-full border px-2.5 py-1 transition-colors",
                        triggers.includes(t) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                      )}>
                      {t}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input maxLength={30} value={customTrigger} onChange={(e) => setCustomTrigger(e.target.value)}
                    placeholder="Outro gatilho..." className="text-sm"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTrigger(); } }} />
                  <Button type="button" variant="secondary" onClick={addCustomTrigger}>Adicionar</Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Plano de emergência — o que você VAI fazer quando a vontade bater?</Label>
                {plan.map((p, i) => (
                  <Input key={i} maxLength={80} value={p}
                    onChange={(e) => setPlan((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={["1. Ex.: levantar e beber um copo d'água", "2. Ex.: sair do quarto", "3. Ex.: mandar mensagem pro meu irmão (opcional)"][i]} />
                ))}
                <p className="text-xs text-muted-foreground">
                  Ações físicas e imediatas funcionam melhor que força de vontade.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="pr-3">
                  <p className="text-sm font-medium">O Conselheiro pode ver esta batalha</p>
                  <p className="text-xs text-muted-foreground">
                    Com acesso, o Conselheiro cruza recaídas com sono, humor e gastos e te mostra os padrões.
                    Desligando, ela fica invisível para ele — só você vê.
                  </p>
                </div>
                <Switch checked={visibleToAi} onCheckedChange={setVisibleToAi} aria-label="Visível para o Conselheiro" />
              </div>

              <Button className="w-full" onClick={create} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Começar a batalha"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── SOS ─── */
function SosDialog({ battle }: { battle: Battle }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="border-gold/40 text-gold-ink hover:text-gold-ink">
          <LifeBuoy className="w-4 h-4 mr-1.5" /> Tô com vontade agora
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Respira. Isso passa.</DialogTitle>
          <DialogDescription>
            A vontade é uma onda — ela sobe, faz barulho e desce. Seu plano para agora:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5">
          {battle.emergency_plan.map((step, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border bg-card p-4">
              <span className="font-display font-semibold text-gold-ink text-lg leading-none">{i + 1}</span>
              <p className="text-base font-medium">{step}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2 pt-1">
          <Button asChild className="w-full">
            <Link to="/app/conselheiro"><MessageCircle className="w-4 h-4 mr-1.5" /> Falar com o Conselheiro agora</Link>
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Se resistir, registre "resisti à vontade" no check-in — vale +12 XP, mais que um dia comum.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Página ─── */
export default function Batalhas() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { markSeen } = useGuides();
  /* Um diálogo, dois pontos de entrada: o botão do topo e o cartão do estado
     vazio. Ver o comentário em CreateBattle. */
  const [newBattleOpen, setNewBattleOpen] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["battles", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [battles, archived, checkins] = await Promise.all([
        supabase.from("battles").select("*").eq("user_id", user!.id).eq("active", true).order("created_at"),
        supabase.from("battles").select("*").eq("user_id", user!.id).eq("active", false).order("created_at", { ascending: false }),
        supabase.from("battle_checkins").select("*").eq("user_id", user!.id).order("checkin_date", { ascending: false }).limit(1000),
      ]);
      // Sem isto, uma falha some com as batalhas e a tela oferece o convite de
      // "nenhuma batalha ainda" para quem tem 90 dias limpos acumulados.
      const failed = [battles, archived, checkins].find((r) => r.error);
      if (failed?.error) throw failed.error;
      return {
        battles: (battles.data ?? []) as Battle[],
        archived: (archived.data ?? []) as Battle[],
        checkins: (checkins.data ?? []) as Checkin[],
      };
    },
  });

  const archive = async (b: Battle) => {
    await supabase.from("battles").update({ active: false }).eq("id", b.id);
    toast.success(`"${battleLabel(b)}" arquivada. Os dias limpos que você acumulou ficam guardados — dá para reativar quando quiser, aqui embaixo.`);
    qc.invalidateQueries();
  };

  const restore = async (b: Battle) => {
    await supabase.from("battles").update({ active: true }).eq("id", b.id);
    toast.success(`"${battleLabel(b)}" reativada. Todo o histórico e os dias limpos continuam valendo.`);
    qc.invalidateQueries();
  };

  const today = todayISO();

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      {/* Mesmo padrão da Prosperidade: no celular a ação desce para a própria
          linha, em largura total, em vez de espremer o cabeçalho. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
            <Swords className="w-6 h-6 text-gold" /> Batalhas
          </h1>
          <p className="text-sm text-muted-foreground">
            As lutas que você escolheu enfrentar. Aqui a vitória vem por acumulação — nunca por perfeição.
          </p>
        </div>
        <div className="w-full sm:w-auto [&_button]:w-full sm:[&_button]:w-auto">
          <CreateBattle
            open={newBattleOpen}
            onOpenChange={setNewBattleOpen}
            onCreated={() => { markSeen("batalhas"); qc.invalidateQueries(); }}
          />
        </div>
      </div>

      <FirstTimeTip id="batalhas" />

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {isError && (
        <QueryError
          title="Não consegui carregar suas batalhas."
          detail="Pode ser a conexão — seus dias limpos e seus check-ins continuam salvos."
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      )}

      {!isLoading && !isError && !(data?.battles ?? []).length && (
        <Card className="p-8 text-center">
          <Swords className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          {/* O tom baixo deste cartão é DELIBERADO e continua: aqui um "Comece
              agora!" seria invasivo. O que muda é (a) o título, que abria a
              tela com uma contabilidade de ausência num assunto que é vergonha
              — ler "nenhuma" primeiro soa como cobrança mesmo sem querer — e
              (b) a última frase, que mandava procurar um botão em vez de
              oferecer um. O rótulo condicional ("se fizer sentido") preserva o
              tom, e a linha do nome discreto responde o medo real desta tela. */}
          <p className="font-display font-semibold">Aqui é onde as suas ficam</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            Redes sociais, pornografia, cigarro, apostas, compras por impulso. Se existe algo
            que você enfrenta em silêncio, este é o lugar para enfrentar com método — e sem
            julgamento. O nome pode ser discreto: só você sabe o que ele quer dizer.
          </p>
          <Button variant="outline" className="mt-3" onClick={() => setNewBattleOpen(true)}>
            Declarar uma batalha, se fizer sentido
          </Button>
        </Card>
      )}

      {(data?.battles ?? []).map((b) => {
        const cks = (data?.checkins ?? []).filter((c) => c.battle_id === b.id);
        const stats = computeBattleStats(cks);
        return (
          <Card key={b.id} className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold">{battleLabel(b)}</h2>
                {b.discreet_name && <p className="text-xs text-muted-foreground">({b.name})</p>}
              </div>
              <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground"
                onClick={() => archive(b)} aria-label="Arquivar batalha" title="Arquivar batalha">
                <Archive className="w-4 h-4" />
              </Button>
            </div>

            {/* Os 3 números — o acumulado em primeiro, porque ele nunca zera */}
            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="rounded-lg bg-gold/10 border border-gold/20 p-3">
                <p className="font-display text-2xl font-semibold text-gold-ink">{stats.totalClean}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">dias limpos acumulados<br />(nunca zera)</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-display text-2xl font-semibold">{stats.record}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">recorde<br />pessoal</p>
              </div>
              {/* Este quadro mostrava `currentStreak`, que voltava a zero em
                  qualquer dia sem check-in — inclusive sem recaída nenhuma.
                  Agora mostra os dias desde a última recaída, que é o que
                  /recusas promete e o que nenhuma ausência derruba.
                  Ver a nota longa em lib/battles.ts. */}
              <div className="rounded-lg border p-3">
                <p className="font-display text-2xl font-semibold">{stats.daysSinceRelapse ?? 0}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">
                  {stats.cleanSince === "relapse"
                    ? (<>dias desde<br />a última recaída</>)
                    : (<>dias desde<br />o começo</>)}
                </p>
              </div>
            </div>

            {/* Honestidade sem punição: a contagem acima não depende de
                check-in, então a tela tem que DIZER quando não sabe. Sem esta
                linha, o número inflaria em silêncio — e num tema como apostas
                ou álcool o autoengano é dano real, não gentileza. */}
            {stats.checkinGapDays >= 2 && (
              <p className="text-[11px] text-muted-foreground">
                {stats.checkinGapDays} dias sem check-in. O número acima conta desde a última
                recaída, não desde o último registro.
              </p>
            )}

            {stats.nextMilestone && (
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Próximo marco: {stats.nextMilestone} dias</span>
                  <span>{stats.daysSinceRelapse ?? 0}/{stats.nextMilestone}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-gold transition-all"
                    style={{ width: `${Math.min(((stats.daysSinceRelapse ?? 0) / stats.nextMilestone) * 100, 100)}%` }} />
                </div>
              </div>
            )}
            {!stats.nextMilestone && (stats.daysSinceRelapse ?? 0) >= MILESTONES[MILESTONES.length - 1] && (
              <p className="text-xs text-gold-ink">✦ Você passou dos 90 dias. Isso já é outra vida.</p>
            )}

            {/* "Resisti à vontade" era calculado em battles.ts e não aparecia
                em tela nenhuma, enquanto o total de recaídas era exibido como
                contador vitalício. O produto contava as derrotas em público e
                jogava fora a vitória mais difícil do pilar. */}
            {stats.resisted > 0 && (
              <p className="text-xs text-gold-ink">
                {stats.resisted === 1
                  ? "1 vez a vontade bateu e você não cedeu."
                  : `${stats.resisted} vezes a vontade bateu e você não cedeu.`}
              </p>
            )}

            {stats.relapses > 0 && (
              <p className="text-xs text-muted-foreground">
                {stats.relapses} {stats.relapses === 1 ? "recaída registrada" : "recaídas registradas"} — cada uma
                virou dado para o Conselheiro te ajudar a achar o padrão.
              </p>
            )}

            {/* Check-in do dia DENTRO do cartão (plano §5.3): estatísticas,
                check-in, emergência e privacidade em uma experiência só. */}
            <CheckinRow battle={b} todayCheckin={cks.find((c) => c.checkin_date === today)} />

            <div className="flex items-center justify-between gap-2">
              <SosDialog battle={b} />
              <span className="text-[11px] text-muted-foreground">
                {b.visible_to_ai ? "Visível para o Conselheiro" : "Invisível para o Conselheiro"}
              </span>
            </div>
          </Card>
        );
      })}

      {/* Batalhas arquivadas: visíveis e com fluxo de restauração (plano §5.3) */}
      {(data?.archived ?? []).length > 0 && (
        <Card className="p-4 space-y-2.5">
          <div>
            <h2 className="font-display font-semibold flex items-center gap-1.5">
              <Archive className="w-4 h-4 text-muted-foreground" /> Batalhas arquivadas
            </h2>
            <p className="text-xs text-muted-foreground">
              Nada se perde ao arquivar: histórico e dias limpos ficam guardados. Reative quando quiser.
            </p>
          </div>
          <div className="space-y-1.5">
            {(data?.archived ?? []).map((b) => {
              const cks = (data?.checkins ?? []).filter((c) => c.battle_id === b.id);
              const stats = computeBattleStats(cks);
              return (
                <div key={b.id} className="flex items-center gap-3 rounded-md border p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{battleLabel(b)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {stats.totalClean} {stats.totalClean === 1 ? "dia limpo acumulado" : "dias limpos acumulados"} · recorde {stats.record}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => restore(b)}>
                    <ArchiveRestore className="w-3.5 h-3.5 mr-1.5" /> Reativar
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Batalhas com álcool, drogas ou apostas merecem reforço profissional: CAPS, Alcoólicos Anônimos,
        Narcóticos Anônimos e Jogadores Anônimos existem, funcionam e são gratuitos. O Ascende é seu
        apoio diário — não substitui tratamento.
      </p>
    </div>
  );
}