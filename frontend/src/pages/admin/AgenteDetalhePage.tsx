import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Loader2,
  Lock,
  MessageSquare,
  PanelRightClose,
  PauseCircle,
  PlayCircle,
  Plus,
  RotateCcw,
  Send,
  Settings,
  Trash2,
  Workflow,
} from "lucide-react";

import { api } from "@/lib/api";
import { ProviderLogo } from "@/components/icons/providerLogos";
import {
  Button,
  CONTENT_MAX,
  FC,
  Field,
  Input,
  Section,
  Select,
  SkeletonBar,
  Spacer,
  SplitPane,
  Textarea,
  iconBtn,
} from "@/components/ds/fc";

/**
 * Página do agente — substitui o drawer lateral.
 *
 * Por que página e não gaveta: a configuração do agente tem ~700 linhas de
 * conteúdo e o trabalho real é um LOOP (instruir → testar → corrigir). Numa
 * gaveta de 480px nada cabe lado a lado, então tudo virou aba — e trocar de aba
 * destruía a conversa de teste. Aqui a coluna esquerda tem seções colapsáveis
 * (convivem, não se excluem) e o painel de teste fica fixo à direita.
 *
 * A rota `/admin/agentes/:id` também traz o que a gaveta não tinha: link
 * compartilhável, F5 sem perder o lugar e o Voltar do browser funcionando.
 */

interface Agent {
  id: number;
  tenant_id: number;
  nome: string;
  persona: string | null;
  system_prompt: string | null;
  template_kind: string | null;
  avatar_url?: string | null;
  llm_model?: string | null;
  llm_provider_id?: number | null;
  active: boolean;
}

interface RuntimeConfig {
  llm: {
    scope: string;
    provider: string | null;
    model: string | null;
    inherited: boolean;
    tenant_default_model: string | null;
    provider_id: number | null;
    fallback: string[];
    options: { id: number; provider: string; default_model: string }[];
  };
  embedding: {
    scope: string;
    locked_reason: string;
    provider: string | null;
    model: string | null;
    dimensions: number;
  };
  knowledge: {
    total: number;
    ready: number;
    failed: number;
    chunks: number;
    items: { id: number; title: string | null; kind: string; status: string; chunks_count: number }[];
  };
}

interface AgentStats {
  agent_id: number;
  playbooks_total: number;
  playbooks_published: number;
  conversations_total: number;
  conversations_active: number;
  knowledge_total: number;
  connectors_total: number;
}

const SECOES = [
  { id: "instrucoes", label: "Instruções" },
  { id: "modelos", label: "Modelos" },
  { id: "conhecimento", label: "Conhecimento" },
  { id: "ferramentas", label: "Ferramentas" },
  { id: "canais", label: "Canais" },
  { id: "playbooks", label: "Playbooks" },
  { id: "risco", label: "Zona de risco" },
];

export default function AgenteDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const agentId = Number(id);
  const navigate = useNavigate();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [rt, setRt] = useState<RuntimeConfig | null>(null);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Rascunho local dos campos de texto + autosave debounced.
  const [persona, setPersona] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [salvoEm, setSalvoEm] = useState<number | null>(null);
  const primeiroRender = useRef(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true);
      setErro(null);
      try {
        const { data } = await api.get<Agent[]>("/agents");
        const a = data.find((x) => x.id === agentId) || null;
        if (!vivo) return;
        if (!a) {
          setErro("Agente não encontrado.");
          setLoading(false);
          return;
        }
        setAgent(a);
        setNome(a.nome);
        setPersona(a.persona || "");
        setSystemPrompt(a.system_prompt || "");
      } catch {
        if (vivo) setErro("Não foi possível carregar o agente.");
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    let vivo = true;
    api
      .get<RuntimeConfig>(`/agents/${agentId}/runtime-config`)
      .then(({ data }) => vivo && setRt(data))
      .catch(() => {});
    api
      .get<AgentStats>(`/agents/${agentId}/stats`)
      .then(({ data }) => vivo && setStats(data))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [agentId]);

  const patch = useCallback(
    async (next: Partial<Agent>) => {
      if (!agentId) return;
      setSalvando(true);
      try {
        const { data } = await api.patch<Agent>(`/agents/${agentId}`, next);
        setAgent(data);
        setSalvoEm(Date.now());
      } catch {
        toast.error("Não consegui salvar");
      } finally {
        setSalvando(false);
      }
    },
    [agentId],
  );

  // Autosave: 900ms depois da última tecla. Editar prompt é iterativo — obrigar
  // a clicar Salvar a cada ajuste é o que fazia o loop doer.
  useEffect(() => {
    if (primeiroRender.current) {
      primeiroRender.current = false;
      return;
    }
    if (!agent) return;
    if (persona === (agent.persona || "") && systemPrompt === (agent.system_prompt || "") && nome === agent.nome) {
      return;
    }
    const t = setTimeout(() => {
      patch({ nome, persona, system_prompt: systemPrompt });
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona, systemPrompt, nome]);

  const modeloAtual = rt?.llm.model || agent?.llm_model || null;

  async function toggleAtivo() {
    if (!agent) return;
    try {
      const { data } = await api.post<Agent>(`/agents/${agent.id}/toggle-active`);
      setAgent(data);
    } catch {
      toast.error("Não consegui alterar o status");
    }
  }

  if (loading) {
    return (
      <div className="-mx-8 px-8 py-10 space-y-3">
        <SkeletonBar className="h-8 w-64" />
        <SkeletonBar className="h-4 w-96" />
        <SkeletonBar className="h-40 w-full" />
      </div>
    );
  }

  if (erro || !agent) {
    return (
      <div className="-mx-8 px-8 py-16 text-center">
        <p className={`text-[14px] ${FC.sub}`}>{erro || "Agente não encontrado."}</p>
        <Link to="/admin/agentes" className={`inline-flex items-center gap-1.5 mt-3 text-[13px] ${FC.ink} hover:underline`}>
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar para Agentes
        </Link>
      </div>
    );
  }

  /* O teste nasce RECOLHIDO. Aberto por padrão ele tomava 42% da tela para
     uma conversa que na maior parte do tempo está vazia — e espremia a
     configuração, que é o que a pessoa veio fazer. A régua fica à vista, com
     um botão; abre quando se quer conversar, e lembra a escolha. */
  const [testarAberto, setTestarAberto] = useState<boolean>(() => {
    try {
      return localStorage.getItem("ta-agente-testar") === "1";
    } catch {
      return false;
    }
  });
  function alternarTestar() {
    setTestarAberto((v) => {
      try {
        localStorage.setItem("ta-agente-testar", v ? "0" : "1");
      } catch {
        /* modo privado — só não persiste */
      }
      return !v;
    });
  }

  return (
    // Tela cheia: escapa do container do AdminLayout pra o painel de teste ter
    // altura real. `left` vem da var publicada pela sidebar (que varia 200-420).
    <div
      className={`fixed inset-0 top-0 z-10 flex flex-col ${FC.base}`}
      style={{ left: "var(--ta-sidebar-w, 240px)" }}
    >
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header className={`h-[60px] shrink-0 px-4 flex items-center gap-3 border-b ${FC.hair} bg-white dark:bg-[#0f1216]`}>
        <Link to="/admin/agentes" className={iconBtn} title="Voltar para Agentes">
          <ArrowLeft className="w-4 h-4" />
        </Link>

        {agent.avatar_url ? (
          <img src={agent.avatar_url} alt="" className={`w-9 h-9 rounded-full object-cover border ${FC.hair} shrink-0`} />
        ) : (
          <div className="w-9 h-9 shrink-0 rounded-full bg-[#003083]/[0.08] dark:bg-[#5b9bff]/[0.14] flex items-center justify-center text-[12px] font-semibold text-[#003083] dark:text-[#5b9bff]">
            {agent.nome.slice(0, 2).toUpperCase()}
          </div>
        )}

        <div className="min-w-0">
          <div className={`text-[15px] font-medium leading-5 truncate ${FC.ink}`}>{agent.nome}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`inline-flex items-center gap-1.5 text-[12px] ${FC.sub}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${agent.active ? "bg-[#0a8f5a]" : "bg-[#F5A300]"}`} />
              {agent.active ? "Ativo" : "Pausado"}
            </span>
            <span className={FC.mut}>·</span>
            <span className={`text-[12px] font-mono ${FC.mut}`}>#{agent.id}</span>
            {agent.template_kind && (
              <>
                <span className={FC.mut}>·</span>
                <span className={`text-[12px] ${FC.mut}`}>{agent.template_kind}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex-1" />

        {/* Modelo sempre visível — antes vivia enterrado na 4ª aba. */}
        {modeloAtual && (
          <span
            className={`hidden md:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[10px] border ${FC.hair} text-[12px] font-mono ${FC.sub}`}
            title="Modelo de raciocínio"
          >
            <ProviderLogo provider={modeloAtual} className="w-3.5 h-3.5" />
            {modeloAtual}
          </span>
        )}
        {rt?.embedding.dimensions ? (
          <span
            className={`hidden lg:inline-flex items-center gap-1 h-7 px-2 rounded-[10px] border ${FC.hair} text-[11px] font-mono ${FC.mut}`}
            title={rt.embedding.locked_reason || "Modelo de indexação"}
          >
            <Lock className="w-3 h-3" />
            {rt.embedding.dimensions}d
          </span>
        ) : null}

        <span className={`inline-flex items-center gap-1.5 text-[12px] w-[86px] justify-end ${FC.mut}`}>
          {salvando ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> salvando
            </>
          ) : salvoEm ? (
            <>
              <Check className="w-3 h-3" /> salvo
            </>
          ) : null}
        </span>
      </header>

      {/* ── CORPO: config (rola) │ teste (fixo) ─────────────────── */}
      <SplitPane
        storageKey="ta-agente-split"
        rightCollapsed={!testarAberto}
        left={
          /* Respiro nas bordas. As seções encostavam no topo e nos lados do
             painel — "muito lá em cima na ponta". Os rails continuam correndo
             dentro da coluna; só a coluna deixou de ir de parede a parede. */
          <div className="pb-16 pt-6 px-6">
            {/* Índice — navega por âncora, NÃO troca de tela (não é aba).
                Vive nos mesmos rails das seções pra a coluna ter um eixo vertical
                contínuo em vez de blocos soltos. */}
            <nav className={`sticky top-0 z-20 w-full ${FC.base}`}>
              <div className="mx-auto" style={{ maxWidth: CONTENT_MAX }}>
                <div className={`border-l border-r ${FC.hair} flex items-center gap-0.5 overflow-x-auto px-4 py-2`}>
                  {SECOES.map((s) => (
                    <a
                      key={s.id}
                      href={`#${s.id}`}
                      className={`shrink-0 h-7 px-2.5 inline-flex items-center rounded-[8px] text-[12.5px] ${FC.sub} hover:text-[#262626] dark:hover:text-white ${FC.hover} transition-colors`}
                    >
                      {s.label}
                    </a>
                  ))}
                </div>
              </div>
            </nav>

            {/* Respiro antes da 1ª seção. Spacer é a faixa vazia do DS: os rails
                seguem correndo, então o conteúdo respira sem se soltar da coluna. */}
            <Spacer h={28} />

            {/* 1 · INSTRUÇÕES */}
            <Section id="instrucoes" title="Instruções" count={`${persona.length.toLocaleString("pt-BR")} car.`}>
              <div className="space-y-4">
                <Field label="Nome do agente">
                  <Input value={nome} onChange={(e) => setNome(e.target.value)} />
                </Field>
                <Field
                  label="Persona"
                  hint="É o que o agente é. Vale na produção — e é o que o teste ao lado usa."
                >
                  <Textarea rows={12} value={persona} onChange={(e) => setPersona(e.target.value)} className="font-mono" />
                </Field>

                {/* system_prompt existia na API e NUNCA aparecia na tela. Campo
                    invisível que decide comportamento é dívida garantida. */}
                <details className={`rounded-[10px] border ${FC.hair} overflow-hidden`}>
                  <summary
                    className={`cursor-pointer select-none px-3.5 py-2.5 text-[12.5px] ${FC.sub} ${FC.hover} flex items-center gap-1.5`}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    Prompt de sistema (avançado)
                    {systemPrompt ? (
                      <span className={`ml-1 text-[11px] font-mono ${FC.mut}`}>
                        {systemPrompt.length.toLocaleString("pt-BR")} car.
                      </span>
                    ) : (
                      <span className={`ml-1 text-[11px] ${FC.mut}`}>vazio</span>
                    )}
                  </summary>
                  <div className={`border-t ${FC.hair} p-3.5`}>
                    <p className={`mb-2 text-[11.5px] leading-4 ${FC.mut}`}>
                      Campo separado da persona, herdado do modelo que criou o agente. Na produção a persona tem
                      prioridade; se ela estiver vazia, este texto assume.
                    </p>
                    <Textarea
                      rows={8}
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      className="font-mono"
                      placeholder="(vazio)"
                    />
                  </div>
                </details>
              </div>
            </Section>

            {/* 2 · MODELOS */}
            <Section id="modelos" title="Modelos">
              {!rt ? (
                <SkeletonBar className="h-20 w-full" />
              ) : (
                <div className="space-y-5">
                  <div>
                    <div className={`text-[11px] uppercase tracking-wider font-semibold mb-2 ${FC.mut}`}>
                      Raciocina com
                    </div>
                    <div className={`rounded-[10px] border ${FC.hair} overflow-hidden`}>
                      <div className="flex items-center gap-3.5 p-4">
                        <div
                          className={`w-11 h-11 shrink-0 rounded-[10px] border ${FC.hair} ${FC.base} flex items-center justify-center`}
                        >
                          <ProviderLogo provider={rt.llm.model || rt.llm.provider || ""} className="w-[22px] h-[22px]" />
                        </div>
                        <div className="min-w-0">
                          <div className={`text-[15px] font-medium font-mono truncate ${FC.ink}`}>
                            {rt.llm.model || "—"}
                          </div>
                          <div className={`text-[13px] leading-5 mt-0.5 ${FC.sub}`}>
                            {rt.llm.provider}
                            <span className={FC.mut}> · </span>
                            {rt.llm.inherited ? "padrão da conta" : "escolhido para este agente"}
                          </div>
                        </div>
                      </div>
                      {rt.llm.fallback.length > 0 && (
                        <div className={`flex items-center gap-2 flex-wrap border-t ${FC.hair} ${FC.base} px-4 py-2.5`}>
                          <span className={`text-[11px] uppercase tracking-wider font-semibold ${FC.mut}`}>
                            Se falhar
                          </span>
                          {rt.llm.fallback.map((m, i) => (
                            <span
                              key={i}
                              className={`inline-flex items-center gap-1.5 h-6 pl-1.5 pr-2 rounded-md border ${FC.hair} bg-white dark:bg-[#14171c] text-[11px] font-mono ${FC.dim}`}
                            >
                              <ProviderLogo provider={m || ""} className="w-3.5 h-3.5" />
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className={`text-[11px] uppercase tracking-wider font-semibold mb-2 ${FC.mut}`}>Indexa com</div>
                    <div className={`rounded-[10px] border ${FC.hair} p-4 flex items-center gap-3.5`}>
                      <div
                        className={`w-11 h-11 shrink-0 rounded-[10px] border ${FC.hair} ${FC.base} flex items-center justify-center`}
                      >
                        <ProviderLogo
                          provider={rt.embedding.model || rt.embedding.provider || ""}
                          className="w-[22px] h-[22px]"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`text-[15px] font-medium font-mono truncate ${FC.ink}`}>
                          {rt.embedding.model || "—"}
                        </div>
                        <div className={`text-[13px] leading-5 mt-0.5 ${FC.sub}`}>
                          {rt.embedding.provider || "sem provider"}
                          <span className={FC.mut}> · {rt.embedding.dimensions} dimensões</span>
                        </div>
                      </div>
                      <Lock className={`w-4 h-4 shrink-0 ${FC.mut}`} />
                    </div>
                    {rt.embedding.locked_reason && (
                      <p className={`mt-1.5 text-[11.5px] leading-4 ${FC.mut}`}>{rt.embedding.locked_reason}</p>
                    )}
                  </div>

                  {/* Trocar o modelo sem sair da tela — as opções já vêm no
                      runtime-config (só providers com chave na conta). */}
                  {rt.llm.options.length > 0 && (
                    <Field
                      label="Trocar o modelo de raciocínio"
                      hint={
                        rt.llm.inherited
                          ? "Hoje herda o padrão da conta. Escolher aqui vale só para este agente."
                          : "Escolha própria deste agente."
                      }
                    >
                      <div className="flex items-center gap-2">
                        <Select
                          className="flex-1 max-w-[380px]"
                          value={rt.llm.model || ""}
                          placeholder="Escolher modelo…"
                          options={rt.llm.options.map((o) => ({
                            value: o.default_model,
                            label: o.default_model,
                            icon: <ProviderLogo provider={o.default_model || o.provider} className="w-4 h-4" />,
                          }))}
                          onChange={(v) => {
                            const opt = rt.llm.options.find((o) => o.default_model === v);
                            patch({ llm_model: String(v), llm_provider_id: opt?.id });
                            setRt((prev) =>
                              prev ? { ...prev, llm: { ...prev.llm, model: String(v), inherited: false } } : prev,
                            );
                          }}
                        />
                        {!rt.llm.inherited && (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              /* 🚨 Limpa os DOIS. Um agente sai do padrão de duas
                                 formas — modelo próprio OU ponteiro para outra
                                 credencial — e este botão só limpava a primeira.
                                 Num agente que aponta (o caso do Tier Empresas,
                                 que aponta para a linha do gpt-4o-mini), clicar
                                 aqui não fazia NADA no servidor enquanto a tela
                                 já mostrava o padrão: mentira otimista, o pior
                                 tipo, porque some sem deixar rastro até alguém
                                 recarregar. */
                              patch({ llm_model: "", llm_provider_id: null });
                              setRt((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      llm: { ...prev.llm, model: prev.llm.tenant_default_model, inherited: true },
                                    }
                                  : prev,
                              );
                            }}
                          >
                            Voltar ao padrão
                          </Button>
                        )}
                      </div>
                    </Field>
                  )}

                  <div className="flex items-center gap-2">
                    <Link to="/admin/configuracoes/llm" className="inline-flex">
                      <Button variant="secondary">
                        <Settings className="w-3.5 h-3.5" /> Chaves da conta
                      </Button>
                    </Link>
                    <Link to="/admin/configuracoes/embedding" className="inline-flex">
                      <Button variant="ghost">Reindexação</Button>
                    </Link>
                  </div>
                </div>
              )}
            </Section>

            {/* 3 · CONHECIMENTO */}
            <Section
              id="conhecimento"
              title="Conhecimento"
              count={rt ? `${rt.knowledge.total}${rt.knowledge.failed ? ` · ${rt.knowledge.failed} com falha` : ""}` : undefined}
              right={
                <Link to="/admin/knowledge" className="inline-flex">
                  <Button variant="secondary" size="sm">
                    <Plus className="w-3 h-3" /> Enviar
                  </Button>
                </Link>
              }
            >
              {!rt ? (
                <SkeletonBar className="h-16 w-full" />
              ) : rt.knowledge.items.length === 0 ? (
                <p className={`text-[13px] ${FC.sub}`}>
                  Nenhum documento indexado. O agente responde só com a persona.
                </p>
              ) : (
                <div className={`rounded-[10px] border ${FC.hair} divide-y ${FC.hair} overflow-hidden`}>
                  {rt.knowledge.items.map((k) => (
                    <div key={k.id} className="flex items-center gap-3 px-3.5 py-2.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          k.status === "ready" ? "bg-[#0a8f5a]" : k.status === "failed" ? "bg-[#E5484D]" : "bg-[#F5A300]"
                        }`}
                      />
                      <BookOpen className={`w-3.5 h-3.5 shrink-0 ${FC.mut}`} />
                      <span className={`flex-1 min-w-0 truncate text-[13px] ${FC.ink}`}>{k.title || `#${k.id}`}</span>
                      <span className={`shrink-0 text-[11px] font-mono ${FC.mut}`}>{k.chunks_count} trechos</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* 4 · FERRAMENTAS */}
            <Section id="ferramentas" title="Ferramentas" defaultOpen={false}>
              <p className={`text-[13px] ${FC.sub}`}>
                Skills que o agente aprendeu ou recebeu.{" "}
                <Link
                  to={`/admin/agentes/${agent.id}/skills`}
                  className="text-[#003083] dark:text-[#5b9bff] hover:underline"
                >
                  Abrir skills
                </Link>
              </p>
            </Section>

            {/* 5 · CANAIS */}
            <Section id="canais" title="Canais" count={stats?.connectors_total} defaultOpen={false}>
              <p className={`text-[13px] ${FC.sub}`}>
                {stats?.connectors_total
                  ? `${stats.connectors_total} canal(is) atendendo por este agente.`
                  : "Nenhum canal conectado a este agente."}{" "}
                <Link to="/admin/canais" className="text-[#003083] dark:text-[#5b9bff] hover:underline">
                  Gerenciar canais
                </Link>
              </p>
            </Section>

            {/* 6 · PLAYBOOKS */}
            <Section id="playbooks" title="Playbooks" count={stats?.playbooks_total} defaultOpen={false}>
              <p className={`text-[13px] ${FC.sub}`}>
                {stats?.playbooks_total
                  ? `${stats.playbooks_total} playbook(s), ${stats.playbooks_published} publicado(s).`
                  : "Nenhum playbook."}{" "}
                <Link to="/admin/playbooks" className="text-[#003083] dark:text-[#5b9bff] hover:underline">
                  <Workflow className="w-3 h-3 inline" /> Abrir editor
                </Link>
              </p>
            </Section>

            {/* 7 · ZONA DE RISCO */}
            <Section id="risco" title="Zona de risco" defaultOpen={false}>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={toggleAtivo}>
                  {agent.active ? <PauseCircle className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
                  {agent.active ? "Pausar agente" : "Ativar agente"}
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (!window.confirm(`Excluir "${agent.nome}"? Isso não tem volta.`)) return;
                    try {
                      await api.delete(`/agents/${agent.id}`);
                      toast.success("Agente excluído");
                      navigate("/admin/agentes");
                    } catch {
                      toast.error("Não consegui excluir");
                    }
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Excluir agente
                </Button>
              </div>
            </Section>

            <Spacer h={40} />
          </div>
        }
        right={
          <ChatPanel
            agentId={agent.id}
            agentName={agent.nome}
            model={modeloAtual}
            persona={persona}
            aberto={testarAberto}
            onAlternar={alternarTestar}
          />
        }
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Painel de teste — FIXO, não é aba.
   ───────────────────────────────────────────────────────────── */

type Msg =
  | {
      tipo: "msg";
      role: "user" | "assistant";
      content: string;
      model?: string | null;
      fontes?: string[];
    }
  | { tipo: "marco"; texto: string };

function ChatPanel({
  agentId,
  agentName,
  model,
  persona,
  aberto,
  onAlternar,
}: {
  agentId: number;
  agentName: string;
  model: string | null;
  aberto: boolean;
  onAlternar: () => void;
  persona: string;
}) {
  const [itens, setItens] = useState<Msg[]>([]);
  const [contato, setContato] = useState("");
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const personaNoUltimoEnvio = useRef<string>(persona);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [itens, enviando]);

  const historico = useMemo(
    () =>
      itens
        .filter((i): i is Extract<Msg, { tipo: "msg" }> => i.tipo === "msg")
        .map(({ role, content }) => ({ role, content })),
    [itens],
  );

  async function enviar() {
    const texto = input.trim();
    if (!texto || enviando) return;

    // Marco de "instrução alterada": comparar resposta velha com prompt novo é
    // o erro nº1 de quem itera prompt. A linha deixa o corte explícito.
    const extras: Msg[] = [];
    if (itens.length > 0 && persona !== personaNoUltimoEnvio.current) {
      extras.push({ tipo: "marco", texto: "instruções alteradas" });
    }
    personaNoUltimoEnvio.current = persona;

    const hist = historico;
    setItens((m) => [...m, ...extras, { tipo: "msg", role: "user", content: texto }]);
    setInput("");
    setEnviando(true);
    try {
      const { data } = await api.post<{
        text: string;
        bubbles?: string[];
        canal?: string;
        model_used?: string | null;
        rag_fontes?: string[];
        rag_usado?: boolean;
      }>(`/agents/${agentId}/playground`, {
        message: texto,
        history: hist,
        contact_name: contato.trim() || undefined,
      });
      // O backend devolve a resposta JA quebrada em balões, do mesmo jeito que o
      // cliente recebe no canal. Renderiza um balão por mensagem — antes vinha
      // tudo num bloco só e o teste parecia diferente do WhatsApp.
      const bolhas = data.bubbles?.length ? data.bubbles : [data.text || "(sem resposta)"];
      setItens((m) => [
        ...m,
        ...bolhas.map((b, i) => ({
          tipo: "msg" as const,
          role: "assistant" as const,
          content: b,
          // modelo e fontes só no ÚLTIMO balão, pra não repetir o carimbo N vezes
          model: i === bolhas.length - 1 ? data.model_used ?? null : null,
          fontes: i === bolhas.length - 1 ? data.rag_fontes ?? [] : [],
        })),
      ]);
    } catch (err: any) {
      const motivo = err?.response?.data?.detail || "erro ao falar com o agente";
      setItens((m) => [...m, { tipo: "msg", role: "assistant", content: `⚠ ${motivo}` }]);
    } finally {
      setEnviando(false);
    }
  }

  /* RECOLHIDO: uma régua com o botão. O mesmo componente continua montado,
     então a conversa que já existia sobrevive ao recolher — o ponto na régua
     avisa que há algo lá dentro. */
  if (!aberto) {
    return (
      <div className={`flex flex-col items-center h-full min-h-0 border-l ${FC.hair} bg-white dark:bg-[#0f1216]`}>
        <div className={`h-[60px] w-full shrink-0 flex items-center justify-center border-b ${FC.hair}`}>
          <button
            type="button"
            onClick={onAlternar}
            title="Abrir o teste — conversar com o agente"
            className="relative w-9 h-9 rounded-full inline-flex items-center justify-center bg-[#003083] text-white hover:bg-[#002266] dark:bg-[#5b9bff] dark:text-[#0f1216] transition-colors active:scale-[0.97]"
          >
            <MessageSquare className="w-4 h-4" />
            {itens.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#0a8f5a] ring-2 ring-white dark:ring-[#0f1216]" />
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={onAlternar}
          className={`mt-5 [writing-mode:vertical-rl] rotate-180 text-[11px] font-medium tracking-[0.14em] uppercase ${FC.mut} hover:text-[#262626] dark:hover:text-white transition-colors`}
        >
          Testar
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full min-h-0 border-l ${FC.hair} bg-white dark:bg-[#0f1216]`}>
      <div className={`h-[60px] shrink-0 px-5 flex items-center gap-2.5 border-b ${FC.hair}`}>
        <MessageSquare className={`w-4 h-4 ${FC.mut}`} />
        <span className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 fc-crisp ${FC.ink}`}>Testar</span>
        <div className="flex-1" />
        {/* O canal entrega o nome em produção; aqui é digitado, senão o {nome}
            da persona não resolve e o teste diverge do WhatsApp. */}
        <Input
          value={contato}
          onChange={(e) => setContato(e.target.value)}
          placeholder="Nome do contato"
          className="w-[150px] h-7 text-[12px]"
          title="Simula o nome que o WhatsApp entrega"
        />
        {itens.length > 0 && (
          <button onClick={() => setItens([])} className={iconBtn} title="Limpar conversa">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={onAlternar} className={iconBtn} title="Recolher o teste">
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll px-4 py-4">
        {itens.length === 0 ? (
          <div className={`text-center py-10 text-[13px] leading-6 ${FC.mut}`}>
            Escreva como se fosse um cliente.
            <br />
            {agentName} responde com a persona real{model ? ` — em ${model}` : ""}.
            <div className={`mt-3 mx-auto max-w-[300px] rounded-[10px] border ${FC.hair} px-3 py-2 text-[11.5px] leading-4 text-left`}>
              Mesmo prompt do WhatsApp: persona, base de conhecimento, data de hoje e as regras de
              formatação do canal. A resposta vem quebrada em balões, como o cliente recebe.
              <br />
              <span className={FC.mut}>
                Fora: memória de conversas anteriores (é por contato) e playbooks.
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {itens.map((it, i) =>
              it.tipo === "marco" ? (
                <div key={i} className="flex items-center gap-2 py-1">
                  <div className={`flex-1 h-px ${FC.hairBg}`} />
                  <span className={`text-[10.5px] uppercase tracking-wider ${FC.mut}`}>{it.texto}</span>
                  <div className={`flex-1 h-px ${FC.hairBg}`} />
                </div>
              ) : (
                <div key={i} className={it.role === "user" ? "flex justify-end" : "flex flex-col items-start"}>
                  <div
                    className={`max-w-[88%] px-3.5 py-2.5 text-[13px] leading-5 whitespace-pre-wrap ${
                      it.role === "user"
                        ? "rounded-[14px_14px_4px_14px] bg-[#003083] text-white dark:bg-[#5b9bff] dark:text-[#0c0e12]"
                        : `rounded-[14px_14px_14px_4px] border ${FC.hair} ${FC.base} ${FC.ink}`
                    }`}
                  >
                    {it.content}
                  </div>
                  {/* Carimbo do que a resposta usou DE FATO: modelo que respondeu
                      (pode não ser o escolhido, se caiu no fallback) e trechos da
                      base que entraram no prompt. Sem isso o teste é uma caixa-preta. */}
                  {it.role === "assistant" && (it.model || (it.fontes && it.fontes.length > 0)) && (
                    <div className="mt-1 ml-1 flex items-center gap-1.5 flex-wrap">
                      {it.model && <span className={`text-[10.5px] font-mono ${FC.mut}`}>{it.model}</span>}
                      {it.fontes?.map((f, k) => (
                        <span
                          key={k}
                          className={`inline-flex items-center gap-1 h-[18px] px-1.5 rounded-md border ${FC.hair} text-[10px] ${FC.mut}`}
                          title="Trecho desta fonte entrou no prompt"
                        >
                          <BookOpen className="w-2.5 h-2.5" />
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
            {enviando && (
              <div className="flex justify-start">
                <div className={`px-3.5 py-2.5 rounded-[14px_14px_14px_4px] border ${FC.hair} ${FC.base}`}>
                  <Loader2 className={`w-3.5 h-3.5 animate-spin ${FC.mut}`} />
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className={`shrink-0 border-t ${FC.hair} px-4 py-3 flex items-center gap-2`}>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          placeholder="Escreva como um cliente…"
          className="flex-1"
        />
        <Button variant="primary" onClick={enviar} disabled={enviando || !input.trim()} scramble={false}>
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
