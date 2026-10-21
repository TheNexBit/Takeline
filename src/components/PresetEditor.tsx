import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { messaggioErrore } from '../lib/backend';
import { ETICHETTA_TIPO, type ModalitaReaper, type Preset, type SegniReaper, type TipoPreset } from '../lib/model';
import {
  VARIABILI,
  VARIABILI_CARTELLA,
  risolviCartella,
  risolviNome,
  templatePerObs,
  variabiliSconosciute,
} from '../lib/naming';
import { useApp } from '../store/app';
import {
  BarraSchede,
  CLASSE_INPUT,
  CLASSE_NUMERO,
  Campo,
  Interruttore,
  Modale,
  Pulsante,
  Riga,
  Segmenti,
  Sezione,
} from './ui';

type SchedaEditor = 'generale' | 'obs' | 'reaper' | 'registrazione' | 'post';

const MODALITA: { valore: ModalitaReaper; etichetta: string; descrizione: string }[] = [
  {
    valore: 'take-continua',
    etichetta: 'Take continua',
    descrizione: 'Reaper registra per tutta la sessione; ogni take diventa una region.',
  },
  { valore: 'start-stop', etichetta: 'Start/stop con OBS', descrizione: 'Reaper parte e si ferma con ogni take.' },
  { valore: 'disattivato', etichetta: 'Non usato', descrizione: 'Reaper non viene toccato.' },
];

const SEGNI: { valore: SegniReaper; etichetta: string; descrizione: string }[] = [
  { valore: 'niente', etichetta: 'Niente', descrizione: 'Il progetto resta com’è.' },
  { valore: 'region', etichetta: 'Solo region', descrizione: 'Una region con nome per ogni take.' },
  {
    valore: 'tutto',
    etichetta: 'Region e marker',
    descrizione: 'Anche marker per clap, buono, da tagliare e capitoli.',
  },
];

function ListaSuggerimenti({ id, voci }: { id: string; voci: string[] }) {
  return (
    <datalist id={id}>
      {voci.map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  );
}

/** Elenco separato da virgole: si scrive liberamente, si interpreta all'uscita dal campo. */
function CampoElenco({ valore, onCambia }: { valore: string[]; onCambia: (v: string[]) => void }) {
  const [testo, setTesto] = useState(valore.join(', '));
  useEffect(() => setTesto(valore.join(', ')), [valore.join(',')]);
  return (
    <input
      className={CLASSE_INPUT}
      value={testo}
      onChange={(e) => setTesto(e.target.value)}
      onBlur={() =>
        onCambia(
          testo
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
      }
    />
  );
}

export function PresetEditor() {
  const { inModifica, preset, obs, impostazioni, presetErrore } = useApp();
  const { apriEditor, salvaPreset, eliminaPreset, avvisa } = useApp.getState();
  const originale = preset.find((p) => p.id === inModifica);
  const [bozza, setBozza] = useState<Preset | null>(null);
  const [scheda, setScheda] = useState<SchedaEditor>('generale');
  const [confermaElimina, setConfermaElimina] = useState(false);
  const templateRef = useRef<HTMLInputElement>(null);

  // La bozza riparte dal salvato solo quando cambia il preset in modifica.
  useEffect(() => {
    setBozza(originale ? structuredClone(originale) : null);
    setConfermaElimina(false);
    setScheda('generale');
  }, [inModifica]);

  const esempio = useMemo(() => {
    if (!bozza) return null;
    const ctx = { preset: bozza.nome, titolo: impostazioni.titolo || 'Titolo', take: 3, quando: new Date() };
    return {
      nome: risolviNome(bozza.output.templateNome, ctx),
      obs: templatePerObs(bozza.output.templateNome, ctx),
      cartella: risolviCartella(bozza.output.cartella, ctx),
      ignoteNome: variabiliSconosciute(bozza.output.templateNome),
      ignoteCartella: variabiliSconosciute(bozza.output.cartella, VARIABILI_CARTELLA),
    };
  }, [bozza, impostazioni.titolo]);

  if (!inModifica || !bozza || !esempio) return null;

  const modifica = (fn: (p: Preset) => void) =>
    setBozza((b) => {
      if (!b) return b;
      const c = structuredClone(b);
      fn(c);
      return c;
    });

  const inserisciVariabile = (v: string) => {
    const el = templateRef.current;
    const t = bozza.output.templateNome;
    const [a, z] = el ? [el.selectionStart ?? t.length, el.selectionEnd ?? t.length] : [t.length, t.length];
    modifica((p) => (p.output.templateNome = `${t.slice(0, a)}{${v}}${t.slice(z)}`));
    requestAnimationFrame(() => el?.focus());
  };

  const sfogliaCartella = async () => {
    const scelta = await open({ directory: true, title: 'Cartella di output del preset' });
    if (typeof scelta === 'string') modifica((p) => (p.output.cartella = scelta));
  };

  const salva = async () => {
    if (!bozza.nome.trim()) {
      setScheda('generale');
      return avvisa('avviso', 'Il preset ha bisogno di un nome.');
    }
    try {
      await salvaPreset({ ...bozza, nome: bozza.nome.trim() });
      apriEditor(null);
    } catch (e) {
      avvisa('errore', messaggioErrore(e));
    }
  };

  const ist = obs.ist;
  const sporco = JSON.stringify(bozza) !== JSON.stringify(originale);
  const usaReaper = bozza.reaper.modalita !== 'disattivato';

  return (
    <Modale
      laterale
      titolo={bozza.nome || 'Preset senza nome'}
      sottotitolo={`Preset ${ETICHETTA_TIPO[bozza.tipo].toLowerCase()}${sporco ? ' · modifiche non salvate' : ''}`}
      onChiudi={() => apriEditor(null)}
      schede={
        <BarraSchede<SchedaEditor>
          valore={scheda}
          onCambia={setScheda}
          schede={[
            { id: 'generale', etichetta: 'Generale', avviso: !bozza.nome.trim() },
            { id: 'obs', etichetta: 'OBS e file', avviso: esempio.ignoteNome.length + esempio.ignoteCartella.length > 0 },
            { id: 'reaper', etichetta: 'Reaper' },
            { id: 'registrazione', etichetta: 'Registrazione' },
            { id: 'post', etichetta: 'Post-produzione' },
          ]}
        />
      }
      piede={
        <>
          {confermaElimina ? (
            <>
              <span className="text-sm text-zinc-300">Eliminare il preset?</span>
              <Pulsante variante="fantasma" onClick={() => setConfermaElimina(false)}>
                No
              </Pulsante>
              <Pulsante variante="pericolo" onClick={() => eliminaPreset(bozza.id).catch((e) => avvisa('errore', messaggioErrore(e)))}>
                Elimina
              </Pulsante>
            </>
          ) : (
            <Pulsante variante="fantasma" icona={Trash2} onClick={() => setConfermaElimina(true)}>
              Elimina
            </Pulsante>
          )}
          <div className="flex-1" />
          <Pulsante variante="secondario" onClick={() => apriEditor(null)}>
            Annulla
          </Pulsante>
          <Pulsante variante="primario" icona={Save} disabled={!sporco || !!presetErrore} onClick={salva}>
            Salva
          </Pulsante>
        </>
      }
    >
      {scheda === 'generale' && (
        <div className="flex flex-col gap-5">
          <Campo etichetta="Nome">
            <input className={CLASSE_INPUT} value={bozza.nome} onChange={(e) => modifica((p) => (p.nome = e.target.value))} />
          </Campo>
          <Campo etichetta="Tipo" aiuto="Decide l'icona; il comportamento si regola nelle altre schede.">
            <select className={CLASSE_INPUT} value={bozza.tipo} onChange={(e) => modifica((p) => (p.tipo = e.target.value as TipoPreset))}>
              {Object.entries(ETICHETTA_TIPO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etichetta="Descrizione">
            <textarea
              rows={3}
              className={`${CLASSE_INPUT} h-auto py-2`}
              value={bozza.descrizione}
              onChange={(e) => modifica((p) => (p.descrizione = e.target.value))}
            />
          </Campo>
        </div>
      )}

      {scheda === 'obs' && (
        <div className="flex flex-col gap-7">
          <Sezione
            titolo="Configurazione di OBS"
            descrizione={`Campo vuoto = lascia quella attiva. I suggerimenti arrivano da OBS${ist ? '' : ' (connettilo per vederli)'}.`}
          >
            <div className="flex flex-col gap-4 py-3.5">
              <Campo etichetta="Scene collection">
                <input
                  className={CLASSE_INPUT}
                  list="tl-collezioni"
                  placeholder={ist ? `attiva: ${ist.collezione}` : 'quella attiva'}
                  value={bozza.obs.sceneCollection}
                  onChange={(e) => modifica((p) => (p.obs.sceneCollection = e.target.value))}
                />
              </Campo>
              <Campo etichetta="Profilo">
                <input
                  className={CLASSE_INPUT}
                  list="tl-profili"
                  placeholder={ist ? `attivo: ${ist.profilo}` : 'quello attivo'}
                  value={bozza.obs.profilo}
                  onChange={(e) => modifica((p) => (p.obs.profilo = e.target.value))}
                />
              </Campo>
              <div className="grid grid-cols-2 gap-4">
                <Campo etichetta="Scena">
                  <input
                    className={CLASSE_INPUT}
                    list="tl-scene"
                    placeholder={ist ? `attiva: ${ist.scena}` : 'quella attiva'}
                    value={bozza.obs.scena}
                    onChange={(e) => modifica((p) => (p.obs.scena = e.target.value))}
                  />
                </Campo>
                <Campo etichetta="Traccia guida" aiuto="Sorgente audio col monitor out, per il sync">
                  <input
                    className={CLASSE_INPUT}
                    list="tl-sorgenti"
                    placeholder="nessuna"
                    value={bozza.obs.tracciaGuida}
                    onChange={(e) => modifica((p) => (p.obs.tracciaGuida = e.target.value))}
                  />
                </Campo>
              </div>
            </div>
            <ListaSuggerimenti id="tl-collezioni" voci={ist?.collezioni ?? []} />
            <ListaSuggerimenti id="tl-profili" voci={ist?.profili ?? []} />
            <ListaSuggerimenti id="tl-scene" voci={ist?.scene ?? []} />
            <ListaSuggerimenti id="tl-sorgenti" voci={ist?.sorgentiAudio.map((s) => s.nome) ?? []} />
          </Sezione>

          <Sezione titolo="File video">
            <div className="flex flex-col gap-4 py-3.5">
              <Campo
                etichetta="Cartella di output"
                errore={
                  esempio.ignoteCartella.length
                    ? `Qui valgono solo {preset} e {data}: ${esempio.ignoteCartella.map((v) => `{${v}}`).join(' ')} non vale`
                    : null
                }
                aiuto={<span className="break-all">→ {esempio.cartella}</span>}
              >
                <div className="flex gap-2">
                  <input
                    className={CLASSE_INPUT}
                    value={bozza.output.cartella}
                    onChange={(e) => modifica((p) => (p.output.cartella = e.target.value))}
                  />
                  <Pulsante icona={FolderOpen} onClick={() => void sfogliaCartella()}>
                    Sfoglia
                  </Pulsante>
                </div>
              </Campo>
              <Campo
                etichetta="Nome dei file"
                errore={esempio.ignoteNome.length ? `Variabili sconosciute: ${esempio.ignoteNome.map((v) => `{${v}}`).join(' ')}` : null}
                aiuto={
                  <span>
                    → <span className="text-zinc-300">{esempio.nome}</span>.mkv
                  </span>
                }
              >
                <input
                  ref={templateRef}
                  className={`${CLASSE_INPUT} font-mono`}
                  value={bozza.output.templateNome}
                  onChange={(e) => modifica((p) => (p.output.templateNome = e.target.value))}
                />
              </Campo>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-zinc-500">Inserisci:</span>
                {VARIABILI.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => inserisciVariabile(v)}
                    className="h-8 rounded-md border border-bordo bg-rilievo px-2.5 font-mono text-xs text-zinc-200 hover:border-zinc-500"
                  >
                    {`{${v}}`}
                  </button>
                ))}
              </div>
            </div>
          </Sezione>
        </div>
      )}

      {scheda === 'reaper' && (
        <div className="flex flex-col gap-6">
          <Sezione titolo="Come registra Reaper">
            <div className="py-3.5">
              <Segmenti<ModalitaReaper>
                valore={bozza.reaper.modalita}
                onCambia={(v) => modifica((p) => (p.reaper.modalita = v))}
                opzioni={MODALITA}
              />
            </div>
          </Sezione>
          {usaReaper && (
            <Sezione
              titolo="Cosa scrivere nel progetto di Reaper"
              descrizione={
                <>
                  Solo un aiuto per orientarsi: le posizioni dei take restano nella lista di Takeline, quindi puoi cancellare
                  region e marker quando vuoi.
                  {!impostazioni.reaper.bridgeId && (
                    <span className="mt-1 block text-amber-300/90">
                      Lo script bridge non è installato: finché manca, Takeline non scrive niente in Reaper.
                    </span>
                  )}
                </>
              }
            >
              <div className="py-3.5">
                <Segmenti<SegniReaper>
                  valore={bozza.reaper.segni}
                  onCambia={(v) => modifica((p) => (p.reaper.segni = v))}
                  opzioni={SEGNI}
                />
              </div>
            </Sezione>
          )}
          {usaReaper && (
            <Sezione titolo="Prima di registrare">
              <Interruttore
                attivo={bozza.reaper.armaTracce}
                onCambia={(v) => modifica((p) => (p.reaper.armaTracce = v))}
                etichetta="Se nessuna traccia è armata, armale tutte"
                aiuto="Le tracce che armi tu in Reaper non vengono mai toccate."
              />
              <Interruttore
                attivo={bozza.reaper.tornaAllInizio}
                disabilitato={bozza.reaper.modalita === 'take-continua'}
                onCambia={(v) => modifica((p) => (p.reaper.tornaAllInizio = v))}
                etichetta="Torna all'inizio del progetto"
                aiuto={
                  bozza.reaper.modalita === 'take-continua'
                    ? 'Non vale con la take continua.'
                    : 'Ogni take parte dall’inizio della timeline.'
                }
              />
            </Sezione>
          )}
        </div>
      )}

      {scheda === 'registrazione' && (
        <div className="flex flex-col gap-6">
          <Sezione titolo="Durante la registrazione">
            <Interruttore
              attivo={bozza.transport.clap}
              onCambia={(v) => modifica((p) => (p.transport.clap = v))}
              etichetta="Clap all'avvio di ogni take"
              aiuto="Flash in stage view e click sull'uscita audio: un riferimento certo per il sync."
            />
            <Interruttore
              attivo={bozza.transport.replayBuffer}
              onCambia={(v) => modifica((p) => (p.transport.replayBuffer = v))}
              etichetta="Tieni attivo il replay buffer"
              aiuto="Un colpo di pedale salva gli ultimi minuti, anche fuori dalle take."
            />
            {bozza.transport.replayBuffer && (
              <Riga titolo="Durata del replay buffer" descrizione="Quanti minuti tiene in memoria OBS.">
                <input
                  type="number"
                  min={1}
                  max={60}
                  className={CLASSE_NUMERO}
                  value={bozza.transport.replayMinuti}
                  onChange={(e) => modifica((p) => (p.transport.replayMinuti = Math.min(60, Math.max(1, Number(e.target.value) || 5))))}
                />
                <span className="w-8 text-sm text-zinc-400">min</span>
              </Riga>
            )}
          </Sezione>
          <Sezione
            titolo="Sync video-audio"
            descrizione={
              <>
                Confronta la traccia audio del video con il WAV di Reaper: misura l’offset all’inizio e il drift tra i due clock
                verso la fine. Serve lo script bridge.
                {!bozza.obs.tracciaGuida && (
                  <span className="mt-1 block text-zinc-400">
                    Senza traccia guida (scheda OBS e file) si usa la prima traccia audio del video: funziona se contiene anche la
                    chitarra.
                  </span>
                )}
              </>
            }
          >
            <Interruttore
              attivo={bozza.sync.automatico}
              onCambia={(v) => modifica((p) => (p.sync.automatico = v))}
              etichetta="Sync automatico"
              aiuto="Appena Reaper si ferma: a fine take con start/stop, a fine sessione con la take continua. Mai durante una registrazione."
            />
            <Interruttore
              attivo={bozza.sync.esporta}
              onCambia={(v) => modifica((p) => (p.sync.esporta = v))}
              etichetta="Crea video e audio sincronizzati"
              aiuto="Accanto al video: un MP4 con l'audio di Reaper allineato e corretto in velocità, più il WAV allineato."
            />
          </Sezione>
          <Sezione titolo="Consenso">
            <Interruttore
              attivo={bozza.consenso.attivo}
              onCambia={(v) => modifica((p) => (p.consenso.attivo = v))}
              etichetta="Promemoria di consenso prima di registrare"
              aiuto="Per le call con altre persone."
            />
            {bozza.consenso.attivo && (
              <div className="py-3.5">
                <Campo etichetta="Testo del promemoria">
                  <textarea
                    rows={4}
                    className={`${CLASSE_INPUT} h-auto py-2`}
                    value={bozza.consenso.testo}
                    onChange={(e) => modifica((p) => (p.consenso.testo = e.target.value))}
                  />
                </Campo>
              </div>
            )}
          </Sezione>
        </div>
      )}

      {scheda === 'post' && (
        <Sezione
          titolo="Dopo ogni take"
          descrizione="Lavorazioni con ffmpeg in una coda (scheda Libreria), mai durante una registrazione. I file originali non vengono toccati: ogni lavorazione crea un file nuovo accanto al video."
        >
          <Interruttore
            attivo={bozza.post.remuxMp4}
            onCambia={(v) => modifica((p) => (p.post.remuxMp4 = v))}
            etichetta="Remux MKV → MP4"
            aiuto="Senza ricodifica: veloce e senza perdita."
          />
          <Interruttore
            attivo={bozza.post.separaTracce}
            onCambia={(v) => modifica((p) => (p.post.separaTracce = v))}
            etichetta="Tracce audio in file separati"
          />
          <Interruttore
            attivo={bozza.post.marker}
            onCambia={(v) => modifica((p) => (p.post.marker = v))}
            etichetta="Capitoli YouTube ed EDL"
            aiuto="Dai marker del take: un .txt da incollare nella descrizione e gli .edl per Premiere e Resolve."
          />
          <Interruttore
            attivo={bozza.post.normalizza}
            onCambia={(v) => modifica((p) => (p.post.normalizza = v))}
            etichetta="Normalizza il loudness"
          />
          {bozza.post.normalizza && (
            <Riga titolo="Livello di loudness" descrizione="YouTube e Spotify: −14. Parlato e corsi: −16.">
              <input
                type="number"
                step={1}
                min={-40}
                max={-5}
                className={CLASSE_NUMERO}
                value={bozza.post.lufs}
                onChange={(e) => modifica((p) => (p.post.lufs = Number(e.target.value) || -14))}
              />
              <span className="w-8 text-sm text-zinc-400">LUFS</span>
            </Riga>
          )}
          <div className="py-3.5">
            <Campo
              etichetta="Export per piattaforma"
              aiuto="Separati da virgola. Note: youtube, vimeo (H.264 alta qualità), facebook, instagram (max 1080p)."
            >
              <CampoElenco valore={bozza.post.export} onCambia={(v) => modifica((p) => (p.post.export = v))} />
            </Campo>
          </div>
        </Sezione>
      )}
    </Modale>
  );
}
