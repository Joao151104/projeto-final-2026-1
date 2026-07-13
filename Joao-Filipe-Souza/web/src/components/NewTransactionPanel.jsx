import { Loader2, Send, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

const toNumber = (value) => Number.parseFloat(value);

const EXAMPLE_TRANSACTIONS = {
    legit: {
        Time: "0",
        Amount: "149.62",
        V1: "-1.3598071336738",
        V2: "-0.0727811733098497",
        V3: "2.53634673796914",
        V4: "1.37815522427443",
        V5: "-0.3383207699942518",
        V6: "0.462387777762292",
        V7: "0.239598554061257",
        V8: "0.0986979012610507",
        V9: "0.363786969611213",
        V10: "0.0907941719789316",
        V11: "-0.551599533260813",
        V12: "-0.617800855762348",
        V13: "-0.991389847235408",
        V14: "-0.311169353699879",
        V15: "1.46817697209427",
        V16: "-0.470400525259478",
        V17: "0.207971241929242",
        V18: "0.0257905801985591",
        V19: "0.403992960255733",
        V20: "0.251412098239705",
        V21: "-0.018306777944153",
        V22: "0.277837575558899",
        V23: "-0.110473910188767",
        V24: "0.0669280749146731",
        V25: "0.128539358273528",
        V26: "-0.189114843888824",
        V27: "0.133558376740387",
        V28: "-0.0210530534538215",
    },
    fraud: {
        Time: "406",
        Amount: "0",
        V1: "-2.3122265423263",
        V2: "1.95199201064158",
        V3: "-1.60985073229769",
        V4: "3.9979055875468",
        V5: "-0.522187864667764",
        V6: "-1.42654531920595",
        V7: "-2.53738730624579",
        V8: "1.39165724829804",
        V9: "-2.77008927719433",
        V10: "-2.77227214465915",
        V11: "3.20203320709635",
        V12: "-2.89990738849473",
        V13: "-0.595221881324605",
        V14: "-4.28925378244217",
        V15: "0.389724120274487",
        V16: "-1.14074717980657",
        V17: "-2.83005567450437",
        V18: "-0.0168224681808257",
        V19: "0.416955705037907",
        V20: "0.126910559061474",
        V21: "0.517232370861764",
        V22: "-0.0350493686052974",
        V23: "-0.465211076182388",
        V24: "0.320198198514526",
        V25: "0.0445191674731724",
        V26: "0.177839798284401",
        V27: "0.261145002567677",
        V28: "-0.143275874698919",
    },
};

const FIELD_GROUPS = [
    ["Time", "Amount", "V1", "V2", "V3", "V4"],
    ["V5", "V6", "V7", "V8", "V9", "V10"],
    ["V11", "V12", "V13", "V14", "V15", "V16"],
    ["V17", "V18", "V19", "V20", "V21", "V22"],
    ["V23", "V24", "V25", "V26", "V27", "V28"],
];

const FIELD_HINTS = {
    Time: "Segundos desde a primeira transacao do dataset",
    Amount: "Valor da transacao em USD",
};

const buildExampleTransaction = (exampleType = "legit") => ({ ...EXAMPLE_TRANSACTIONS[exampleType] });

const formatErrorMessage = (errorPayload) => {
    if (!errorPayload) return "Nao foi possivel processar a transacao.";
    if (typeof errorPayload.detail === "string") return errorPayload.detail;
    if (Array.isArray(errorPayload.detail) && errorPayload.detail.length > 0) {
        return errorPayload.detail[0]?.msg ?? "Erro de validacao no payload.";
    }
    return "Erro ao enviar dados para a API.";
};

export function NewTransactionPanel({ onPredictionApplied }) {
    const [form, setForm] = useState(() => buildExampleTransaction("legit"));
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [lastResult, setLastResult] = useState(null);

    const isValid = useMemo(() => {
        return Object.entries(form).every(([fieldName, value]) => {
            const numericValue = toNumber(value);
            if (!Number.isFinite(numericValue)) return false;
            if (fieldName === "Amount") return numericValue >= 0;
            return true;
        });
    }, [form]);

    const buildPayload = () => {
        return Object.fromEntries(
            Object.entries(form).map(([fieldName, value]) => [fieldName, toNumber(value)])
        );
    };

    const loadExample = (exampleType) => {
        setForm(buildExampleTransaction(exampleType));
        setErrorMessage("");
        setLastResult(null);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!isValid || isSubmitting) return;

        setIsSubmitting(true);
        setErrorMessage("");

        try {
            const payload = buildPayload();
            const response = await fetch("/api/predict", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            if (!response.ok) {
                setErrorMessage(formatErrorMessage(data));
                return;
            }

            setLastResult(data);
            onPredictionApplied({ prediction: data, payload });
        } catch (_error) {
            setErrorMessage("Falha de conexao com a API. Verifique se o backend esta rodando.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <section className="animate-fade-up rounded-2xl border border-slate-200 bg-white p-5 shadow-soft" style={{ animationDelay: "90ms" }}>
            <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-base font-semibold uppercase tracking-wider text-slate-500">Nova transacao</h2>
                    <p className="mt-1 text-sm text-slate-600">Formulario completo com os 30 atributos exigidos pela API. O exemplo inicial vem de uma transacao real do CSV.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => loadExample("legit")}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                        Exemplo legitimo
                    </button>
                    <button
                        type="button"
                        onClick={() => loadExample("fraud")}
                        className="rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-xs font-medium text-coral transition hover:bg-coral/15"
                    >
                        Exemplo de fraude
                    </button>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                {FIELD_GROUPS.map((group) => (
                    <div key={group.join("-")} className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
                        {group.map((fieldName) => (
                            <label key={fieldName} className="flex flex-col gap-1 text-sm">
                                <span className="font-medium text-slate-600">
                                    {fieldName}
                                    {FIELD_HINTS[fieldName] ? (
                                        <span className="ml-2 text-xs font-normal text-slate-400">{FIELD_HINTS[fieldName]}</span>
                                    ) : null}
                                </span>
                                <input
                                    className="rounded-lg border border-slate-300 px-3 py-2 outline-none transition focus:border-ink"
                                    value={form[fieldName]}
                                    onChange={(event) => setForm((prev) => ({ ...prev, [fieldName]: event.target.value }))}
                                    inputMode="decimal"
                                />
                            </label>
                        ))}
                    </div>
                ))}

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-500">O payload enviado para a API usa todos os 30 atributos da transacao.</p>
                    <button
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-400"
                        type="submit"
                        disabled={!isValid || isSubmitting}
                    >
                        {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        {isSubmitting ? "Enviando" : "Verificar transacao"}
                    </button>
                </div>
            </form>

            {errorMessage ? (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral">
                    <TriangleAlert size={16} />
                    {errorMessage}
                </div>
            ) : null}

            {lastResult ? (
                <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
                    <div>
                        <p className="text-xs uppercase tracking-wider text-slate-500">Score</p>
                        <p className="text-lg font-semibold text-ink">{(lastResult.score_fraude * 100).toFixed(2)}%</p>
                    </div>
                    <div>
                        <p className="text-xs uppercase tracking-wider text-slate-500">Decisao</p>
                        <p className="text-lg font-semibold text-ink">{lastResult.decisao}</p>
                    </div>
                    <div>
                        <p className="text-xs uppercase tracking-wider text-slate-500">Acao</p>
                        <p className="text-lg font-semibold text-ink">{lastResult.recomendacao_operacional}</p>
                    </div>
                    <div>
                        <p className="text-xs uppercase tracking-wider text-slate-500">Limiar</p>
                        <p className="text-lg font-semibold text-ink">{(lastResult.limiar_usado * 100).toFixed(0)}%</p>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
