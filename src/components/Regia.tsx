// Regia nella finestra principale: si usa prima e dopo la registrazione.
// Durante, l'utente guarda la stage view e usa il pedale; questi pulsanti
// sono lo stesso transport, per prepararsi e per rimediare.

import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  Bookmark,
  Circle,
  CircleCheck,
  Download,
  FolderSearch,
  MoreHorizontal,
  RefreshCcw,
  TriangleAlert,
  FileAudio,
  FileVideo,
  Headphones,
  History,
  Loader2,
  MonitorPlay,
  Play,
  Power,
  RotateCcw,
  Scissors,
  Square,
  ThumbsUp,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { messaggioErrore, type InfoSync, type StatoTake, type Take } from '../lib/backend';
import { leggiSorgenti } from '../lib/regia';
import { COMANDI, ETICHETTA_MODALITA, type Comando } from '../lib/model';
import { formattaDurata, formattaTimecode, pad2 } from '../lib/tempo';
import { useApp } from '../store/app';
import { apriStageView, eseguiComando, regia, useRegia } from '../store/regia';
import { AllarmeWatchdog, PannelloPreflight } from './Sicurezza';
import { CLASSE_INPUT, Menu, Pallino, Pulsante } from './ui';

const ICONA_COMANDO: Record<Exclude<Comando, 'avviaFerma'>, LucideIcon> = {
  salvaReplay: History,
  buono: ThumbsUp,
  taglia: Scissors,
  capitolo: Bookmark,
  scarta: Undo2,
};

const STILE_STATO: Record<StatoTake, [string, string]> = {
  registrato: ['registrato', 'bg-zinc-800 text-zinc-400'],
  buono: ['buono', 'bg-emerald-500/15 text-emerald-300'],
  da_tagliare: ['da tagliare', 'bg-amber-500/15 text-amber-300'],
  scartato: ['scartato', 'bg-red-500/15 text-red-300 line-through'],
  pubblicato: ['pubblicato', 'bg-sky-500/15 text-sky-300'],
  archiviato: ['archiviato', 'bg-zinc-800 text-zinc-500'],
};

function useOra(attivo: boolean) {
  const [ora, setOra] = useState(Date.now());
  useEffect(() => {
    if (!attivo) return;
    const t = setInterval(() => setOra(Date.now()), 250);
    return () => clearInterval(t);
  }, [attivo]);
  return ora;
}

function Riquadro({ titolo, children, destra }: { titolo: string; children: React.ReactNode; destra?: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-lg border border-bordo bg-pannello">
      <header className="flex h-11 items-center gap-2 border-b border-bordo/70 px-4">
        <h3 className="flex-1 text-sm font-semibold text-zinc-100">{titolo}</h3>
        {destra}
      </header>
      <div className="flex flex-col gap-2.5 p-4 text-[13px]">{children}</div>
    </section>
  );
}

function Suggerimento({ comando }: { comando: Comando }) {
  const { tastiera, pedale } = useApp((s) => s.impostazioni);
  const tasto = tastiera.mappa[comando];
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
      {pedale.mappa[comando] && <span className="rounded bg-emerald-500/15 px-1 text-emerald-300">pedale</span>}
      {tasto && <kbd className="rounded border border-bordo px-1.5 py-0.5 font-sans">{tasto}</kbd>}
    </span>
  );
}

function Transport() {
  const r = useRegia((s) => s.regia);
  const { impostazioni, preset, obs } = useApp();
  const attivo = preset.find((p) => p.id === impostazioni.presetAttivo);
  const registra = r.fase === 'registra';
  const ora = useOra(registra);
  const secondi = registra && r.corrente ? (ora - r.corrente.inizioMs) / 1000 : 0;
  const occupato = r.fase === 'avvio' || r.fase === 'arresto';
  const prossimo = Math.max(0, ...r.takes.map((t) => t.numero)) + 1;

  return (
    <section
      className={`flex items-center gap-5 rounded-lg border p-4 ${registra ? 'border-red-500/60 bg-red-500/5' : 'border-bordo bg-pannello'}`}
    >
      <button
        type="button"
        disabled={occupato || !attivo || obs.stato !== 'connesso'}
        onClick={() => void eseguiComando('avviaFerma')}
        title={registra ? 'Ferma la take' : 'Avvia una take'}
        className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${registra ? 'border-red-500 bg-red-500/20 hover:bg-red-500/30' : 'border-zinc-600 hover:border-red-500'}`}
      >
        {occupato ? (
          <Loader2 size={26} className="animate-spin text-amber-400" />
        ) : registra ? (
          <Square size={22} className="fill-red-500 text-red-500" />
        ) : (
          <Circle size={28} className="fill-red-500 text-red-500" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className={`font-mono text-4xl font-bold tabular-nums ${registra ? 'text-zinc-50' : 'text-zinc-600'}`}>
          {formattaTimecode(secondi)}
        </div>
        <div className="mt-1 flex items-center gap-2 truncate text-[13px] text-zinc-400">
          {registra ? (
            <span className="font-semibold text-red-400">REC · take {pad2(r.corrente!.take.numero)}</span>
          ) : (
            <span>Prossima: take {pad2(prossimo)}</span>
          )}
          <span className="text-zinc-600">·</span>
          <span className="truncate">{attivo ? attivo.nome : 'nessun preset applicato'}</span>
          {attivo && <span className="text-zinc-600">· Reaper {ETICHETTA_MODALITA[attivo.reaper.modalita].toLowerCase()}</span>}
        </div>
        <div className="mt-1.5"><Suggerimento comando="avviaFerma" /></div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <div className="text-[11px] text-zinc-500">
          {r.sessione
            ? `Sessione dalle ${new Date(r.sessione.iniziataIl).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} · ${r.takes.length} take`
            : 'Nessuna sessione aperta'}
        </div>
        <div className="flex gap-1.5">
          <Pulsante icona={MonitorPlay} onClick={() => void apriStageView()}>
            Stage view
          </Pulsante>
          {r.sessione ? (
            <Pulsante icona={Power} disabled={occupato} onClick={() => void regia.fineSessione()}>
              Fine sessione
            </Pulsante>
          ) : (
            <Pulsante
              icona={Play}
              disabled={!attivo || occupato}
              title={
                attivo?.reaper.modalita === 'take-continua'
                  ? 'Reaper inizia subito a registrare: anche il riscaldamento resta su disco'
                  : 'Apre la sessione e accende il replay buffer'
              }
              onClick={() => void regia.avviaSessione()}
            >
              Avvia sessione
            </Pulsante>
          )}
        </div>
      </div>
    </section>
  );
}

function Comandi() {
  const r = useRegia((s) => s.regia);
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
      {COMANDI.filter((c) => c.id !== 'avviaFerma').map((c) => {
        const Icona = ICONA_COMANDO[c.id as Exclude<Comando, 'avviaFerma'>];
        const disabilitato =
          r.fase === 'avvio' ||
          r.fase === 'arresto' ||
          (c.id === 'salvaReplay' && !r.replay.attivo) ||
          ((c.id === 'buono' || c.id === 'taglia' || c.id === 'scarta') && !r.corrente && r.takes.length === 0);
        return (
          <button
            key={c.id}
            type="button"
            disabled={disabilitato}
            onClick={() => void eseguiComando(c.id)}
            className="flex min-h-[76px] flex-col items-start justify-between gap-2 rounded-lg border border-bordo bg-pannello p-3.5 text-left transition-colors hover:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="flex items-center gap-2.5 text-sm font-medium text-zinc-100">
              <Icona size={18} className="shrink-0 text-zinc-300" />
              {c.etichetta}
            </span>
            <Suggerimento comando={c.id} />
          </button>
        );
      })}
    </div>
  );
}

function leggiInfoSync(t: Take): InfoSync | null {
  if (!t.syncInfo) return null;
  try {
    return JSON.parse(t.syncInfo) as InfoSync;
  } catch {
    return null;
  }
}

/** Stato del sync del take: da fare, in corso, oppure offset e drift misurati. */
function CellaSync({ t }: { t: Take }) {
  const inCorso = useRegia((s) => s.regia.sincronizzando === t.id);
  const avvisa = useApp((s) => s.avvisa);
  const info = leggiInfoSync(t);
  const errore = (e: unknown) => avvisa('errore', messaggioErrore(e));

  if (inCorso) {
    return (
      <span className="flex items-center gap-1.5 text-sky-300">
        <Loader2 size={14} className="animate-spin" /> misuro…
      </span>
    );
  }
  if (!info || t.offsetS === null) {
    const motivo = !t.fileVideo
      ? 'Il take non ha un file video'
      : t.reaperInizioS === null
        ? 'Il take non ha una posizione in Reaper'
        : 'Misura offset e drift tra il video e il WAV di Reaper';
    return (
      <Pulsante
        piccolo
        variante="fantasma"
        icona={RefreshCcw}
        className="border border-bordo"
        title={motivo}
        disabled={!t.fileVideo || t.reaperInizioS === null}
        onClick={() => void regia.sincronizza(t, { motivo: 'richiesta' })}
      >
        Sincronizza
      </Pulsante>
    );
  }

  const conf = Math.min(...info.misure.map((m) => m.confidenza));
  const problemi = info.avvisi.length > 0 || info.video?.cfr === false;
  const segno = info.correzioneMs >= 0 ? '+' : '';
  const dettagli = [
    `Inizio nel WAV: ${info.inizioAudio.toFixed(3)} s (${segno}${info.correzioneMs.toFixed(1)} ms rispetto alla stima)`,
    `Drift: ${info.driftPpm.toFixed(1)} ppm${info.misure.length < 2 ? ' (non misurato: take corta)' : ''}`,
    `Confidenza: ${conf.toFixed(1)}`,
    info.video ? `Video: ${info.video.cfr ? 'frame rate costante' : 'frame rate NON costante'} (${info.video.fotogrammi}/${info.video.attesi} fotogrammi)` : '',
    ...info.avvisi,
  ].filter(Boolean);

  return (
    <div className="flex items-center gap-1" title={dettagli.join('\n')}>
      <span className={`flex items-center gap-1 font-mono text-xs tabular-nums ${problemi ? 'text-amber-300' : 'text-emerald-300'}`}>
        {problemi ? <TriangleAlert size={13} /> : <CircleCheck size={13} />}
        {info.driftPpm.toFixed(0)} ppm
      </span>
      <Menu
        icona={MoreHorizontal}
        titolo="Azioni sul sync"
        voci={[
          {
            etichetta: info.export ? 'Mostra il video sincronizzato' : 'Crea video e audio sincronizzati',
            icona: info.export ? FolderSearch : Download,
            nota: info.export ? undefined : 'MP4 col video originale e l’audio di Reaper allineato, più il WAV',
            onClick: () =>
              info.export
                ? void revealItemInDir(info.export.videoSync).catch(errore)
                : void regia.sincronizza(t, { esporta: true, motivo: 'esportazione' }),
          },
          ...(info.export
            ? [{ etichetta: 'Mostra il WAV allineato', icona: FileAudio, onClick: () => void revealItemInDir(info.export!.audioSync).catch(errore) }]
            : []),
          { etichetta: 'Rifai la misura', icona: RefreshCcw, separa: true, onClick: () => void regia.sincronizza(t, { motivo: 'nuova misura' }) },
        ]}
      />
    </div>
  );
}

function ListaTake() {
  const r = useRegia((s) => s.regia);
  const avvisa = useApp((s) => s.avvisa);
  const takes = [...r.takes].reverse();
  const mostraAudio = async (t: Take) => {
    try {
      const file = await regia.fileAudio(t);
      await revealItemInDir(file[0]);
      if (file.length > 1) avvisa('info', `Il take ${pad2(t.numero)} è in ${file.length} file audio (una per traccia): mostro il primo.`);
    } catch (e) {
      avvisa('errore', messaggioErrore(e));
    }
  };
  const azioni: [StatoTake, LucideIcon, string][] = [
    ['buono', ThumbsUp, 'Buono'],
    ['da_tagliare', Scissors, 'Da tagliare'],
    ['scartato', Undo2, 'Scarta (il file resta su disco)'],
    ['registrato', RotateCcw, 'Togli il segno'],
  ];
  return (
    <Riquadro titolo={`Take della sessione${r.takes.length ? ` · ${r.takes.length}` : ''}`}>
      {takes.length === 0 && <span className="text-zinc-500">Ancora nessun take. Il primo colpo di pedale avvia la sessione.</span>}
      {takes.length > 0 && (
        <table className="w-full table-fixed border-separate border-spacing-y-1 text-[13px]">
          <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="w-12 text-left font-medium">#</th>
              <th className="w-24 text-left font-medium">Stato</th>
              <th className="w-16 text-left font-medium">Durata</th>
              <th className="w-20 text-left font-medium">In Reaper</th>
              <th className="text-left font-medium">File</th>
              <th className="w-36 text-left font-medium">Sync</th>
              <th className="w-[240px]" />
            </tr>
          </thead>
          <tbody>
            {takes.map((t: Take) => {
              const inCorso = r.corrente?.take.id === t.id;
              const [etichetta, classe] = STILE_STATO[t.stato];
              const nomeFile = t.fileVideo?.split(/[\\/]/).pop();
              return (
                <tr key={t.id} className={inCorso ? 'text-red-300' : 'text-zinc-300'}>
                  <td className="font-mono tabular-nums">
                    {pad2(t.numero)}
                    {t.tipo === 'replay' && <span className="ml-1 text-[10px] text-violet-300">R</span>}
                  </td>
                  <td>
                    {inCorso ? (
                      <span className="flex items-center gap-1.5 font-semibold">
                        <Pallino esito="attivo" /> REC
                      </span>
                    ) : (
                      <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${classe}`}>{etichetta}</span>
                    )}
                  </td>
                  <td className="tabular-nums">{t.durataS !== null ? formattaDurata(t.durataS) : '—'}</td>
                  <td className="font-mono tabular-nums text-zinc-500" title="Posizione nella take continua di Reaper all'inizio del video">
                    {t.reaperInizioS !== null ? formattaDurata(t.reaperInizioS) : '—'}
                  </td>
                  <td
                    className="truncate text-zinc-500"
                    title={
                      [t.fileVideo, ...leggiSorgenti(t.fileAudio).map((s) => s.file), t.marker ? `${t.marker} marker` : '']
                        .filter(Boolean)
                        .join('\n') || undefined
                    }
                  >
                    {nomeFile ?? '—'}
                    {t.fileAudio && (
                      <span className="ml-2 text-[11px] text-sky-300/80">+ {leggiSorgenti(t.fileAudio).length} audio</span>
                    )}
                  </td>
                  <td>{!inCorso && <CellaSync t={t} />}</td>
                  <td>
                    {!inCorso && (
                      <div className="flex items-center justify-end gap-0.5">
                        <Pulsante
                          piccolo
                          variante="fantasma"
                          icona={Headphones}
                          title="Ascolta in Reaper: porta il cursore all'inizio del take e avvia il play"
                          disabled={t.reaperInizioS === null}
                          onClick={() => regia.ascoltaInReaper(t).catch((e) => avvisa('errore', messaggioErrore(e)))}
                        />
                        <Pulsante
                          piccolo
                          variante="fantasma"
                          icona={FileAudio}
                          title="Mostra il file audio registrato da Reaper"
                          disabled={t.reaperInizioS === null}
                          onClick={() => void mostraAudio(t)}
                        />
                        <Pulsante
                          piccolo
                          variante="fantasma"
                          icona={FileVideo}
                          title="Mostra il file video in Esplora risorse"
                          disabled={!t.fileVideo}
                          onClick={() => revealItemInDir(t.fileVideo!).catch((e) => avvisa('errore', messaggioErrore(e)))}
                        />
                        <span className="mx-1.5 h-5 w-px bg-bordo" />
                        {azioni
                          .filter(([stato]) => stato !== t.stato)
                          .slice(0, 3)
                          .map(([stato, Icona, titolo]) => (
                            <Pulsante
                              key={stato}
                              piccolo
                              variante="fantasma"
                              icona={Icona}
                              title={titolo}
                              onClick={() => void regia.cambiaStatoTake(t.id, stato as 'buono')}
                            />
                          ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Riquadro>
  );
}

function Replay() {
  const r = useRegia((s) => s.regia);
  const connesso = useApp((s) => s.obs.stato === 'connesso');
  const ora = useOra(r.replay.attivo);
  const { avviatoMs, secondiMax, attivo, disponibile } = r.replay;
  const coperto = attivo ? (avviatoMs ? Math.min(secondiMax, (ora - avviatoMs) / 1000) : secondiMax) : 0;
  return (
    <Riquadro titolo="Replay buffer" destra={<Pallino esito={attivo ? 'ok' : disponibile ? 'avviso' : 'spento'} />}>
      {!connesso ? (
        <span className="text-zinc-500">OBS non connesso.</span>
      ) : !disponibile ? (
        <span className="text-zinc-500">
          Non abilitato nel profilo OBS: Impostazioni › Uscita › Buffer di replay, poi riapplica il preset.
        </span>
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-zinc-400">{attivo ? 'Copre gli ultimi' : 'Fermo'}</span>
            <span className="font-mono text-sm tabular-nums text-zinc-100">
              {attivo ? `${formattaDurata(coperto)} / ${formattaDurata(secondiMax)}` : formattaDurata(secondiMax)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-violet-400 transition-[width]" style={{ width: `${secondiMax ? (coperto / secondiMax) * 100 : 0}%` }} />
          </div>
          {avviatoMs === null && attivo && <span className="text-zinc-600">Era già attivo: durata coperta stimata al massimo.</span>}
        </>
      )}
    </Riquadro>
  );
}

function StatoReaper() {
  const r = useRegia((s) => s.regia);
  const { reaper, impostazioni, preset } = useApp();
  const segni = preset.find((p) => p.id === impostazioni.presetAttivo)?.reaper.segni ?? 'niente';
  const registra = reaper.stato?.stato === 5;
  const bridge =
    segni === 'niente'
      ? { esito: 'spento' as const, testo: 'Il preset non scrive niente nel progetto di Reaper.' }
      : !impostazioni.reaper.bridgeId
        ? {
            esito: 'spento' as const,
            testo: 'Script bridge non installato: Takeline non scrive niente in Reaper. Le posizioni dei take restano qui sotto.',
          }
        : r.bridge === 'errore'
          ? { esito: 'errore' as const, testo: 'Lo script bridge non risponde: controlla il command ID in Impostazioni.' }
          : {
              esito: 'ok' as const,
              testo: segni === 'tutto' ? 'Scrive region e marker con nome.' : 'Scrive una region con nome per ogni take.',
            };
  return (
    <Riquadro titolo="Reaper" destra={<Pallino esito={!reaper.stato ? 'errore' : registra ? 'attivo' : 'ok'} />}>
      <div className="flex justify-between">
        <span className="text-zinc-400">{!reaper.stato ? 'Non risponde' : registra ? 'In registrazione' : 'Fermo'}</span>
        <span className="font-mono tabular-nums text-zinc-300">{reaper.stato?.posizioneTesto}</span>
      </div>
      <div className="flex gap-2 text-zinc-500">
        <Pallino esito={bridge.esito} className="mt-1" />
        <span>{bridge.testo}</span>
      </div>
    </Riquadro>
  );
}

function Scaletta() {
  const r = useRegia((s) => s.regia);
  const { impostazioni, salvaImpostazioni, avvisa } = useApp();
  const [testo, setTesto] = useState(impostazioni.scaletta.join('\n'));
  useEffect(() => setTesto(impostazioni.scaletta.join('\n')), [impostazioni.scaletta]);
  const modificabile = r.fase === 'fermo';
  const { voci, indice } = r.scaletta;

  const salva = () => {
    const nuove = testo.split('\n').map((x) => x.trim()).filter(Boolean);
    if (nuove.join('\n') === impostazioni.scaletta.join('\n')) return;
    salvaImpostazioni({ ...impostazioni, scaletta: nuove }).catch((e) => avvisa('errore', messaggioErrore(e)));
  };

  return (
    <Riquadro
      titolo="Scaletta"
      destra={
        indice >= 0 && modificabile ? (
          <Pulsante piccolo variante="fantasma" icona={RotateCcw} title="Riparti dalla prima sezione" onClick={() => regia.ricominciaScaletta()} />
        ) : undefined
      }
    >
      {voci.length > 0 && (
        <ol className="flex flex-col gap-0.5">
          {voci.map((v, i) => (
            <li
              key={`${i}-${v}`}
              className={`flex items-center gap-2 rounded px-1.5 py-0.5 ${i === indice ? 'bg-sky-500/15 font-semibold text-sky-200' : i < indice ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}
            >
              <span className="w-5 text-right tabular-nums text-zinc-600">{i + 1}</span>
              {v}
            </li>
          ))}
        </ol>
      )}
      {modificabile && (
        <textarea
          rows={voci.length ? 3 : 5}
          className={`${CLASSE_INPUT} h-auto resize-y py-1.5`}
          placeholder={'Una sezione per riga, es.\nIntroduzione\nAccordi base\nRitmica'}
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          onBlur={salva}
        />
      )}
      <span className="text-zinc-600">
        Ogni “Nuovo capitolo” passa alla sezione successiva e mette un marker col suo nome: a fine registrazione i capitoli sono pronti.
      </span>
    </Riquadro>
  );
}

/** Ultimo messaggio della regia (lo stesso che compare in stage view), per 8 secondi. */
function UltimoMessaggio() {
  const messaggio = useRegia((s) => s.regia.messaggio);
  const [visibile, setVisibile] = useState(false);
  useEffect(() => {
    if (!messaggio) return;
    const resta = 8000 - (Date.now() - messaggio.quando);
    setVisibile(resta > 0);
    const t = setTimeout(() => setVisibile(false), Math.max(0, resta));
    return () => clearTimeout(t);
  }, [messaggio]);
  if (!visibile || !messaggio) return null;
  return (
    <div
      className={`rounded-md border px-4 py-2.5 text-sm ${messaggio.livello === 'errore' ? 'border-red-500/40 bg-red-500/10 text-red-200' : messaggio.livello === 'avviso' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-bordo bg-pannello text-zinc-300'}`}
    >
      {messaggio.testo}
    </div>
  );
}

export function Regia() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4">
      <div className="flex min-w-0 flex-col gap-3">
        <Transport />
        <AllarmeWatchdog />
        <UltimoMessaggio />
        <Comandi />
        <ListaTake />
      </div>
      <div className="flex flex-col gap-3">
        <PannelloPreflight />
        <Replay />
        <StatoReaper />
        <Scaletta />
      </div>
    </div>
  );
}
