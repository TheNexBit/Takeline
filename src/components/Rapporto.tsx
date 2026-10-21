import { openPath } from '@tauri-apps/plugin-opener';
import { Check, CircleDashed, FolderArchive, Link2, Loader2, Minus, Play, Plus, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';

import { ETICHETTA_CAMPO, type EsitoPasso } from '../lib/applicaPreset';
import { messaggioErrore } from '../lib/backend';
import { useApp } from '../store/app';
import { CLASSE_INPUT, Pulsante } from './ui';

const ICONA: Record<EsitoPasso, JSX.Element> = {
  attesa: <CircleDashed size={14} className="text-zinc-600" />,
  'in-corso': <Loader2 size={14} className="animate-spin text-sky-400" />,
  ok: <Check size={14} className="text-emerald-400" />,
  avviso: <TriangleAlert size={14} className="text-amber-400" />,
  errore: <X size={14} className="text-red-400" />,
  saltato: <Minus size={14} className="text-zinc-600" />,
};

export function Rapporto() {
  const { rapporto, applicando, preset } = useApp();
  const { chiudiRapporto, avvisa } = useApp.getState();
  if (!rapporto) return null;
  const p = preset.find((x) => x.id === rapporto.presetId);
  const fallito = !applicando && !rapporto.riuscito;

  return (
    <section
      className={`rounded-lg border bg-pannello ${fallito ? 'border-red-500/40' : rapporto.riuscito ? 'border-emerald-500/30' : 'border-bordo'}`}
    >
      <header className="flex h-10 items-center gap-2 border-b border-bordo px-3">
        <h3 className="flex-1 text-xs font-semibold text-zinc-200">
          {applicando ? 'Applico' : fallito ? 'Non applicato' : 'Applicato'}: {p?.nome ?? rapporto.presetId}
        </h3>
        {rapporto.cartellaBackup && (
          <Pulsante
            piccolo
            variante="fantasma"
            icona={FolderArchive}
            onClick={() => openPath(rapporto.cartellaBackup!).catch((e) => avvisa('errore', messaggioErrore(e)))}
          >
            Apri backup
          </Pulsante>
        )}
        {!applicando && <Pulsante piccolo variante="fantasma" icona={X} title="Chiudi" onClick={chiudiRapporto} />}
      </header>
      <ol className="flex flex-col py-1.5">
        {rapporto.passi.map((s) => (
          <li key={s.id} className="flex gap-2.5 px-3 py-1 text-xs">
            <span className="mt-px shrink-0">{ICONA[s.esito]}</span>
            <span className={`w-48 shrink-0 ${s.esito === 'attesa' || s.esito === 'saltato' ? 'text-zinc-500' : 'text-zinc-200'}`}>
              {s.etichetta}
            </span>
            <span
              className={`min-w-0 flex-1 break-words ${s.esito === 'errore' ? 'text-red-300' : s.esito === 'avviso' ? 'text-amber-300' : 'text-zinc-500'}`}
            >
              {s.dettaglio}
            </span>
          </li>
        ))}
      </ol>
      {!applicando && rapporto.mancanti.length > 0 && (
        <SceltaMancanti key={rapporto.mancanti.map((m) => m.campo + m.nome).join('|')} />
      )}
      {!applicando && rapporto.riuscito && rapporto.mancanti.length === 0 && <ProponiCollegamento />}
    </section>
  );
}

/** Preset con campi OBS vuoti: propone di fissare quelli attivi, cosi' la prossima volta li ritrova. */
function ProponiCollegamento() {
  const { rapporto, obs, preset } = useApp();
  const { collegaAObs } = useApp.getState();
  const p = preset.find((x) => x.id === rapporto?.presetId);
  const ist = obs.ist;
  if (!p || !ist || (p.obs.sceneCollection && p.obs.profilo && p.obs.scena)) return null;
  return (
    <footer className="flex items-center gap-3 border-t border-bordo px-3 py-2.5 text-xs">
      <span className="flex-1 text-zinc-400">
        Il preset usa la configurazione attiva di OBS. Vuoi che la ricordi? La prossima volta OBS tornerà su{' '}
        <span className="text-zinc-200">
          {ist.collezione} / {ist.profilo} / {ist.scena}
        </span>
        .
      </span>
      <Pulsante piccolo icona={Link2} onClick={() => collegaAObs(p.id)}>
        Ricorda nel preset
      </Pulsante>
    </footer>
  );
}

const CREA = '\u0000crea';

/** Per ogni nome che non esiste: usa uno esistente (proposto quello attivo) oppure crealo. */
function SceltaMancanti() {
  const { rapporto, obs } = useApp();
  const { applicaConScelte } = useApp.getState();
  const mancanti = rapporto?.mancanti ?? [];
  const attivo = { sceneCollection: obs.ist?.collezione, profilo: obs.ist?.profilo, scena: obs.ist?.scena };
  const [scelte, setScelte] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      mancanti.map((m) => {
        const corrente = attivo[m.campo];
        return [m.campo, corrente && m.esistenti.includes(corrente) ? corrente : (m.esistenti[0] ?? CREA)];
      }),
    ),
  );
  if (!rapporto) return null;
  const creaQualcosa = Object.values(scelte).includes(CREA);

  return (
    <footer className="flex flex-col gap-2.5 border-t border-bordo px-3 py-3 text-xs">
      <span className="text-zinc-400">
        Il preset chiede elementi che in OBS non esistono. Scegli cosa usare: la scelta viene salvata nel preset.
      </span>
      {mancanti.map((m) => (
        <label key={m.campo} className="flex items-center gap-3">
          <span className="w-32 shrink-0 text-zinc-500">{ETICHETTA_CAMPO[m.campo]}</span>
          <select
            className={`${CLASSE_INPUT} !max-w-sm`}
            value={scelte[m.campo]}
            onChange={(e) => setScelte((s) => ({ ...s, [m.campo]: e.target.value }))}
          >
            {m.esistenti.length > 0 && (
              <optgroup label="Già in OBS">
                {m.esistenti.map((v) => (
                  <option key={v} value={v}>
                    {v}
                    {v === attivo[m.campo] ? ' (attiva ora)' : ''}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Nuova">
              <option value={CREA}>Crea “{m.nome}” (vuota)</option>
            </optgroup>
          </select>
        </label>
      ))}
      <div className="flex items-center justify-end gap-3">
        {creaQualcosa && <span className="text-zinc-500">Prima di creare rifaccio il backup.</span>}
        <Pulsante
          piccolo
          variante="primario"
          icona={creaQualcosa ? Plus : Play}
          onClick={() =>
            applicaConScelte(
              rapporto.presetId,
              Object.fromEntries(mancanti.map((m) => [m.campo, scelte[m.campo] === CREA ? null : scelte[m.campo]])),
            )
          }
        >
          {creaQualcosa ? 'Crea e applica' : 'Usa e applica'}
        </Pulsante>
      </div>
    </footer>
  );
}
