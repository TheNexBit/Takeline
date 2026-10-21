// Pannello di pre-flight (Regia), allarme del watchdog e promemoria di consenso.

import {
  CircleCheck,
  CircleX,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

import { AZIONI_REAPER, backend, messaggioErrore } from '../lib/backend';
import type { AzionePreflight, Controllo, EsitoControllo } from '../lib/preflight';
import { useApp } from '../store/app';
import { regia, rispondiConsenso, useRegia } from '../store/regia';
import { Modale, Pulsante } from './ui';

const ICONA: Record<EsitoControllo, [LucideIcon, string]> = {
  ok: [CircleCheck, 'text-emerald-400'],
  avviso: [TriangleAlert, 'text-amber-400'],
  errore: [CircleX, 'text-red-400'],
};

function useAzione() {
  const { connettiObs, applica, apriEditor, apriImpostazioni, impostazioni, avvisa } = useApp.getState();
  return async (tipo: AzionePreflight) => {
    const preset = impostazioni.presetAttivo;
    try {
      switch (tipo) {
        case 'connettiObs':
          return await connettiObs();
        case 'riapplica':
          return preset && (await applica(preset));
        case 'editor':
          return preset && apriEditor(preset);
        case 'impostazioni':
          return apriImpostazioni(true);
        case 'installaFfmpeg':
          return await useApp.getState().installaFfmpeg();
        case 'pedale':
          return useRegia.setState({ pedaleAperto: true });
        case 'libreria':
          return useRegia.setState({ vista: 'libreria' });
        case 'patchbay':
          return useRegia.setState({ vista: 'patchbay' });
        case 'armaTracce':
          await backend.reaperAzione(useApp.getState().impostazioni.reaper, AZIONI_REAPER.armaTutte);
          return;
      }
    } catch (e) {
      avvisa('errore', messaggioErrore(e));
    }
  };
}

function Riga({ c, onAzione }: { c: Controllo; onAzione: (t: AzionePreflight) => void }) {
  const [Icona, colore] = ICONA[c.esito];
  return (
    <li className="flex items-start gap-3 py-2">
      <Icona size={16} className={`mt-0.5 shrink-0 ${colore}`} />
      <div className="min-w-0 flex-1">
        <div className="text-zinc-200">{c.titolo}</div>
        <div className="text-xs leading-snug text-zinc-500">{c.dettaglio}</div>
      </div>
      {c.azione && c.esito !== 'ok' && (
        <Pulsante piccolo onClick={() => onAzione(c.azione!.tipo)}>
          {c.azione.etichetta}
        </Pulsante>
      )}
    </li>
  );
}

/** Esito dell'ultimo pre-flight; si rifa' prima di ogni take e a richiesta. */
export function PannelloPreflight() {
  const pf = useRegia((s) => s.regia.preflight);
  const attivo = useApp((s) => s.impostazioni.sicurezza.preflight);
  const [inCorso, setInCorso] = useState(false);
  const [tutti, setTutti] = useState(false);
  const azione = useAzione();

  const controlla = async () => {
    setInCorso(true);
    await regia.preflight().catch(() => {});
    setInCorso(false);
  };

  const controlli = pf?.controlli ?? [];
  const errori = controlli.filter((c) => c.esito === 'errore').length;
  const avvisi = controlli.filter((c) => c.esito === 'avviso').length;
  const visibili = tutti ? controlli : controlli.filter((c) => c.esito !== 'ok');
  const Scudo = errori ? ShieldAlert : ShieldCheck;

  return (
    <section className="flex flex-col rounded-lg border border-bordo bg-pannello">
      <header className="flex h-11 items-center gap-2 border-b border-bordo/70 px-4">
        <Scudo size={16} className={errori ? 'text-red-400' : avvisi ? 'text-amber-400' : pf ? 'text-emerald-400' : 'text-zinc-500'} />
        <h3 className="flex-1 text-sm font-semibold text-zinc-100">Pre-flight</h3>
        <Pulsante piccolo variante="fantasma" icona={inCorso ? Loader2 : RefreshCcw} disabled={inCorso} onClick={() => void controlla()}>
          Controlla
        </Pulsante>
      </header>
      <div className="flex flex-col gap-1 p-4 text-[13px]">
        {!pf ? (
          <p className="text-zinc-500">
            {attivo
              ? 'Si fa da solo prima di ogni take: un errore la blocca e il motivo compare in stage view. Premi Controlla per vederlo ora.'
              : 'Disattivato in Impostazioni › Sicurezza.'}
          </p>
        ) : (
          <>
            <p className={errori ? 'text-red-300' : avvisi ? 'text-amber-300' : 'text-emerald-300'}>
              {errori
                ? `${errori} problem${errori === 1 ? 'a blocca' : 'i bloccano'} la registrazione`
                : avvisi
                  ? `Si può registrare · ${avvisi} avvis${avvisi === 1 ? 'o' : 'i'}`
                  : 'Tutto pronto per registrare'}
              <span className="ml-2 text-xs text-zinc-600">
                {new Date(pf.quando).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </p>
            <ul className="flex flex-col divide-y divide-bordo/60">
              {visibili.map((c) => (
                <Riga key={c.id} c={c} onAzione={(t) => void azione(t).then(() => void controlla())} />
              ))}
            </ul>
            <button type="button" className="self-start text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setTutti(!tutti)}>
              {tutti ? 'Mostra solo i problemi' : `Mostra tutti i ${controlli.length} controlli`}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** Allarme del watchdog nella finestra principale (in stage view e' a tutto schermo). */
export function AllarmeWatchdog() {
  const allarme = useRegia((s) => s.regia.allarme);
  if (!allarme) return null;
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-semibold ${allarme.livello === 'errore' ? 'border-red-500/50 bg-red-500/15 text-red-200' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'}`}
    >
      <ShieldAlert size={18} className="shrink-0" />
      <span className="flex-1">{allarme.testo}</span>
    </div>
  );
}

/** Promemoria di consenso prima di registrare una call. */
export function ConsensoDialog() {
  const consenso = useRegia((s) => s.consenso);
  if (!consenso) return null;
  return (
    <Modale
      compatta
      titolo="Prima di registrare"
      sottotitolo="Promemoria di consenso"
      onChiudi={() => rispondiConsenso(false)}
      piede={
        <>
          <div className="flex-1" />
          <Pulsante onClick={() => rispondiConsenso(false)}>Non registrare</Pulsante>
          <Pulsante variante="primario" icona={CircleCheck} onClick={() => rispondiConsenso(true)}>
            Tutti d’accordo, registra
          </Pulsante>
        </>
      }
    >
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{consenso.testo}</p>
      <p className="mt-4 text-xs text-zinc-500">
        In Unione Europea registrare una riunione richiede che le persone lo sappiano. Il promemoria si mostra una volta per
        sessione; il testo si cambia (o si disattiva) nel preset, scheda Registrazione.
      </p>
    </Modale>
  );
}
