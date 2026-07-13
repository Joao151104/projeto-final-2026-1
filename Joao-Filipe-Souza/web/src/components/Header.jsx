import { ShieldCheck } from "lucide-react";

export function Header() {
    return (
        <header className="animate-fade-up rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-soft backdrop-blur-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                    <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
                        <ShieldCheck size={14} className="text-emerald" />
                        Monitoramento operacional em tempo real
                    </p>
                    <h1 className="font-display text-4xl italic leading-tight text-ink md:text-5xl">
                        Control Tower de Fraude
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm text-slate-600 md:text-base">
                        Visao unificada para risco de fraude, saude da API e volume transacional.
                    </p>
                </div>

                <div className="inline-flex items-center gap-2 rounded-full border border-emerald/30 bg-emerald/10 px-3 py-2 text-sm text-ink">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald" />
                    Ultima atualizacao: agora
                </div>
            </div>
        </header>
    );
}
