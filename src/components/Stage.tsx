// Stage view: l'unica schermata che si guarda mentre si registra. Da tre
// metri e di sbieco: caratteri enormi, pochi elementi, colori pieni.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';

import { canaleStage, type StatoStage } from '../lib/stage';
import { acceleratoreDa } from '../lib/tastiera';
import { formattaDurata, formattaTimecode, pad2 } from '../lib/tempo';

const DURATA_MESSAGGIO = 2600;

const COLORE_MESSAGGIO = {
  info: 'bg-zinc-100 text-black',
  ok: 'bg-emerald-400 text-black',
  avviso: 'bg-amber-400 text-black',
  errore: 'bg-red-600 text-white',
} as const;

const ETICHETTA_MARKER = { buono: 'BUONO', taglia: 'TAGLIA', capitolo: 'CAPITOLO', clap: 'CLAP' } as const;

function useOra(intervallo: number) {
  const [ora, setOra] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setOra(Date.now()), intervallo);
    return () => clearInterval(t);
  }, [intervallo]);
  return ora;
}

const anteprima = () => (window as { __TAKELINE_ANTEPRIMA__?: boolean }).__TAKELINE_ANTEPRIMA__ === true;

async function alternaSchermoIntero(forza?: boolean) {
  if (anteprima()) {
    if (forza === false || document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await document.documentElement.requestFullscreen().catch(() => {});
    return;
  }
  const w = getCurrentWindow();
  await w.setFullscreen(forza ?? !(await w.isFullscreen()));
}

export function Stage() {
  const [s, setS] = useState<StatoStage | null>(null);
  const [flash, setFlash] = useState(false);
  const ultimoFlash = useRef<number | null>(null);
  const ora = useOra(200);

  useEffect(() => {
    document.title = 'Takeline · Stage';
    const stacca = canaleStage.suStato(setS);
    canaleStage.annunciaPronta();
    const tasti = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        void alternaSchermoIntero();
      } else if (e.key === 'Escape') {
        void alternaSchermoIntero(false);
      } else {
        const acc = acceleratoreDa(e);
        if (acc && !e.repeat) {
          e.preventDefault();
          canaleStage.inviaTasto(acc);
        }
      }
    };
    window.addEventListener('keydown', tasti);
    return () => {
      stacca();
      window.removeEventListener('keydown', tasti);
    };
  }, []);

  // Il primo stato ricevuto non deve far lampeggiare: solo gli incrementi successivi.
  useEffect(() => {
    if (!s) return;
    if (ultimoFlash.current !== null && s.flash > ultimoFlash.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 160);
      ultimoFlash.current = s.flash;
      return () => clearTimeout(t);
    }
    ultimoFlash.current = s.flash;
  }, [s?.flash]);

  if (!s) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-[3vw] font-semibold text-zinc-600">
        In attesa di Takeline…
      </div>
    );
  }

  const registra = s.fase === 'registra';
  const secondi = registra && s.inizioMs ? (ora - s.inizioMs) / 1000 : 0;
  const messaggio = s.messaggio && ora - s.messaggio.quando < DURATA_MESSAGGIO ? s.messaggio : null;
  const coperto = s.replay.attivo
    ? s.replay.avviatoMs
      ? Math.min(s.replay.secondiMax, (ora - s.replay.avviatoMs) / 1000)
      : s.replay.secondiMax
    : 0;

  const stato =
    s.fase === 'registra'
      ? { testo: 'REC', classe: 'text-red-500' }
      : s.fase === 'avvio'
        ? { testo: 'AVVIO…', classe: 'text-amber-400' }
        : s.fase === 'arresto'
          ? { testo: 'STOP…', classe: 'text-amber-400' }
          : { testo: s.sessioneAttiva ? 'PRONTO' : 'FERMO', classe: 'text-zinc-500' };

  return (
    <div
      className={`relative flex h-full select-none flex-col overflow-hidden bg-black px-[3vw] py-[2.5vh] text-white ${registra ? 'shadow-[inset_0_0_0_1.2vw_rgba(239,68,68,0.85)]' : ''}`}
      onDoubleClick={() => void alternaSchermoIntero()}
    >
      {/* stato e contesto */}
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-[1.5vw] text-[7vw] font-black leading-none tracking-tight ${stato.classe}`}>
          <span
            className={`inline-block h-[5.5vw] w-[5.5vw] rounded-full ${registra ? 'animate-pulse bg-red-500' : 'bg-zinc-700'}`}
          />
          {stato.testo}
        </div>
        <div className="max-w-[45vw] text-right leading-tight">
          <div className="truncate text-[2.6vw] font-bold text-zinc-200">{s.titolo || s.preset || 'Takeline'}</div>
          {s.titolo && <div className="truncate text-[1.8vw] font-semibold text-zinc-500">{s.preset}</div>}
        </div>
      </div>

      {/* timecode */}
      <div className="flex flex-1 items-center justify-center">
        <div
          className={`font-mono text-[17vw] font-bold leading-none tracking-tighter tabular-nums ${registra ? 'text-white' : 'text-zinc-700'}`}
        >
          {formattaTimecode(secondi)}
        </div>
      </div>

      {/* take e scaletta */}
      <div className="flex items-end justify-between gap-[3vw]">
        <div className="shrink-0">
          <div className="text-[2vw] font-bold uppercase tracking-widest text-zinc-500">Take</div>
          <div className="text-[9vw] font-black leading-none tabular-nums">{s.take ? pad2(s.take) : '—'}</div>
        </div>
        {s.sezione || s.prossima ? (
          <div className="min-w-0 text-right">
            <div className="text-[2vw] font-bold uppercase tracking-widest text-zinc-500">
              {s.sezione ? `Sezione ${s.sezioneNumero}${s.sezioniTotali ? `/${s.sezioniTotali}` : ''}` : 'Prima sezione'}
            </div>
            <div className="truncate text-[5.5vw] font-extrabold leading-tight text-sky-300">{s.sezione ?? s.prossima}</div>
            {s.sezione && s.prossima && (
              <div className="truncate text-[2.6vw] font-semibold text-zinc-400">poi: {s.prossima}</div>
            )}
          </div>
        ) : null}
      </div>

      {/* riga di stato */}
      <div className="mt-[2vh] flex items-center gap-[2.5vw] border-t-2 border-zinc-800 pt-[1.5vh] text-[2.2vw] font-bold">
        <span className={s.ultimoMarker ? 'text-zinc-200' : 'text-zinc-700'}>
          {s.ultimoMarker
            ? `${ETICHETTA_MARKER[s.ultimoMarker.tipo]} ${formattaDurata(s.ultimoMarker.tempoS)}`
            : 'nessun marker'}
        </span>
        <span className="flex-1" />
        <span className={s.replay.attivo ? 'text-violet-300' : 'text-zinc-700'}>
          REPLAY {s.replay.attivo ? formattaDurata(coperto) : s.replay.disponibile ? 'FERMO' : 'OFF'}
        </span>
        <span className={s.reaperRegistra ? 'text-red-400' : 'text-zinc-700'}>REAPER {s.reaperRegistra ? 'REC' : '—'}</span>
        <span className={s.pedale ? 'text-emerald-400' : 'text-amber-400'}>{s.pedale ? 'PEDALE' : 'NO PEDALE'}</span>
      </div>

      {s.allarme && (
        <div
          className={`absolute inset-x-0 top-[20%] py-[1.6vh] text-center text-[4.2vw] font-black leading-tight ${s.allarme.livello === 'errore' ? 'animate-pulse bg-red-600 text-white' : 'bg-amber-400 text-black'}`}
        >
          {s.allarme.testo}
        </div>
      )}

      {!s.obsConnesso && (
        <div className="absolute inset-x-0 top-[38%] bg-red-600 py-[2vh] text-center text-[5vw] font-black">
          OBS NON CONNESSO
        </div>
      )}

      {messaggio && (
        <div className="pointer-events-none absolute inset-x-[6vw] top-[30%] flex justify-center">
          <div
            className={`max-w-full truncate rounded-[1.5vw] px-[3vw] py-[2vh] text-[6vw] font-black leading-none shadow-2xl ${COLORE_MESSAGGIO[messaggio.livello]}`}
          >
            {messaggio.testo}
          </div>
        </div>
      )}

      {flash && <div className="pointer-events-none absolute inset-0 bg-white" />}
    </div>
  );
}
