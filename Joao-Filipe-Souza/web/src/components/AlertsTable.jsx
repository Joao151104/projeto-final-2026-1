import { Loader2, MoreHorizontal, X } from "lucide-react";
import { useState } from "react";

const getDecisionTone = (decision) => {
    if (decision === "fraude") return { label: "Fraude", color: "bg-coral/15 text-coral" };
    return { label: "Legitima", color: "bg-emerald/15 text-emerald" };
};

const deriveTopFactors = (row) => {
    const existing = row?.top_fatores;
    if (existing && Object.keys(existing).length > 0) return existing;

    const payload = row?.transaction_payload ?? {};
    const entries = Object.entries(payload)
        .filter(([key, value]) => key !== "Time" && key !== "Amount" && Number.isFinite(Number(value)))
        .map(([key, value]) => [key, Number(value)])
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

    return Object.fromEntries(entries.slice(0, 3));
};

export function AlertsTable({ threshold, predictionHistory = [], onClearHistory }) {
    const [selectedRow, setSelectedRow] = useState(null);
    const [activeExplanation, setActiveExplanation] = useState("");
    const [isLoadingExplanation, setIsLoadingExplanation] = useState(false);
    const [explanationError, setExplanationError] = useState("");
    const [explanationProvider, setExplanationProvider] = useState("fallback");

    const rows = [...predictionHistory].slice().reverse();
    const fraudCount = predictionHistory.filter((item) => item.decisao === "fraude").length;

    const toDecision = (rawDecision) => (rawDecision === "fraude" ? "fraude" : "legitima");
    const toRecommendation = (rawRecommendation) => {
        if (rawRecommendation === "bloquear" || rawRecommendation === "revisar") return rawRecommendation;
        return "liberar";
    };

    const openExplanation = async (row) => {
        setSelectedRow(row);
        setIsLoadingExplanation(true);
        setExplanationError("");
        setActiveExplanation("");
        setExplanationProvider("fallback");

        const topFactors = deriveTopFactors(row);

        try {
            const response = await fetch("/api/explain-decision", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    transaction_id: row.transaction_id ?? null,
                    timestamp: row.timestamp,
                    amount: Number(row.amount ?? 0),
                    score_fraude: Number(row.score_fraude ?? 0),
                    limiar_usado: Number(row.limiar_usado ?? threshold),
                    decisao: toDecision(row.decisao),
                    recomendacao_operacional: toRecommendation(row.recomendacao_operacional),
                    top_fatores: topFactors,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                const detail = typeof data?.detail === "string" ? data.detail : "Nao foi possivel gerar a explicacao.";
                setExplanationError(detail);
                return;
            }

            setActiveExplanation(data?.explanation ?? "Nao foi possivel montar a explicacao desta transacao.");
            setExplanationProvider(data?.provider === "openai" ? "openai" : "fallback");
        } catch (_error) {
            setExplanationError("Falha ao buscar explicacao. Verifique a API e tente novamente.");
        } finally {
            setIsLoadingExplanation(false);
        }
    };

    const closeExplanation = () => {
        setSelectedRow(null);
        setActiveExplanation("");
        setExplanationError("");
        setIsLoadingExplanation(false);
    };

    return (
        <section className="animate-fade-up rounded-2xl border border-slate-200 bg-white p-5 shadow-soft" style={{ animationDelay: "260ms" }}>
            <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Transacoes monitoradas</h3>
                    <p className="mt-1 text-xs text-slate-400">Historico consolidado com legitimas e fraudes no mesmo padrao visual</p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-500">Limiar ativo: {Math.round(threshold * 100)}%</span>
                    <button
                        type="button"
                        onClick={onClearHistory}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                        Limpar historico
                    </button>
                </div>
            </div>

            {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
                    <p className="font-medium text-ink">Nenhuma transacao enviada ainda</p>
                    <p className="mt-1 text-sm text-slate-500">As novas inferencias aparecem aqui depois do envio do formulario.</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse">
                        <thead>
                            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                                <th className="pb-3 pr-4">Horario</th>
                                <th className="pb-3 pr-4">Valor</th>
                                <th className="pb-3 pr-4">Score</th>
                                <th className="pb-3 pr-4">Decisao</th>
                                <th className="pb-3 pr-4">Status</th>
                                <th className="pb-3 pr-0">Tipo</th>
                                <th className="pb-3 pl-4 text-right">Acoes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((item) => {
                                const decisionTone = getDecisionTone(item.decisao);
                                const isFraud = item.decisao === "fraude";

                                return (
                                    <tr key={`${item.transaction_id ?? item.timestamp}`} className="border-b border-slate-100 text-sm text-ink">
                                        <td className="py-3 pr-4">{new Date(item.timestamp).toLocaleString("pt-BR")}</td>
                                        <td className="py-3 pr-4">$ {Number(item.amount ?? 0).toFixed(2)}</td>
                                        <td className={`py-3 pr-4 font-semibold ${isFraud ? "text-coral" : "text-emerald"}`}>
                                            {(Number(item.score_fraude ?? 0) * 100).toFixed(2)}%
                                        </td>
                                        <td className="py-3 pr-4 capitalize">{item.decisao}</td>
                                        <td className="py-3 pr-4">
                                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${decisionTone.color}`}>{decisionTone.label}</span>
                                        </td>
                                        <td className="py-3 pr-0 text-xs uppercase tracking-wider text-slate-400">
                                            {item.recomendacao_operacional ?? "--"}
                                        </td>
                                        <td className="py-3 pl-4 text-right">
                                            <button
                                                type="button"
                                                onClick={() => openExplanation(item)}
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
                                                aria-label="Ver explicacao desta decisao"
                                                title="Ver explicacao"
                                            >
                                                <MoreHorizontal size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="mt-4 text-xs text-slate-400">
                {Number(predictionHistory.length).toLocaleString("pt-BR")} transacoes monitoradas no total, sendo {Number(fraudCount).toLocaleString("pt-BR")} classificadas como fraude.
            </div>

            {selectedRow ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6"
                    onClick={closeExplanation}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Explicacao da decisao"
                >
                    <div
                        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                                <p className="text-xs uppercase tracking-wider text-slate-500">Explicacao da decisao</p>
                                <p className="text-sm text-slate-600">
                                    Transacao {selectedRow.transaction_id ?? "sem id"} • Score {(Number(selectedRow.score_fraude ?? 0) * 100).toFixed(2)}%
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeExplanation}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                                aria-label="Fechar popup de explicacao"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {isLoadingExplanation ? (
                            <div className="inline-flex items-center gap-2 text-sm text-slate-500">
                                <Loader2 size={16} className="animate-spin" />
                                Gerando explicacao com ChatGPT...
                            </div>
                        ) : null}

                        {explanationError ? (
                            <p className="text-sm text-coral">{explanationError}</p>
                        ) : null}

                        {!isLoadingExplanation && !explanationError ? (
                            <>
                                <p className="text-sm leading-relaxed text-ink">{activeExplanation}</p>
                                <p className="mt-2 text-xs text-slate-400">
                                    Fonte: {explanationProvider === "openai" ? "ChatGPT" : "fallback local"}
                                </p>
                            </>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </section>
    );
}
