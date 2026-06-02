import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Check } from "lucide-react";

import { api } from "@/lib/api";
import { FC, PageFrame, Row, HairCells, Button } from "@/components/ds/fc";

interface SKU {
  key: string;
  label: string;
  monthly_brl: number;
  monthly_brl_display: string;
  max_agents: number;
  daily_messages: number;
  max_channels: number;
  knowledge_gb: number;
  description: string;
  features: string[];
}

interface Subscription {
  tenant_id: number;
  current_sku: string | null;
  sku_details: { key: string; label: string; monthly_brl: number } | null;
  subscription: { status: string; tierpay_subscription_id: string | null; next_billing_at: string | null } | null;
}

export default function CobrancaPage() {
  const [skus, setSkus] = useState<SKU[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkout, setCheckout] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [s, my] = await Promise.all([
        api.get<{ skus: SKU[] }>("/billing/skus"),
        api.get<Subscription>("/billing/subscription"),
      ]);
      setSkus(s.data.skus);
      setSub(my.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubscribe(sku: string) {
    setCheckout(sku);
    try {
      const { data } = await api.post("/billing/checkout", { sku });
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao iniciar checkout");
    } finally {
      setCheckout(null);
    }
  }

  return (
    <div className="-mx-8 pb-10">
      <PageFrame>
        <Row>
          <div className="p-6">
            <h2 className={`text-[20px] font-[450] tracking-[-0.1px] leading-7 ${FC.ink}`}>Cobrança</h2>
            <p className={`text-[13px] leading-5 mt-1 ${FC.sub}`}>Escolha o plano que cabe no seu volume.</p>
            {sub && sub.current_sku && sub.current_sku !== "trial" && (
              <div className="mt-4 rounded-lg border border-[#0a8f5a]/30 bg-[#0a8f5a]/[0.06] px-4 py-3 text-[13px] text-[#0a8f5a]">
                <strong>Plano atual:</strong> {sub.sku_details?.label}
                {sub.subscription?.next_billing_at && (
                  <> · próxima cobrança: {new Date(sub.subscription.next_billing_at).toLocaleDateString("pt-BR")}</>
                )}
              </div>
            )}
            {sub?.current_sku === "trial" && (
              <div className="mt-4 rounded-lg border border-[#F5A300]/30 bg-[#F5A300]/[0.08] px-4 py-3 text-[13px] text-[#9a6700]">
                Você está no <strong>trial</strong>. Escolha um plano abaixo pra continuar usando após o período.
              </div>
            )}
          </div>
        </Row>

        <Row>
          {loading ? (
            <div className={`p-6 text-center text-[13px] ${FC.mut}`}>Carregando...</div>
          ) : (
            <HairCells cols={skus.length === 3 ? 3 : 2}>
              {skus.map((s) => {
                const isCurrent = sub?.current_sku === s.key;
                const isPopular = s.key === "pro";
                return (
                  <div key={s.key} className="p-6 relative">
                    {isPopular && (
                      <div className="absolute top-4 right-4 px-2 py-0.5 bg-[#003083] dark:bg-[#5b9bff] text-white text-[10px] uppercase tracking-wide rounded">
                        Mais popular
                      </div>
                    )}
                    <div className={`text-[18px] font-[450] ${FC.ink}`}>{s.label}</div>
                    <div className={`text-[13px] mt-1 min-h-[36px] ${FC.sub}`}>{s.description}</div>

                    <div className="mt-4 flex items-baseline gap-1">
                      <span className={`font-mono tabular-nums text-[26px] font-medium ${FC.ink}`}>{s.monthly_brl_display}</span>
                      <span className={`text-[13px] ${FC.sub}`}>/mês</span>
                    </div>

                    <Button
                      variant={isPopular ? "primary" : "secondary"}
                      onClick={() => onSubscribe(s.key)}
                      disabled={isCurrent || checkout === s.key}
                      className="mt-4 w-full"
                    >
                      {isCurrent ? "Plano atual" : checkout === s.key ? "Abrindo..." : `Assinar ${s.label}`}
                    </Button>

                    <ul className="mt-5 space-y-2">
                      {s.features.map((f, i) => (
                        <li key={i} className={`flex items-start gap-2 text-[12px] ${FC.ink}`}>
                          <Check className="w-3.5 h-3.5 text-[#0a8f5a] mt-0.5 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </HairCells>
          )}
        </Row>

        <Row last>
          <p className={`px-6 py-4 text-[12px] text-center ${FC.sub}`}>
            Pagamentos processados pelo Tier Pay (Pagar.me). Cancele quando quiser.
          </p>
        </Row>
      </PageFrame>
    </div>
  );
}
