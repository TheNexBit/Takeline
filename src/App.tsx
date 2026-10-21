import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect } from 'react';

import { Header } from './components/Header';
import { Impostazioni } from './components/Impostazioni';
import { Libreria } from './components/Libreria';
import { Patchbay } from './components/Patchbay';
import { PedaleDialog } from './components/PedaleDialog';
import { PresetEditor } from './components/PresetEditor';
import { PresetRail } from './components/PresetRail';
import { Rapporto } from './components/Rapporto';
import { ConsensoDialog } from './components/Sicurezza';
import { Regia } from './components/Regia';
import { useApp, type TipoAvviso } from './store/app';
import { avviaPost } from './store/post';
import { avviaRegia, useRegia, type Vista } from './store/regia';

const STILE_AVVISO: Record<TipoAvviso, [string, JSX.Element]> = {
  info: ['border-bordo', <Info size={14} className="text-sky-400" />],
  ok: ['border-emerald-500/40', <Check size={14} className="text-emerald-400" />],
  avviso: ['border-amber-500/40', <TriangleAlert size={14} className="text-amber-400" />],
  errore: ['border-red-500/50', <TriangleAlert size={14} className="text-red-400" />],
};

function Avvisi() {
  const avvisi = useApp((s) => s.avvisi);
  const chiudi = useApp((s) => s.chiudiAvviso);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 flex-col gap-2">
      {avvisi.map((a) => (
        <div
          key={a.id}
          className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-rilievo px-3 py-2.5 text-xs text-zinc-200 shadow-xl ${STILE_AVVISO[a.tipo][0]}`}
        >
          <span className="mt-px">{STILE_AVVISO[a.tipo][1]}</span>
          <span className="flex-1 break-words">{a.testo}</span>
          <button type="button" className="text-zinc-500 hover:text-zinc-200" onClick={() => chiudi(a.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

const SCHEDE: [Vista, string][] = [
  ['regia', 'Regia'],
  ['libreria', 'Libreria'],
  ['patchbay', 'Patchbay'],
];

function Schede() {
  const vista = useRegia((s) => s.vista);
  return (
    <nav className="-mb-1 flex gap-1 border-b border-bordo">
      {SCHEDE.map(([id, etichetta]) => (
        <button
          key={id}
          type="button"
          onClick={() => useRegia.setState({ vista: id })}
          className={`-mb-px border-b-2 px-3 pb-2 text-xs font-semibold transition-colors ${vista === id ? 'border-zinc-100 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
        >
          {etichetta}
        </button>
      ))}
    </nav>
  );
}

let avviata = false;

export default function App() {
  const pronto = useApp((s) => s.pronto);
  const erroreAvvio = useApp((s) => s.erroreAvvio);
  const vista = useRegia((s) => s.vista);

  useEffect(() => {
    // StrictMode monta due volte in sviluppo: l'avvio deve restare unico.
    if (avviata) return;
    avviata = true;
    void useApp.getState().avvia().then(() => {
      if (useApp.getState().erroreAvvio) return;
      void avviaRegia();
      void avviaPost();
    });
  }, []);

  if (!pronto) return null;
  if (erroreAvvio) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-lg rounded-lg border border-red-500/40 bg-red-500/10 p-5 text-sm text-red-200">
          <h1 className="mb-2 font-semibold">Takeline non è riuscita ad avviarsi</h1>
          <p>{erroreAvvio}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <PresetRail />
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <Schede />
          <Rapporto />
          {vista === 'regia' ? <Regia /> : vista === 'libreria' ? <Libreria /> : <Patchbay />}
        </main>
      </div>
      <PresetEditor />
      <Impostazioni />
      <PedaleDialog />
      <ConsensoDialog />
      <Avvisi />
    </div>
  );
}
