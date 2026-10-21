import { HardDrive, Loader2, Settings, type LucideIcon } from 'lucide-react';

import { formattaByte } from '../lib/backend';
import { useApp } from '../store/app';
import { useRegia } from '../store/regia';
import { CLASSE_INPUT, Pallino, Pulsante, type Esito } from './ui';

export const SOGLIA_DISCO_AVVISO = 50 * 1024 ** 3;
export const SOGLIA_DISCO_ERRORE = 10 * 1024 ** 3;

export function esitoDisco(libero: number | undefined): Esito {
  if (libero === undefined) return 'spento';
  if (libero < SOGLIA_DISCO_ERRORE) return 'errore';
  if (libero < SOGLIA_DISCO_AVVISO) return 'avviso';
  return 'ok';
}

function Stato({
  esito,
  etichetta,
  valore,
  titolo,
  onClick,
  icona: Icona,
  inCorso,
}: {
  esito: Esito;
  etichetta: string;
  valore: string;
  titolo?: string;
  onClick?: () => void;
  icona?: LucideIcon;
  inCorso?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titolo}
      className={`flex h-9 items-center gap-2 rounded-md border border-bordo bg-pannello px-3 text-[13px] ${onClick ? 'hover:bg-rilievo' : 'cursor-default'}`}
    >
      {inCorso ? <Loader2 size={12} className="animate-spin text-amber-400" /> : Icona ? <Icona size={13} className="text-zinc-500" /> : <Pallino esito={esito} />}
      <span className="text-zinc-500">{etichetta}</span>
      <span className="max-w-[140px] truncate font-medium tabular-nums text-zinc-200">{valore}</span>
    </button>
  );
}

/** Il pedale e' "pronto" se il MIDI e' attivo, avvia/ferma e' assegnato e il dispositivo c'e'. */
function StatoPedale() {
  const midi = useRegia((s) => s.midi);
  const { mappa, dispositivo } = useApp((s) => s.impostazioni.pedale);
  const assegnati = Object.keys(mappa).length;
  const collegato = dispositivo ? midi.dispositivi.includes(dispositivo) : midi.dispositivi.length > 0;
  const [esito, valore]: [Esito, string] =
    midi.stato === 'negato' || midi.stato === 'non-supportato'
      ? ['errore', 'MIDI non disponibile']
      : assegnati === 0
        ? ['spento', 'da configurare']
        : midi.stato !== 'pronto'
          ? ['avviso', 'MIDI non attivo']
          : !collegato
            ? ['errore', 'non collegato']
            : !mappa.avviaFerma
              ? ['avviso', 'manca avvia/ferma']
              : ['ok', dispositivo || midi.dispositivi[0]];
  return (
    <Stato
      esito={esito}
      etichetta="Pedale"
      valore={valore}
      titolo="Configura pedale e tasti"
      onClick={() => useRegia.setState({ pedaleAperto: true })}
    />
  );
}

export function Header() {
  const { obs, reaper, ffmpeg, disco, impostazioni, preset } = useApp();
  const { connettiObs, disconnettiObs, apriImpostazioni, impostaTitolo } = useApp.getState();
  const attivo = preset.find((p) => p.id === impostazioni.presetAttivo);

  const obsEsito: Esito =
    obs.stato === 'connesso' ? 'ok' : obs.stato === 'disconnesso' ? (obs.motivo ? 'errore' : 'spento') : 'avviso';
  const obsValore =
    obs.stato === 'connesso'
      ? (obs.info?.versioneMotore ?? 'connesso')
      : obs.stato === 'ricarico'
        ? 'ricarica…'
        : obs.stato === 'connessione'
          ? 'connessione…'
          : 'non connesso';

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-bordo bg-pannello/60 px-4">
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 512 512" className="h-7 w-7" aria-hidden>
          <rect width="512" height="512" rx="112" fill="#1a1e25" />
          <rect x="56" y="232" width="400" height="48" rx="24" fill="#2a3038" />
          <rect x="56" y="232" width="220" height="48" rx="24" fill="#f2f4f7" />
          <circle cx="356" cy="256" r="84" fill="#ef4444" />
          <circle cx="356" cy="256" r="34" fill="#1a1e25" />
        </svg>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-zinc-100">Takeline</div>
          <div className="text-[11px] text-zinc-500">{attivo ? attivo.nome : 'nessun preset applicato'}</div>
        </div>
      </div>

      <label className="ml-2 flex min-w-0 max-w-sm flex-1 items-center gap-2">
        <span className="shrink-0 text-xs text-zinc-500">Titolo</span>
        <input
          className={CLASSE_INPUT}
          value={impostazioni.titolo}
          placeholder="usato in {titolo}, es. Blues in La"
          onChange={(e) => impostaTitolo(e.target.value)}
        />
      </label>

      <div className="ml-auto flex items-center gap-2">
        <Stato
          esito={obsEsito}
          etichetta="OBS"
          valore={obsValore}
          inCorso={obs.stato === 'connessione' || obs.stato === 'ricarico'}
          titolo={
            obs.stato === 'connesso'
              ? `obs-websocket ${obs.info?.versioneProtocollo ?? ''} — clic per disconnettere`
              : (obs.motivo ?? 'Clic per connettere')
          }
          onClick={() => (obs.stato === 'connesso' ? disconnettiObs() : connettiObs())}
        />
        <Stato
          esito={reaper.stato ? (reaper.stato.stato === 5 ? 'attivo' : 'ok') : 'errore'}
          etichetta="Reaper"
          valore={reaper.stato ? (reaper.stato.stato === 5 ? 'REC' : 'raggiungibile') : 'non risponde'}
          titolo={reaper.errore ?? undefined}
        />
        <StatoPedale />
        <Stato
          esito={ffmpeg ? (ffmpeg.trovato ? 'ok' : 'errore') : 'spento'}
          etichetta="ffmpeg"
          valore={ffmpeg ? (ffmpeg.trovato ? (ffmpeg.versione ?? 'presente') : 'assente') : '…'}
          titolo={ffmpeg?.errore ?? ffmpeg?.comando}
        />
        <Stato
          esito={esitoDisco(disco?.libero)}
          icona={HardDrive}
          etichetta="Libero"
          valore={disco ? formattaByte(disco.libero) : '—'}
          titolo={disco ? `${disco.misuratoSu}: ${formattaByte(disco.libero)} liberi su ${formattaByte(disco.totale)}` : undefined}
        />
        <Pulsante variante="fantasma" icona={Settings} title="Impostazioni" onClick={() => apriImpostazioni(true)} />
      </div>
    </header>
  );
}
