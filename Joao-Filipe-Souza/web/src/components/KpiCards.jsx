import { BadgeCheck, Target, WalletCards } from "lucide-react";

const cardConfig = [
    { key: "precision", title: "Precisao do modelo", icon: BadgeCheck },
    { key: "transactions", title: "Transacoes monitoradas", icon: WalletCards },
    { key: "recall", title: "Recall do modelo", icon: Target },
];

const formatPercent = (value) => {
    if (value == null || Number.isNaN(Number(value))) return "Sem dado";
    return `${(Number(value) * 100).toFixed(2)}%`;
};

export function KpiCards({ kpis, lastPrediction, modelInfo }) {
    const lastModelVersion = modelInfo?.model_version;
    const validationMetrics = modelInfo?.validation_metrics ?? {};
    const threshold = validationMetrics.threshold ?? modelInfo?.threshold;
    const lastScore = lastPrediction?.prediction?.score_fraude;
    const lastDecision = lastPrediction?.prediction?.decisao;

    const values = {
        precision: {
            value: formatPercent(kpis.modelPrecision ?? validationMetrics.precision),
            note: lastModelVersion
                ? `Modelo ${lastModelVersion}${threshold != null ? ` | limiar ${Number(threshold).toFixed(2)}` : ""}`
                : lastPrediction
                    ? `Ultima inferencia: ${(Number(lastScore) * 100).toFixed(2)}% (${lastDecision})`
                    : "Aguardando metadados do modelo",
        },
        transactions: {
            value: `${Number(kpis.monitoredTransactions ?? 0).toLocaleString("pt-BR")}`,
            note: kpis.alertsCount != null
                ? `${Number(kpis.alertsCount).toLocaleString("pt-BR")} transacoes acima do limiar na janela atual`
                : "Transacoes analisadas e salvas no historico local do painel",
        },
        recall: {
            value: formatPercent(kpis.modelRecall ?? validationMetrics.recall),
            note: validationMetrics.f1 != null
                ? `F1 de validacao: ${Number(validationMetrics.f1).toFixed(4)}`
                : `Ultima decisao observada: ${lastDecision ?? "sem dado"}`,
        },
    };

    return (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {cardConfig.map((card, index) => {
                const Icon = card.icon;
                const info = values[card.key];

                return (
                    <article
                        key={card.key}
                        className="animate-fade-up flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-soft"
                        style={{ animationDelay: `${80 * (index + 1)}ms` }}
                    >
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-sm font-medium text-slate-500">{card.title}</h2>
                            <Icon size={18} className="text-ink/70" />
                        </div>
                        <p className="text-3xl font-semibold tracking-tight text-ink">{info.value}</p>
                        <p className="mt-2 text-xs leading-5 text-slate-500">{info.note}</p>
                    </article>
                );
            })}
        </section>
    );
}
