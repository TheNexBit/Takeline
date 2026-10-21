// Patchbay: la catena del segnale com'e' adesso, letta dai programmi veri.
// Ogni nodo confronta lo stato reale con quello che chiede il preset attivo.

import {
  AudioLines,
  Cable,
  Check,
  Clapperboard,
  Disc3,
  FileVideo,
  Guitar,
  Link2,
  Mic,
  MicOff,
  Play,
  Radio,
  Sparkles,
  TriangleAlert,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { formattaByte, messaggioErrore } from '../lib/backend';
import { ETICHETTA_MODALITA } from '../lib/model';
import { risolviCartella } from '../lib/naming';
import { useApp, useLivelli } from '../store/app';
import { esitoDisco } from './Header';
import { BORDO_ESITO, Livello, Pallino, Pulsante, type Esito } from './ui';

const STATO_REAPER: Record<number, string> = {
  0: 'Fermo',
  1: 'Play',
  2: 'Pausa',
  5: 'Registra',
  6: 'Registra (pausa)',
};

function Nodo({
  titolo,
  icona: Icona,
  esito,
  nota,
  azioni,
  children,
}: {
  titolo: string;
  icona: LucideIcon;
  esito: Esito;
  nota?: string;
  /** Pulsanti sotto la nota, per risolvere il problema che segnala. */
  azioni?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col rounded-lg border bg-pannello ${BORDO_ESITO[esito]}`}>
      <div className="flex h-9 items-center gap-2 border-b border-bordo/70 px-3">
        <Icona size={14} className="text-zinc-500" />
        <span className="flex-1 truncate text-xs font-semibold text-zinc-200">{titolo}</span>
        <Pallino esito={esito} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-3 text-xs">{children}</div>
      {nota && (
        <div className="flex gap-1.5 border-t border-bordo/70 px-3 py-2 text-[11px] text-amber-300/90">
          <TriangleAlert size={12} className="mt-px shrink-0" />
          <span>{nota}</span>
        </div>
      )}
      {azioni && <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">{azioni}</div>}
    </div>
  );
}

function Cavo({ esito }: { esito: Esito }) {
  const colore =
    esito === 'attivo' ? 'text-red-500' : esito === 'ok' ? 'text-emerald-500/70' : esito === 'spento' ? 'text-zinc-700' : 'text-amber-500/60';
  return (
    <div className={`flex w-6 items-center self-center ${colore}`} aria-hidden>
      <div className={`h-0.5 flex-1 ${esito === 'attivo' ? 'flusso-attivo' : 'bg-current'}`} />
      <div className="h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-current" />
    </div>
  );
}

function Corsia({ titolo, sottotitolo, spenta, children }: { titolo: string; sottotitolo: string; spenta?: boolean; children: ReactNode }) {
  return (
    <section className={spenta ? 'opacity-45' : ''}>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{titolo}</h3>
        <span className="text-[11px] text-zinc-600">{sottotitolo}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1.15fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch">{children}</div>
    </section>
  );
}

function Riga({ k, v, esito }: { k: string; v: ReactNode; esito?: 'uguale' | 'diverso' }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-[72px] shrink-0 text-zinc-500">{k}</span>
      <span className="min-w-0 flex-1 truncate text-zinc-200" title={typeof v === 'string' ? v : undefined}>
        {v || <span className="text-zinc-600">—</span>}
      </span>
      {esito === 'uguale' && <Check size={12} className="shrink-0 text-emerald-400" />}
      {esito === 'diverso' && <TriangleAlert size={12} className="shrink-0 text-amber-400" />}
    </div>
  );
}

function Distintivo({ acceso, children, rosso }: { acceso: boolean; rosso?: boolean; children: ReactNode }) {
  return (
    <span
      className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${acceso ? (rosso ? 'bg-red-500 text-white' : 'bg-emerald-500/20 text-emerald-300') : 'bg-zinc-800 text-zinc-500'}`}
    >
      {children}
    </span>
  );
}

export function Patchbay() {
  const { obs, reaper, preset, impostazioni, disco, ffmpeg, applicando } = useApp();
  const { applica, collegaAObs, salvaPreset, apriEditor, avvisa } = useApp.getState();
  const errore = (e: unknown) => avvisa('errore', messaggioErrore(e));
  const livelli = useLivelli((s) => s.obs);
  const attivo = preset.find((p) => p.id === impostazioni.presetAttivo) ?? null;
  const ist = obs.ist;
  const connesso = obs.stato === 'connesso' && ist !== null;

  // --- Reaper ---
  const usaReaper = attivo?.reaper.modalita !== 'disattivato';
  const rs = reaper.stato;
  const armate = rs?.tracce.filter((t) => t.armata) ?? [];
  const registraReaper = rs?.stato === 5;
  const esitoIngressi: Esito = !rs ? 'errore' : armate.length === 0 ? 'avviso' : 'ok';
  const esitoReaper: Esito = !rs ? 'errore' : registraReaper ? 'attivo' : 'ok';

  // --- OBS ---
  const confronta = (voluto: string | undefined, reale: string | undefined) =>
    !attivo || !voluto ? undefined : voluto === reale ? ('uguale' as const) : ('diverso' as const);
  const diversi = attivo && ist
    ? [
        confronta(attivo.obs.sceneCollection, ist.collezione),
        confronta(attivo.obs.profilo, ist.profilo),
        confronta(attivo.obs.scena, ist.scena),
      ].filter((x) => x === 'diverso').length
    : 0;
  const guidaNome = attivo?.obs.tracciaGuida ?? '';
  const guida = guidaNome ? ist?.sorgentiAudio.find((s) => s.nome === guidaNome) : undefined;
  const notaSorgenti = !connesso
    ? undefined
    : guidaNome && !guida
      ? `Il preset usa la traccia guida "${guidaNome}", ma in OBS non c'è una sorgente audio con questo nome. Serve solo al sync: puoi toglierla dal preset.`
      : guida?.muta
        ? `La traccia guida "${guidaNome}" è mutata: il sync non avrà riferimento`
        : undefined;
  const esitoSorgenti: Esito = !connesso ? 'errore' : notaSorgenti ? 'avviso' : 'ok';
  const registraObs = ist?.registrazione.attiva ?? false;
  const esitoObs: Esito =
    obs.stato === 'ricarico' || obs.stato === 'connessione'
      ? 'avviso'
      : !connesso
        ? 'errore'
        : registraObs
          ? 'attivo'
          : diversi
            ? 'avviso'
            : 'ok';

  const cartellaPreset = attivo ? risolviCartella(attivo.output.cartella, { preset: attivo.nome, quando: new Date() }) : '';
  const normalizza = (c: string) => c.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const cartellaDiversa = connesso && !!attivo && !!ist.cartellaRegistrazione && normalizza(ist.cartellaRegistrazione) !== normalizza(cartellaPreset);
  // Il caso tipico: il preset e' stato rinominato e la cartella contiene {preset}.
  const perNome = cartellaDiversa && attivo.output.cartella.includes('{preset}');
  const notaFile = cartellaDiversa
    ? `Il preset ora salverebbe in ${cartellaPreset}${perNome ? ' (la cartella usa il nome del preset, che è cambiato)' : ''}. Riapplicalo per usarla.`
    : disco && esitoDisco(disco.libero) !== 'ok'
      ? `Restano ${formattaByte(disco.libero)} sul disco`
      : undefined;
  const esitoFile: Esito = !connesso ? 'spento' : esitoDisco(disco?.libero) === 'errore' ? 'errore' : notaFile ? 'avviso' : 'ok';

  const post = attivo?.post;
  const passiPost = post
    ? [
        post.remuxMp4 && 'Remux MKV → MP4',
        post.separaTracce && 'Tracce audio separate',
        post.normalizza && `Loudness ${post.lufs} LUFS`,
        ...post.export.map((e) => `Export ${e}`),
      ].filter((x): x is string => !!x)
    : [];

  return (
    <div className="flex flex-col gap-5">
      <Corsia
        titolo="Audio"
        sottotitolo="chitarra → interfaccia ASIO → Reaper"
        spenta={!usaReaper}
      >
        <Nodo
          titolo={`Tracce Reaper${rs ? ` · ${armate.length}/${rs.tracce.length} armate` : ''}`}
          icona={Guitar}
          esito={usaReaper ? esitoIngressi : 'spento'}
          nota={usaReaper && rs && armate.length === 0 ? 'Nessuna traccia armata in Reaper' : undefined}
        >
          {!rs && <span className="text-zinc-500">{reaper.errore ?? 'In attesa di Reaper…'}</span>}
          {rs?.tracce.length === 0 && <span className="text-zinc-500">Il progetto non ha tracce.</span>}
          {rs?.tracce.slice(0, 6).map((t) => (
            <div key={t.numero} className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full border ${t.armata ? 'border-red-500 bg-red-500' : 'border-zinc-600'}`}
                title={t.armata ? 'Armata' : 'Non armata'}
              />
              <span className={`w-24 truncate ${t.muta ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
                {t.numero}. {t.nome || 'Traccia'}
              </span>
              <Livello db={t.piccoDb} className="flex-1" />
            </div>
          ))}
          {rs && rs.tracce.length > 6 && <span className="text-zinc-600">+ altre {rs.tracce.length - 6}</span>}
        </Nodo>
        <Cavo esito={!usaReaper ? 'spento' : registraReaper ? 'attivo' : esitoIngressi} />
        <Nodo titolo="Reaper" icona={AudioLines} esito={usaReaper ? esitoReaper : 'spento'}>
          <Riga k="Transport" v={rs ? STATO_REAPER[rs.stato] ?? `stato ${rs.stato}` : 'non risponde'} />
          <Riga k="Posizione" v={<span className="font-mono tabular-nums">{rs?.posizioneTesto}</span>} />
          <Riga k="Host" v={`${impostazioni.reaper.host}:${impostazioni.reaper.porta}`} />
        </Nodo>
        <Cavo esito={!usaReaper ? 'spento' : registraReaper ? 'attivo' : esitoReaper} />
        <Nodo titolo="Take audio" icona={Disc3} esito={usaReaper && rs ? 'ok' : 'spento'}>
          <Riga k="Modalità" v={attivo ? ETICHETTA_MODALITA[attivo.reaper.modalita] : '—'} />
          <span className="text-zinc-500">
            {attivo?.reaper.modalita === 'take-continua'
              ? 'Una sola registrazione lunga; ogni take diventa una region con nome.'
              : attivo?.reaper.modalita === 'start-stop'
                ? 'Reaper parte e si ferma insieme a OBS.'
                : attivo
                  ? 'Questo preset non usa Reaper.'
                  : 'Applica un preset per scegliere come registra Reaper.'}
          </span>
        </Nodo>
      </Corsia>

      <div className="-my-1 flex items-center gap-2 pl-1 text-[11px] text-zinc-500">
        <Cable size={13} />
        <span>
          Riferimento per il sync:{' '}
          {guidaNome ? (
            <>
              traccia guida <span className="text-zinc-300">“{guidaNome}”</span> in OBS dal monitor out dell’interfaccia
            </>
          ) : (
            'nessuna traccia guida in questo preset'
          )}
        </span>
        {guidaNome && connesso && <Pallino esito={guida && !guida.muta ? 'ok' : 'avviso'} />}
      </div>

      <Corsia titolo="Video" sottotitolo="camera e schermo → OBS → file">
        <Nodo
          titolo="Sorgenti audio OBS"
          icona={Mic}
          esito={esitoSorgenti}
          nota={notaSorgenti}
          azioni={
            attivo && guidaNome && connesso && !guida ? (
              <>
                <Pulsante piccolo onClick={() => salvaPreset({ ...attivo, obs: { ...attivo.obs, tracciaGuida: '' } }).catch(errore)}>
                  Togli dal preset
                </Pulsante>
                <Pulsante piccolo variante="fantasma" onClick={() => apriEditor(attivo.id)}>
                  Scegli un'altra sorgente
                </Pulsante>
              </>
            ) : undefined
          }
        >
          {!connesso && <span className="text-zinc-500">{obs.motivo ?? 'OBS non connesso.'}</span>}
          {connesso && ist.sorgentiAudio.length === 0 && <span className="text-zinc-500">Nessuna sorgente audio.</span>}
          {connesso &&
            ist.sorgentiAudio.slice(0, 6).map((s) => {
              const IconaMuto = s.muta ? MicOff : Mic;
              return (
                <div key={s.nome} className="flex items-center gap-2">
                  <IconaMuto size={12} className={s.muta ? 'shrink-0 text-red-400' : 'shrink-0 text-zinc-500'} />
                  <span className="w-24 truncate text-zinc-300" title={s.nome}>
                    {s.nome}
                  </span>
                  {s.nome === guidaNome && (
                    <span className="rounded bg-sky-500/15 px-1 text-[10px] font-semibold uppercase text-sky-300">guida</span>
                  )}
                  <Livello db={s.muta ? undefined : livelli[s.nome]} className="flex-1" />
                </div>
              );
            })}
          {connesso && ist.sorgentiAudio.length > 6 && (
            <span className="text-zinc-600">+ altre {ist.sorgentiAudio.length - 6}</span>
          )}
        </Nodo>
        <Cavo esito={!connesso ? 'spento' : registraObs ? 'attivo' : esitoSorgenti} />
        <Nodo
          titolo={`OBS${obs.info ? ` ${obs.info.versioneMotore}` : ''}`}
          icona={Clapperboard}
          esito={esitoObs}
          nota={diversi ? `OBS non corrisponde al preset "${attivo?.nome}"` : undefined}
          azioni={
            diversi && attivo ? (
              <>
                <Pulsante piccolo disabled={applicando} icona={Play} onClick={() => applica(attivo.id)}>
                  Riapplica il preset
                </Pulsante>
                <Pulsante
                  piccolo
                  disabled={applicando}
                  icona={Link2}
                  title={`Salva nel preset: ${ist?.collezione} / ${ist?.profilo} / ${ist?.scena}`}
                  onClick={() => collegaAObs(attivo.id)}
                >
                  Usa la configurazione attuale
                </Pulsante>
              </>
            ) : undefined
          }
        >
          {obs.stato === 'ricarico' ? (
            <span className="text-amber-300">OBS sta ricaricando la configurazione…</span>
          ) : !connesso ? (
            <span className="text-zinc-500">{obs.motivo ?? 'Non connesso.'}</span>
          ) : (
            <>
              <Riga k="Collezione" v={ist.collezione} esito={confronta(attivo?.obs.sceneCollection, ist.collezione)} />
              <Riga k="Profilo" v={ist.profilo} esito={confronta(attivo?.obs.profilo, ist.profilo)} />
              <Riga k="Scena" v={ist.scena} esito={confronta(attivo?.obs.scena, ist.scena)} />
              <Riga k="Video" v={ist.video ? `${ist.video.uscita} · ${+ist.video.fps.toFixed(3)} fps` : ''} />
              <div className="mt-1 flex flex-wrap gap-1">
                <Distintivo acceso={ist.registrazione.attiva} rosso>
                  REC {ist.registrazione.attiva ? ist.registrazione.timecode.slice(0, 8) : ''}
                </Distintivo>
                <Distintivo acceso={ist.replayBuffer.attivo}>
                  Replay {ist.replayBuffer.disponibile ? (ist.replayBuffer.attivo ? 'attivo' : 'fermo') : 'non abilitato'}
                </Distintivo>
                <Distintivo acceso={ist.diretta} rosso>
                  <Radio size={10} className="-mt-px mr-0.5 inline" />
                  Diretta
                </Distintivo>
              </div>
            </>
          )}
        </Nodo>
        <Cavo esito={!connesso ? 'spento' : registraObs ? 'attivo' : esitoObs === 'errore' ? 'errore' : 'ok'} />
        <Nodo
          titolo="File video"
          icona={FileVideo}
          esito={esitoFile}
          nota={notaFile}
          azioni={
            cartellaDiversa && attivo ? (
              <Pulsante piccolo icona={Play} disabled={applicando} onClick={() => applica(attivo.id)}>
                Riapplica il preset
              </Pulsante>
            ) : undefined
          }
        >
          <Riga k="Cartella" v={ist?.cartellaRegistrazione ?? ''} esito={connesso && attivo ? (cartellaDiversa ? 'diverso' : 'uguale') : undefined} />
          <Riga k="Nome" v={<span className="font-mono text-[11px]">{ist?.formatoNomeFile}</span>} />
          <Riga k="Libero" v={disco ? `${formattaByte(disco.libero)} su ${formattaByte(disco.totale)}` : ''} />
        </Nodo>
      </Corsia>

      <Corsia titolo="Post-produzione" sottotitolo="ffmpeg esterno, a fine take">
        <Nodo titolo="ffmpeg" icona={Wand2} esito={ffmpeg ? (ffmpeg.trovato ? 'ok' : 'errore') : 'spento'}>
          <Riga k="Versione" v={ffmpeg?.versione ?? (ffmpeg?.trovato === false ? 'non trovato' : '…')} />
          <Riga k="Comando" v={ffmpeg?.comando ?? ''} />
          {ffmpeg?.errore && <span className="text-red-300">{ffmpeg.errore}</span>}
        </Nodo>
        <Cavo esito={ffmpeg?.trovato && passiPost.length ? 'ok' : 'spento'} />
        <Nodo titolo="Pipeline del preset" icona={Sparkles} esito={passiPost.length ? 'ok' : 'spento'}>
          {passiPost.length === 0 && <span className="text-zinc-500">Nessuna lavorazione automatica.</span>}
          <div className="flex flex-wrap gap-1">
            {passiPost.map((p) => (
              <span key={p} className="rounded border border-bordo bg-rilievo px-1.5 py-0.5 text-[11px] text-zinc-300">
                {p}
              </span>
            ))}
          </div>
        </Nodo>
        <Cavo esito="spento" />
        <Nodo titolo="Libreria" icona={Disc3} esito="spento">
          <span className="text-zinc-500">Take, marker e ciclo di vita dei file arrivano con le prossime milestone.</span>
        </Nodo>
      </Corsia>
    </div>
  );
}
