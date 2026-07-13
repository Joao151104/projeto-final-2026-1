export function Filters({ threshold, setThreshold }) {
    return (
        <section className="animate-fade-up rounded-2xl border border-slate-200 bg-white p-5 shadow-soft" style={{ animationDelay: "120ms" }}>
            <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">Limiar de alerta</h3>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-slate-600">Configuracao atual</span>
                        <span className="font-semibold text-ink">{Math.round(threshold * 100)}%</span>
                    </div>
                    <input
                        className="w-full accent-coral"
                        type="range"
                        min={10}
                        max={90}
                        step={1}
                        value={Math.round(threshold * 100)}
                        onChange={(event) => setThreshold(Number(event.target.value) / 100)}
                    />
                </div>
            </div>
        </section>
    );
}
