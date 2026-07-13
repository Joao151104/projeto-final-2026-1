const createSeededRandom = (seed) => {
    let t = seed;
    return () => {
        t += 0x6d2b79f5;
        let n = Math.imul(t ^ (t >>> 15), t | 1);
        n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
};

const formatHour = (date) =>
    date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export const generateMockData = () => {
    const random = createSeededRandom(20260712);
    const points = [];
    const now = new Date();

    const spikeIndexes = new Set([8, 19, 31, 39, 44]);

    for (let i = 47; i >= 0; i -= 1) {
        const hourDate = new Date(now.getTime() - i * 60 * 60 * 1000);

        const baselineFraud = 0.12 + random() * 0.08;
        const spike = spikeIndexes.has(47 - i) ? 0.18 + random() * 0.1 : 0;
        const fraudRate = Math.min(0.85, baselineFraud + spike);

        const amountP95 = Math.round(160 + random() * 220 + (spike > 0 ? 60 : 0));
        const transactions = Math.round(900 + random() * 850 - (spike > 0 ? 90 : 0));
        const apiErrorRate = Math.max(0.07, 0.23 + random() * 0.35 + (spike > 0 ? 0.15 : 0));

        points.push({
            hour: formatHour(hourDate),
            timestamp: hourDate.toISOString(),
            fraud_rate: Number(fraudRate.toFixed(4)),
            amount_p95: amountP95,
            transactions,
            api_error_rate: Number(apiErrorRate.toFixed(3)),
        });
    }

    return points;
};
