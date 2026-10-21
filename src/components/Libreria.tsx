// Libreria: coda di post-produzione, spazio occupato e ciclo di vita dei take.
// Niente si cancella senza conferma, e "eliminare" vuol dire Cestino di Windows.

import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  Archive,
  Ban,
  BookOpen,
  Check,
  Clapperboard,
  Copy,
  FileText,
  FolderSearch,
  HardDrive,
  ListVideo,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { backend, formattaByte, messaggioErrore, type Lavoro, type StatoTake, type VoceLibreria } from '../lib/backend';
import { formattaDurata, pad2 } from '../lib/tempo';
import { useApp } from '../store/app';
import { pulisciFiniti, useLavori } from '../store/post';
import { regia } from '../store/regia';
import { ConfermaDialog } from './PresetDialoghi';
import { BASE_INPUT, Menu, Modale, Pulsante } from './ui';

const ETICHETTA_LAVORO: Record<Lavoro['tipo'], string> = {
  remux: 'Remux in MP4',
  tracce: 'Tracce audio separate',
  loudnorm: 'Loudness',
  export: 'Export',
  proxy: 'Proxy leggero',
};

const STATI_TAKE: { valore: StatoTake; etichetta: string }[] = [
  { valore: 'registrato', etichetta: 'Registrato' },
  { valore: 'buono', etichetta: 'Buono' },
  { valore: 'da_tagliare', etichetta: 'Da tagliare' },
  { valore: 'scartato', etichetta: 'Scartato' },
  { valore: 'pubblicato', etichetta: 'Pubblicato' },
  { valore: 'archiviato', etichetta: 'Archiviato' },
];

const ETICHETTA_RUOLO: Record<string, string> = {
  originale: 'Video originale',
  remux: 'MP4 (remux)',
  traccia: 'Traccia audio',
  loudnorm: 'Loudness normalizzato',
  export: 'Export per piattaforma',
  proxy: 'Proxy',
  sync: 'Video sincronizzato',
  'sync-audio': 'Audio sincronizzato',
  capitoli: 'Capitoli YouTube',
  edl: 'EDL',
};

function Riquadro({ titolo, destra, children }: { titolo: string; destra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-bordo bg-pannello">
      <header className="flex h-12 items-center gap-2 border-b border-bordo/70 px-4">
        <h3 className="flex-1 text-sm font-semibold text-zinc-100">{titolo}</h3>
        {destra}
      </header>
      <div className="p-4 text-[13px]">{children}</div>
    </section>
  );
}

function descriviLavoro(l: Lavoro) {
  const extra = l.tipo === 'loudnorm' ? ` ${l.parametri.lufs} LUFS` : l.tipo === 'export' ? ` ${String(l.parametri.piattaforma)}` : '';
  return `${ETICHETTA_LAVORO[l.tipo] ?? l.tipo}${extra}`;
}

function Coda({ numeri }: { numeri: Map<number, string> }) {
  const lavori = useLavori((s) => s.lavori);
  const avvisa = useApp((s) => s.avvisa);
  const errore = (e: unknown) => avvisa('errore', messaggioErrore(e));
  const attivi = lavori.filter((l) => l.stato === 'attesa' || l.stato === 'in-corso').length;

  return (
    <Riquadro
      titolo={`Coda di lavorazione${attivi ? ` · ${attivi} da fare` : ''}`}
      destra={
        <Pulsante piccolo variante="fantasma" disabled={!lavori.some((l) => l.stato === 'fatto' || l.stato === 'annullato')} onClick={() => void pulisciFiniti()}>
          Togli i finiti
        </Pulsante>
      }
    >
      {lavori.length === 0 ? (
        <p className="text-zinc-500">
          Nessun lavoro. Si mettono in coda da soli a fine take, secondo la scheda Post-produzione del preset. Durante una
          registrazione la coda si ferma e riparte dopo.
        </p>
      ) : (
        <ul className="flex max-h-80 flex-col divide-y divide-bordo/60 overflow-y-auto">
          {lavori.map((l) => {
            const uscita = l.uscita?.split('\n').filter(Boolean) ?? [];
            return (
              <li key={l.id} className="flex items-center gap-3 py-2">
                <span className="w-16 shrink-0 font-mono text-xs text-zinc-500">{l.takeId ? numeri.get(l.takeId) ?? `take ${l.takeId}` : '—'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-zinc-200">{descriviLavoro(l)}</span>
                    <StatoLavoro l={l} />
                  </div>
                  {l.stato === 'in-corso' && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full bg-sky-400 transition-[width]" style={{ width: `${Math.round(l.progresso * 100)}%` }} />
                    </div>
                  )}
                  {l.errore && <div className="mt-1 break-words text-xs text-red-300">{l.errore}</div>}
                  {l.stato === 'fatto' && uscita.length === 0 && <div className="mt-0.5 text-xs text-zinc-500">Niente da fare (già nel formato giusto).</div>}
                </div>
                {(l.stato === 'attesa' || l.stato === 'in-corso') && (
                  <Pulsante piccolo variante="fantasma" icona={X} title="Annulla" onClick={() => backend.postAnnulla(l.id).catch(errore)} />
                )}
                {(l.stato === 'errore' || l.stato === 'annullato') && (
                  <Pulsante piccolo variante="fantasma" icona={RotateCcw} title="Riprova" onClick={() => backend.postRiprova(l.id).catch(errore)} />
                )}
                {l.stato === 'fatto' && uscita[0] && (
                  <Pulsante piccolo variante="fantasma" icona={FolderSearch} title="Mostra il file" onClick={() => revealItemInDir(uscita[0]).catch(errore)} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Riquadro>
  );
}

function StatoLavoro({ l }: { l: Lavoro }) {
  const stile: Record<Lavoro['stato'], [string, string]> = {
    attesa: ['in attesa', 'bg-zinc-800 text-zinc-400'],
    'in-corso': [`${Math.round(l.progresso * 100)}%`, 'bg-sky-500/15 text-sky-300'],
    fatto: ['fatto', 'bg-emerald-500/15 text-emerald-300'],
    errore: ['errore', 'bg-red-500/15 text-red-300'],
    annullato: ['annullato', 'bg-zinc-800 text-zinc-500'],
  };
  const [testo, classe] = stile[l.stato];
  return (
    <span className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[11px] font-semibold uppercase ${classe}`}>
      {l.stato === 'in-corso' && <Loader2 size={11} className="animate-spin" />}
      {testo}
    </span>
  );
}

/** Conferma con l'elenco esatto dei file che verranno toccati. */
interface RichiestaConferma {
  titolo: string;
  azione: string;
  descrizione: string;
  file: { take: VoceLibreria; percorsi: string[] }[];
  esegui: () => Promise<void>;
}

function Proposte({
  voci,
  onConferma,
  onArchivia,
}: {
  voci: VoceLibreria[];
  onConferma: (r: RichiestaConferma) => void;
  onArchivia: (take: VoceLibreria[]) => void;
}) {
  const disco = useApp((s) => s.disco);
  const avvisa = useApp((s) => s.avvisa);
  const presenti = (v: VoceLibreria) => v.file.filter((f) => f.esiste);
  const peso = (vv: VoceLibreria[]) => vv.reduce((a, v) => a + presenti(v).reduce((b, f) => b + f.byte, 0), 0);
  const scartati = voci.filter((v) => v.stato === 'scartato' && presenti(v).length);
  const pubblicati = voci.filter((v) => v.stato === 'pubblicato' && presenti(v).length);
  const senzaProxy = pubblicati.filter((v) => !v.file.some((f) => f.ruolo === 'proxy' && f.esiste));
  const totale = peso(voci);

  return (
    <Riquadro titolo="Spazio">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-zinc-400">
        <span className="flex items-center gap-2">
          <HardDrive size={15} /> I take occupano <span className="font-semibold text-zinc-100">{formattaByte(totale)}</span>
        </span>
        {disco && (
          <span>
            Liberi sul disco: <span className="font-semibold text-zinc-100">{formattaByte(disco.libero)}</span> su {formattaByte(disco.totale)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {scartati.length > 0 && (
          <div className="flex items-center gap-3 rounded-md border border-bordo bg-rilievo px-3 py-2.5">
            <Ban size={16} className="shrink-0 text-red-300" />
            <span className="flex-1">
              {scartati.length} take scartat{scartati.length === 1 ? 'o occupa' : 'i occupano'} <b className="text-zinc-100">{formattaByte(peso(scartati))}</b>.
            </span>
            <Pulsante
              piccolo
              variante="pericolo"
              icona={Trash2}
              onClick={() =>
                onConferma({
                  titolo: 'Spostare nel Cestino i take scartati?',
                  azione: 'Sposta nel Cestino',
                  descrizione: 'Tutti i loro file vanno nel Cestino di Windows: si possono ancora recuperare da lì. I WAV di Reaper non vengono toccati.',
                  file: scartati.map((v) => ({ take: v, percorsi: presenti(v).map((f) => f.percorso) })),
                  esegui: async () => {
                    for (const v of scartati) await backend.fileCestina(v.takeId, presenti(v).map((f) => f.percorso));
                  },
                })
              }
            >
              Sposta nel Cestino…
            </Pulsante>
          </div>
        )}
        {pubblicati.length > 0 && (
          <div className="flex items-center gap-3 rounded-md border border-bordo bg-rilievo px-3 py-2.5">
            <Check size={16} className="shrink-0 text-sky-300" />
            <span className="flex-1">
              {pubblicati.length} take pubblicat{pubblicati.length === 1 ? 'o' : 'i'} ancora qui: <b className="text-zinc-100">{formattaByte(peso(pubblicati))}</b>.
            </span>
            {senzaProxy.length > 0 && (
              <Pulsante
                piccolo
                icona={ListVideo}
                title="Crea una copia leggera (720p) da tenere al posto dell'originale"
                onClick={async () => {
                  const ffmpeg = useApp.getState().impostazioni.ffmpeg.percorso;
                  for (const v of senzaProxy) await backend.postAccoda(v.takeId, 'proxy', { ffmpeg }).catch(() => {});
                  avvisa('info', `${senzaProxy.length} proxy in coda.`);
                }}
              >
                Crea proxy
              </Pulsante>
            )}
            <Pulsante piccolo icona={Archive} onClick={() => onArchivia(pubblicati)}>
              Archivia…
            </Pulsante>
          </div>
        )}
        {scartati.length === 0 && pubblicati.length === 0 && (
          <p className="text-zinc-500">
            Niente da proporre. Segna i take come <i>scartati</i> o <i>pubblicati</i> nella lista qui sotto: Takeline ti proporrà di
            liberare spazio, archiviarli o tenerne solo un proxy.
          </p>
        )}
      </div>
    </Riquadro>
  );
}

function ElencoTake({
  voci,
  nomiPreset,
  onConferma,
  onArchivia,
  onCapitoli,
  ricarica,
}: {
  voci: VoceLibreria[];
  nomiPreset: Map<string, string>;
  onConferma: (r: RichiestaConferma) => void;
  onArchivia: (take: VoceLibreria[]) => void;
  onCapitoli: (testo: string, avvisi: string[], file: string) => void;
  ricarica: () => void;
}) {
  const avvisa = useApp((s) => s.avvisa);
  const errore = (e: unknown) => avvisa('errore', messaggioErrore(e));
  const sessioni = useMemo(() => {
    const m = new Map<number, VoceLibreria[]>();
    for (const v of voci) m.set(v.sessioneId, [...(m.get(v.sessioneId) ?? []), v]);
    return [...m.entries()];
  }, [voci]);

  const cambiaStato = async (v: VoceLibreria, stato: StatoTake) => {
    try {
      if (stato === 'pubblicato' || stato === 'archiviato') await backend.takeStato(v.takeId, stato);
      else await regia.cambiaStatoTake(v.takeId, stato);
      ricarica();
    } catch (e) {
      errore(e);
    }
  };

  if (!voci.length) return <Riquadro titolo="Take">Nessun take registrato.</Riquadro>;

  return (
    <Riquadro titolo={`Take · ${voci.length}`}>
      <div className="flex flex-col gap-5">
        {sessioni.map(([id, takes]) => {
          const s0 = takes[0];
          return (
            <div key={id}>
              <div className="mb-1.5 flex items-baseline gap-2 text-xs text-zinc-500">
                <span className="font-semibold text-zinc-300">
                  {new Date(s0.sessioneIl).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span>{nomiPreset.get(s0.presetId) ?? s0.presetId}</span>
                {s0.titolo && <span>· {s0.titolo}</span>}
              </div>
              <ul className="flex flex-col divide-y divide-bordo/60 rounded-md border border-bordo/60">
                {takes.map((v) => {
                  const presenti = v.file.filter((f) => f.esiste);
                  const video = v.file.find((f) => f.ruolo === 'originale');
                  return (
                    <li key={v.takeId} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-12 shrink-0 font-mono tabular-nums text-zinc-300">
                        {pad2(v.numero)}
                        {v.tipo === 'replay' && <span className="ml-1 text-[10px] text-violet-300">R</span>}
                      </span>
                      <select
                        className={`${BASE_INPUT} h-8 w-36 text-[13px]`}
                        value={v.stato}
                        onChange={(e) => void cambiaStato(v, e.target.value as StatoTake)}
                      >
                        {STATI_TAKE.map((s) => (
                          <option key={s.valore} value={s.valore}>
                            {s.etichetta}
                          </option>
                        ))}
                      </select>
                      <span className="w-14 shrink-0 tabular-nums text-zinc-400">{v.durataS !== null ? formattaDurata(v.durataS) : '—'}</span>
                      <span className="min-w-0 flex-1 truncate text-zinc-500" title={v.file.map((f) => `${ETICHETTA_RUOLO[f.ruolo] ?? f.ruolo}: ${f.percorso}${f.esiste ? '' : ' (non più su disco)'}`).join('\n')}>
                        {video && !video.esiste ? <span className="text-amber-300">video non più su disco · </span> : null}
                        {presenti.length} file · {formattaByte(v.byte)}
                        {v.sincronizzato && <span className="ml-2 text-emerald-300/80">sync</span>}
                      </span>
                      <Menu
                        icona={MoreHorizontal}
                        titolo={`Azioni sul take ${pad2(v.numero)}`}
                        voci={[
                          {
                            etichetta: 'Mostra nella cartella',
                            icona: FolderSearch,
                            disabilitata: !presenti.length,
                            onClick: () => void revealItemInDir(presenti[0].percorso).catch(errore),
                          },
                          {
                            etichetta: 'Capitoli YouTube',
                            icona: BookOpen,
                            onClick: () =>
                              void backend
                                .takeCapitoli(v.takeId)
                                .then((c) => {
                                  onCapitoli(c.testo, c.avvisi, c.file);
                                  ricarica();
                                })
                                .catch(errore),
                          },
                          {
                            etichetta: 'Esporta EDL',
                            icona: FileText,
                            nota: 'Per Premiere e Resolve',
                            onClick: () =>
                              void backend
                                .takeEdl(v.takeId, useApp.getState().impostazioni.ffmpeg.percorso)
                                .then((f) => {
                                  avvisa('ok', `EDL creati: ${f.map((x) => x.split(/[\\/]/).pop()).join(', ')}`);
                                  ricarica();
                                })
                                .catch(errore),
                          },
                          {
                            etichetta: 'Crea proxy leggero',
                            icona: Clapperboard,
                            nota: 'Copia a 720p da tenere al posto del 4K',
                            disabilitata: !video?.esiste,
                            onClick: () =>
                              void backend
                                .postAccoda(v.takeId, 'proxy', { ffmpeg: useApp.getState().impostazioni.ffmpeg.percorso })
                                .then(() => avvisa('info', 'Proxy in coda.'))
                                .catch(errore),
                          },
                          { etichetta: 'Archivia…', icona: Archive, separa: true, disabilitata: !presenti.length, onClick: () => onArchivia([v]) },
                          {
                            etichetta: 'Sposta file nel Cestino…',
                            icona: Trash2,
                            pericolo: true,
                            disabilitata: !presenti.length,
                            onClick: () =>
                              onConferma({
                                titolo: `Spostare nel Cestino i file del take ${pad2(v.numero)}?`,
                                azione: 'Sposta nel Cestino',
                                descrizione: 'Vanno nel Cestino di Windows e si possono recuperare da lì. Il take resta nella libreria.',
                                file: [{ take: v, percorsi: presenti.map((f) => f.percorso) }],
                                esegui: async () => {
                                  await backend.fileCestina(v.takeId, presenti.map((f) => f.percorso));
                                },
                              }),
                          },
                        ]}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Riquadro>
  );
}

export function Libreria() {
  const { preset, impostazioni, salvaImpostazioni, avvisa } = useApp();
  const lavori = useLavori((s) => s.lavori);
  const [voci, setVoci] = useState<VoceLibreria[]>([]);
  const [conferma, setConferma] = useState<RichiestaConferma | null>(null);
  const [capitoli, setCapitoli] = useState<{ testo: string; avvisi: string[]; file: string } | null>(null);

  const ricarica = () => void backend.libreria().then((v) => setVoci(v ?? []), () => setVoci([]));
  // Si riaggiorna quando un lavoro finisce (nuovi file prodotti).
  const finiti = lavori.filter((l) => l.stato === 'fatto').length;
  useEffect(ricarica, [finiti]);

  const nomiPreset = useMemo(() => new Map(preset.map((p) => [p.id, p.nome])), [preset]);
  const numeri = useMemo(() => new Map(voci.map((v) => [v.takeId, `take ${pad2(v.numero)}`])), [voci]);

  const archivia = async (take: VoceLibreria[]) => {
    const cartella = await open({
      directory: true,
      title: 'Cartella di archivio (es. un disco esterno)',
      defaultPath: impostazioni.archivio.cartella || undefined,
    });
    if (typeof cartella !== 'string') return;
    void salvaImpostazioni({ ...impostazioni, archivio: { cartella } }).catch(() => {});
    setConferma({
      titolo: `Archiviare ${take.length === 1 ? `il take ${pad2(take[0].numero)}` : `${take.length} take`}?`,
      azione: 'Archivia',
      descrizione: `I file vengono spostati in ${cartella} (mai sovrascrivendo) e il take viene segnato come archiviato.`,
      file: take.map((v) => ({ take: v, percorsi: v.file.filter((f) => f.esiste).map((f) => f.percorso) })),
      esegui: async () => {
        for (const v of take) await backend.takeArchivia(v.takeId, cartella);
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Coda numeri={numeri} />
      <Proposte voci={voci} onConferma={setConferma} onArchivia={(t) => void archivia(t)} />
      <ElencoTake
        voci={voci}
        nomiPreset={nomiPreset}
        onConferma={setConferma}
        onArchivia={(t) => void archivia(t)}
        onCapitoli={(testo, avvisi, file) => setCapitoli({ testo, avvisi, file })}
        ricarica={ricarica}
      />

      {conferma && (
        <ConfermaDialog
          titolo={conferma.titolo}
          conferma={conferma.azione}
          onChiudi={() => setConferma(null)}
          onConferma={() =>
            void conferma
              .esegui()
              .then(() => avvisa('ok', 'Fatto.'))
              .catch((e) => avvisa('errore', messaggioErrore(e)))
              .finally(ricarica)
          }
          testo={
            <>
              <p>{conferma.descrizione}</p>
              <ul className="max-h-60 overflow-y-auto rounded-md border border-bordo bg-fondo p-2 font-mono text-[11px] text-zinc-400">
                {conferma.file.flatMap(({ take, percorsi }) =>
                  percorsi.map((p) => (
                    <li key={p} className="truncate" title={p}>
                      take {pad2(take.numero)} · {p.split(/[\\/]/).pop()}
                    </li>
                  )),
                )}
              </ul>
              <p className="text-zinc-400">
                Totale:{' '}
                {formattaByte(
                  conferma.file.reduce(
                    (a, { take, percorsi }) => a + take.file.filter((f) => percorsi.includes(f.percorso)).reduce((b, f) => b + f.byte, 0),
                    0,
                  ),
                )}
              </p>
            </>
          }
        />
      )}

      {capitoli && (
        <Modale
          compatta
          titolo="Capitoli YouTube"
          sottotitolo="Da incollare nella descrizione del video"
          onChiudi={() => setCapitoli(null)}
          piede={
            <>
              <Pulsante icona={FolderSearch} onClick={() => void revealItemInDir(capitoli.file)}>
                Mostra il file
              </Pulsante>
              <div className="flex-1" />
              <Pulsante
                variante="primario"
                icona={Copy}
                onClick={() =>
                  void navigator.clipboard.writeText(capitoli.testo).then(
                    () => avvisa('ok', 'Capitoli copiati.'),
                    () => avvisa('errore', 'Copia non riuscita.'),
                  )
                }
              >
                Copia
              </Pulsante>
            </>
          }
        >
          <pre className="whitespace-pre-wrap rounded-md border border-bordo bg-fondo p-3 font-mono text-[13px] text-zinc-200">{capitoli.testo}</pre>
          {capitoli.avvisi.map((a) => (
            <p key={a} className="mt-2 text-xs text-amber-300">
              {a}
            </p>
          ))}
        </Modale>
      )}
    </div>
  );
}
