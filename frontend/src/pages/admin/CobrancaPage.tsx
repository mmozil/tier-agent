import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Check } from "lucide-react";

import { api } from "@/lib/api";

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
    <div>
      <div className="mb-6">
        <h1 className="text-[28px] font-bold text-[#30313d]">Cobrança</h1>
        <p className="text-[13px] text-slate-500 mt-1">
          Escolha o plano que cabe no seu volume.
        </p>
      </div>

      {sub && sub.current_sku && sub.current_sku !== "trial" && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6">
          <div className="text-[13px] text-emerald-800">
            <strong>Plano atual:</strong> {sub.sku_details?.label}
            {sub.subscription?.next_billing_at && (
              <> · próxima cobrança: {new Date(sub.subscription.next_billing_at).toLocaleDateString("pt-BR")}</>
            )}
          </div>
        </div>
      )}

      {sub?.current_sku === "trial" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="text-[13px] text-amber-800">
            Você está no <strong>trial</strong>. Escolha um plano abaixo pra continuar usando após o período.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {loading && (
          <div className="col-span-3 text-center text-[13px] text-slate-400 py-6">Carregando...</div>
        )}
        {skus.map((s) => {
          const isCurrent = sub?.current_sku === s.key;
          const isPopular = s.key === "pro";
          return (
            <div
              key={s.key}
              className={`bg-white rounded-xl border p-6 relative ${
                isPopular ? "border-tier shadow-md" : "border-slate-200"
              }`}
            >
              {isPopular && (
                <div className="absolute -top-2.5 left-6 px-2 py-0.5 bg-tier text-white text-[10px] uppercase tracking-wide rounded">
                  Mais popular
                </div>
              )}
              <div className="text-[18px] font-medium text-slate-900">{s.label}</div>
              <div className="text-[13px] text-slate-500 mt-1 min-h-[36px]">{s.description}</div>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-[28px] font-bold text-[#30313d]">
                  {s.monthly_brl_display}
                </span>
                <span className="text-[13px] text-slate-500">/mês</span>
              </div>

              <button
                onClick={() => onSubscribe(s.key)}
                disabled={isCurrent || checkout === s.key}
                className={`mt-4 w-full h-9 px-3 rounded-md text-[13px] font-medium transition-colors disabled:opacity-50 ${
                  isPopular
                    ? "bg-tier hover:bg-tier-dark text-white"
                    : "border border-slate-300 hover:bg-slate-50 text-slate-800"
                }`}
              >
                {isCurrent ? "Plano atual" : checkout === s.key ? "Abrindo..." : `Assinar ${s.label}`}
              </button>

              <ul className="mt-5 space-y-2">
                {s.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-slate-700">
                    <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-[12px] text-slate-500 text-center">
        Pagamentos processados pelo Tier Pay (Pagar.me). Cancele quando quiser.
      </p>
    </div>
  );
}
