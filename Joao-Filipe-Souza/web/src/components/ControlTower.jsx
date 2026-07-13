import { useEffect, useMemo, useState } from "react";
import { AlertsTable } from "./AlertsTable";
import { Filters } from "./Filters";
import { Header } from "./Header";
import { KpiCards } from "./KpiCards";
import { NewTransactionPanel } from "./NewTransactionPanel";
import { generateMockData } from "../data";

const HISTORY_STORAGE_KEY = "fraud-control-tower-history-v1";
const PREDICTION_HISTORY_STORAGE_KEY = "fraud-control-tower-predictions-v1";

const formatHour = (date) => date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const normalizePoint = (item, index) => ({
    hour: item.hour ?? formatHour(new Date(Date.now() - index * 60 * 60 * 1000)),
    timestamp: item.timestamp ?? `${index}`,
    fraud_rate: Number(item.fraud_rate ?? 0),
    amount_p95: Number(item.amount_p95 ?? 0),
    transactions: Number(item.transactions ?? 0),
    api_error_rate: Number(item.api_error_rate ?? 0),
});

const readStoredHistory = () => {
    if (typeof window === "undefined") return null;

    try {
        const rawHistory = window.localStorage.getItem(HISTORY_STORAGE_KEY);
        if (!rawHistory) return null;

        const parsedHistory = JSON.parse(rawHistory);
        if (!Array.isArray(parsedHistory) || parsedHistory.length === 0) return null;

        return parsedHistory.map((item, index) => normalizePoint(item, index));
    } catch (_error) {
        return null;
    }
};

const readStoredPredictions = () => {
    if (typeof window === "undefined") return [];

    try {
        const rawPredictions = window.localStorage.getItem(PREDICTION_HISTORY_STORAGE_KEY);
        if (!rawPredictions) return [];

        const parsedPredictions = JSON.parse(rawPredictions);
        return Array.isArray(parsedPredictions) ? parsedPredictions : [];
    } catch (_error) {
        return [];
    }
};

const persistHistory = (points) => {
    if (typeof window === "undefined" || points.length === 0) return;

    try {
        window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(points.slice(-96)));
    } catch (_error) {
        // Ignore storage quota and privacy mode failures.
    }
};

const persistPredictions = (predictions) => {
    if (typeof window === "undefined") return;

    try {
        window.localStorage.setItem(PREDICTION_HISTORY_STORAGE_KEY, JSON.stringify(predictions.slice(-200)));
    } catch (_error) {
        // Ignore storage quota and privacy mode failures.
    }
};

const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor((p / 100) * (sorted.length - 1));
    return sorted[index] ?? 0;
};

export function ControlTower() {
    const [threshold, setThreshold] = useState(0.5);
    const [dataPoints, setDataPoints] = useState(() => readStoredHistory() ?? []);
    const [predictionHistory, setPredictionHistory] = useState(() => readStoredPredictions());
    const [lastPrediction, setLastPrediction] = useState(null);
    const [modelInfo, setModelInfo] = useState(null);

    useEffect(() => {
        persistHistory(dataPoints);
    }, [dataPoints]);

    useEffect(() => {
        persistPredictions(predictionHistory);
    }, [predictionHistory]);

    useEffect(() => {
        let isMounted = true;

        const loadModelInfo = async () => {
            try {
                const response = await fetch("/api/model-info");
                if (!response.ok) return false;

                const payload = await response.json();
                const hasMetrics = Boolean(payload?.validation_metrics);
                if (!isMounted) return hasMetrics;

                if (payload?.model_loaded && hasMetrics) {
                    setModelInfo(payload);
                    return true;
                }

                return false;
            } catch (_error) {
                if (isMounted) setModelInfo(null);
                return false;
            }
        };

        loadModelInfo();

        const intervalId = window.setInterval(async () => {
            const loaded = await loadModelInfo();
            if (loaded) {
                window.clearInterval(intervalId);
            }
        }, 5000);

        return () => {
            isMounted = false;
            window.clearInterval(intervalId);
        };
    }, []);

    useEffect(() => {
        if (dataPoints.length > 0) return;

        const loadMetricsFromCsv = async () => {
            try {
                const response = await fetch("/api/metrics/hourly?hours=96");
                if (!response.ok) {
                    setDataPoints(generateMockData());
                    return;
                }

                const payload = await response.json();
                if (!Array.isArray(payload) || payload.length === 0) {
                    setDataPoints(generateMockData());
                    return;
                }

                setDataPoints(payload.map(normalizePoint));
            } catch (_error) {
                setDataPoints(generateMockData());
            }
        };

        loadMetricsFromCsv();
    }, [dataPoints.length]);

    const viewData = useMemo(() => dataPoints, [dataPoints]);

    const appendPredictionPoint = ({ prediction, payload }) => {
        setLastPrediction({ prediction, payload, timestamp: new Date().toISOString() });
        setPredictionHistory((previous) => [
            ...previous,
            {
                transaction_id: prediction?.transaction_id ?? null,
                timestamp: new Date().toISOString(),
                time: Number(payload?.Time ?? 0),
                amount: Number(payload?.Amount ?? 0),
                score_fraude: Number(prediction?.score_fraude ?? 0),
                decisao: prediction?.decisao ?? "legitima",
                recomendacao_operacional: prediction?.recomendacao_operacional ?? "liberar",
                limiar_usado: Number(prediction?.limiar_usado ?? threshold),
                top_fatores: prediction?.top_fatores ?? {},
                transaction_payload: payload ?? {},
                explicacao: prediction?.explicacao ?? "",
            },
        ].slice(-200));

        setDataPoints((previous) => {
            const now = new Date();
            const last = previous[previous.length - 1];
            const baselineAmountP95 = last?.amount_p95 ?? 180;
            const baselineTransactions = last?.transactions ?? 1100;
            const baselineErrorRate = last?.api_error_rate ?? 0.3;
            const currentAmount = Number(payload?.Amount ?? baselineAmountP95);

            const nextPoint = {
                hour: formatHour(now),
                timestamp: now.toISOString(),
                fraud_rate: Number(prediction.score_fraude ?? 0),
                amount_p95: Math.max(1, Number(((baselineAmountP95 * 0.7) + (currentAmount * 0.3)).toFixed(2))),
                // Keep transaction volume tied to CSV-derived history (no synthetic random drift).
                transactions: baselineTransactions,
                api_error_rate: Number(baselineErrorRate.toFixed(3)),
            };

            return [...previous, nextPoint].slice(-96);
        });
    };

    const clearStoredHistory = () => {
        if (typeof window !== "undefined") {
            window.localStorage.removeItem(HISTORY_STORAGE_KEY);
            window.localStorage.removeItem(PREDICTION_HISTORY_STORAGE_KEY);
        }

        setDataPoints([]);
        setPredictionHistory([]);
        setLastPrediction(null);
    };

    const kpis = useMemo(() => {
        const latestWindowRisk = (viewData[viewData.length - 1]?.fraud_rate ?? 0) * 100;
        const analyzedRisk = lastPrediction?.prediction?.score_fraude != null
            ? Number(lastPrediction.prediction.score_fraude) * 100
            : latestWindowRisk;

        const validationMetrics = modelInfo?.validation_metrics ?? {};

        return {
            fraudScore: analyzedRisk,
            monitoredTransactions: predictionHistory.length,
            modelPrecision: validationMetrics.precision ?? null,
            modelRecall: validationMetrics.recall ?? null,
            threshold,
            alertsCount: viewData.filter((item) => item.fraud_rate >= threshold).length,
        };
    }, [viewData, lastPrediction, modelInfo, predictionHistory.length, threshold]);

    return (
        <main className="min-h-screen bg-gradient-to-br from-[#f8f7f5] via-[#f2f4f8] to-[#eceff3] px-4 py-8 font-body text-ink md:px-8">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
                <Header />
                <NewTransactionPanel onPredictionApplied={appendPredictionPoint} />
                <KpiCards
                    kpis={kpis}
                    lastPrediction={lastPrediction}
                    modelInfo={modelInfo}
                />
                <Filters
                    threshold={threshold}
                    setThreshold={setThreshold}
                />
                <AlertsTable
                    threshold={threshold}
                    predictionHistory={predictionHistory}
                    onClearHistory={clearStoredHistory}
                />
            </div>
        </main>
    );
}
