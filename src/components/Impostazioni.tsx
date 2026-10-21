import { open } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { Download, FolderOpen, Loader2, PlugZap, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import { backend, messaggioErrore, type InfoDb } from '../lib/backend';
import type { CambioProgetto, Impostazioni as TipoImpostazioni } from '../lib/model';
import { useApp } from '../store/app';
import { BarraSchede, BASE_INPUT, CLASSE_INPUT, CLASSE_NUMERO, Campo, Interruttore, Modale, Pulsante, Riga, Sezione } from './ui';

type SchedaImpostazioni = 'obs' | 'reaper' | 'ffmpeg' | 'sicurezza' | 'dati';

interface Prova {
  inCorso: boolean;
  esito?: string;
  ok?: boolean;
}

function EsitoProva({ prova }: { prova: Prova }) {
  if (!prova.esito) return null;
  return (
    <div
      className={`rounded-md border px-3 py-2 text-[13px] ${prova.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`}
    >
      {prova.esito}
    </div>
  );
}

function CampoCartella({
  valore,
  segnaposto,
  onCambia,
  titoloDialogo,
  file,
}: {
  valore: string;
  segnaposto?: string;
  onCambia: (v: string) => void;
  titoloDialogo: string;
  /** Sceglie un file .exe invece di una cartella. */
  file?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <input className={CLASSE_INPUT} placeholder={segnaposto} value={valore} onChange={(e) => onCambia(e.target.value)} />
      <Pulsante
        icona={FolderOpen}
        onClick={async () => {
          const s = await open(
            file ? { title: titoloDialogo, filters: [{ name: 'Programma', extensions: ['exe'] }] } : { directory: true, title: titoloDialogo },
          );
          if (typeof s === 'string') onCambia(s);
        }}
      >
        Sfoglia
      </Pulsante>
    </div>
  );
}

export function Impostazioni() {
  const { impostazioniAperte, impostazioni, percorsi } = useApp();
  const { apriImpostazioni, salvaImpostazioni, avvisa } = useApp.getState();
  const [bozza, setBozza] = useState<TipoImpostazioni>(impostazioni);
  const [scheda, setScheda] = useState<SchedaImpostazioni>('obs');
  const [provaReaper, setProvaReaper] = useState<Prova>({ inCorso: false });
  const [provaBridge, setProvaBridge] = useState<Prova>({ inCorso: false });
  const [db, setDb] = useState<InfoDb | null>(null);
  const [cartellaLog, setCartellaLog] = useState<string | null>(null);

  useEffect(() => {
    if (!impostazioniAperte) return;
    setBozza(structuredClone(impostazioni));
    setProvaReaper({ inCorso: false });
    setProvaBridge({ inCorso: false });
    backend.db().then(setDb, () => setDb(null));
    backend.cartellaLog().then(setCartellaLog, () => setCartellaLog(null));
  }, [impostazioniAperte]);

  if (!impostazioniAperte) return null;

  const modifica = (fn: (b: TipoImpostazioni) => void) =>
    setBozza((b) => {
      const c = structuredClone(b);
      fn(c);
      return c;
    });
  const chiudi = () => apriImpostazioni(false);
  const apri = (p?: string | null) => p && openPath(p).catch((e) => avvisa('errore', messaggioErrore(e)));

  const installaBridge = async () => {
    try {
      const file = await backend.installaBridge(bozza.reaper.cartellaRisorse);
      setProvaBridge({ inCorso: false, ok: true, esito: `Script copiato in ${file}. Ora caricalo in Reaper (passo 2).` });
    } catch (e) {
      setProvaBridge({ inCorso: false, ok: false, esito: messaggioErrore(e) });
    }
  };

  const provaConnessioneBridge = async () => {
    setProvaBridge({ inCorso: true });
    try {
      const esito = await backend.reaperBridge(bozza.reaper, bozza.reaper.bridgeId, ['ping', 'takeline']);
      setProvaBridge({ inCorso: false, ok: esito === 'pong takeline', esito: `Risposta dello script: ${esito}` });
    } catch (e) {
      setProvaBridge({ inCorso: false, ok: false, esito: messaggioErrore(e) });
    }
  };

  const provaConnessioneReaper = async () => {
    setProvaReaper({ inCorso: true });
    try {
      const s = await backend.reaperStato(bozza.reaper);
      setProvaReaper({ inCorso: false, ok: true, esito: `Reaper risponde: ${s.tracce.length} tracce, posizione ${s.posizioneTesto}.` });
    } catch (e) {
      setProvaReaper({ inCorso: false, ok: false, esito: messaggioErrore(e) });
    }
  };

  const salva = async () => {
    try {
      await salvaImpostazioni(bozza);
      chiudi();
      avvisa('ok', 'Impostazioni salvate.');
    } catch (e) {
      avvisa('errore', messaggioErrore(e));
    }
  };

  const sporco = JSON.stringify(bozza) !== JSON.stringify(impostazioni);

  return (
    <Modale
      titolo="Impostazioni"
      sottotitolo={sporco ? 'Modifiche non salvate' : undefined}
      onChiudi={chiudi}
      schede={
        <BarraSchede<SchedaImpostazioni>
          valore={scheda}
          onCambia={setScheda}
          schede={[
            { id: 'obs', etichetta: 'OBS' },
            { id: 'reaper', etichetta: 'Reaper' },
            { id: 'ffmpeg', etichetta: 'ffmpeg' },
            { id: 'sicurezza', etichetta: 'Sicurezza' },
            { id: 'dati', etichetta: 'Dati e log' },
          ]}
        />
      }
      piede={
        <>
          <div className="flex-1" />
          <Pulsante variante="secondario" onClick={chiudi}>
            Annulla
          </Pulsante>
          <Pulsante variante="primario" icona={Save} disabled={!sporco} onClick={salva}>
            Salva
          </Pulsante>
        </>
      }
    >
      {scheda === 'obs' && (
        <div className="flex flex-col gap-7">
          <Sezione titolo="Connessione" descrizione="In OBS: Strumenti › Impostazioni server WebSocket.">
            <div className="grid grid-cols-[1fr_220px] gap-4 py-3.5">
              <Campo etichetta="Indirizzo">
                <input className={CLASSE_INPUT} value={bozza.obs.url} onChange={(e) => modifica((b) => (b.obs.url = e.target.value))} />
              </Campo>
              <Campo etichetta="Password">
                <input
                  type="password"
                  className={CLASSE_INPUT}
                  value={bozza.obs.password}
                  onChange={(e) => modifica((b) => (b.obs.password = e.target.value))}
                />
              </Campo>
            </div>
            <Interruttore
              attivo={bozza.obs.connettiAllAvvio}
              onCambia={(v) => modifica((b) => (b.obs.connettiAllAvvio = v))}
              etichetta="Connetti all'avvio"
              aiuto="E riprova da solo se OBS si chiude o si riavvia."
            />
            <Riga titolo="Attesa dopo un cambio di collezione o profilo" descrizione="Il tempo che OBS ha per ricaricare prima dell'errore.">
              <input
                type="number"
                min={5}
                max={120}
                className={CLASSE_NUMERO}
                value={bozza.obs.timeoutRicaricoSec}
                onChange={(e) => modifica((b) => (b.obs.timeoutRicaricoSec = Number(e.target.value) || 30))}
              />
              <span className="w-8 text-sm text-zinc-400">s</span>
            </Riga>
          </Sezione>
          <Sezione titolo="Backup" descrizione="Da questa cartella si copiano scene collection e profili prima di ogni cambio.">
            <div className="py-3.5">
              <Campo etichetta="Cartella di configurazione di OBS" aiuto="Vuota = rilevata automaticamente. Serve indicarla solo con OBS portable.">
                <CampoCartella
                  valore={bozza.obs.cartellaConfig}
                  segnaposto={percorsi?.obsConfigDir}
                  titoloDialogo="Cartella obs-studio"
                  onCambia={(v) => modifica((b) => (b.obs.cartellaConfig = v))}
                />
              </Campo>
            </div>
          </Sezione>
        </div>
      )}

      {scheda === 'reaper' && (
        <div className="flex flex-col gap-7">
          <Sezione titolo="Interfaccia web" descrizione="In Reaper: Options › Preferences › Control/OSC/web › Add › Web browser interface.">
            <div className="grid grid-cols-[1fr_120px] gap-4 py-3.5">
              <Campo etichetta="Host">
                <input className={CLASSE_INPUT} value={bozza.reaper.host} onChange={(e) => modifica((b) => (b.reaper.host = e.target.value))} />
              </Campo>
              <Campo etichetta="Porta">
                <input
                  type="number"
                  className={CLASSE_INPUT}
                  value={bozza.reaper.porta}
                  onChange={(e) => modifica((b) => (b.reaper.porta = Number(e.target.value) || 8080))}
                />
              </Campo>
            </div>
            <div className="grid grid-cols-2 gap-4 py-3.5">
              <Campo etichetta="Utente" aiuto="Solo se l'hai impostato in Reaper">
                <input className={CLASSE_INPUT} value={bozza.reaper.utente} onChange={(e) => modifica((b) => (b.reaper.utente = e.target.value))} />
              </Campo>
              <Campo etichetta="Password">
                <input
                  type="password"
                  className={CLASSE_INPUT}
                  value={bozza.reaper.password}
                  onChange={(e) => modifica((b) => (b.reaper.password = e.target.value))}
                />
              </Campo>
            </div>
            <div className="flex flex-col gap-3 py-3.5">
              <div>
                <Pulsante icona={provaReaper.inCorso ? Loader2 : PlugZap} disabled={provaReaper.inCorso} onClick={provaConnessioneReaper}>
                  Prova connessione
                </Pulsante>
              </div>
              <EsitoProva prova={provaReaper} />
            </div>
          </Sezione>

          <Sezione titolo="Sessioni">
            <Riga
              titolo="Quando in Reaper apri un altro progetto"
              descrizione="Takeline se ne accorge alla take successiva grazie a un contrassegno invisibile nel progetto (non è un marker)."
            >
              <select
                className={`${BASE_INPUT} w-64`}
                value={bozza.reaper.cambioProgetto}
                onChange={(e) => modifica((b) => (b.reaper.cambioProgetto = e.target.value as CambioProgetto))}
              >
                <option value="nuova-sessione">Nuova sessione, da take 01</option>
                <option value="continua">Continua la numerazione</option>
              </select>
            </Riga>
          </Sezione>

          <Sezione
            titolo="Script bridge · region con nome"
            descrizione="L'interfaccia web di Reaper non sa creare region con nome: lo fa questo piccolo script. Senza, ogni take diventa una coppia di marker numerati."
          >
            <ol className="flex flex-col gap-2 py-3.5 text-[13px] text-zinc-300">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rilievo text-xs font-semibold">1</span>
                <span className="flex flex-1 items-center justify-between gap-3">
                  Copia lo script nella cartella Scripts di Reaper.
                  <Pulsante icona={Download} onClick={installaBridge}>
                    Installa script
                  </Pulsante>
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rilievo text-xs font-semibold">2</span>
                <span>In Reaper: Actions › Show action list › New action › Load ReaScript, e scegli il file copiato.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rilievo text-xs font-semibold">3</span>
                <span>Tasto destro sull'azione › Copy selected action command ID, e incollalo qui sotto.</span>
              </li>
            </ol>
            <div className="flex flex-col gap-3 py-3.5">
              <Campo etichetta="Command ID dello script" aiuto="Inizia con _RS">
                <div className="flex gap-2">
                  <input
                    className={`${CLASSE_INPUT} font-mono`}
                    placeholder="_RS…"
                    value={bozza.reaper.bridgeId}
                    onChange={(e) => modifica((b) => (b.reaper.bridgeId = e.target.value.trim()))}
                  />
                  <Pulsante
                    icona={provaBridge.inCorso ? Loader2 : PlugZap}
                    disabled={provaBridge.inCorso || !bozza.reaper.bridgeId}
                    onClick={provaConnessioneBridge}
                  >
                    Prova
                  </Pulsante>
                </div>
              </Campo>
              <EsitoProva prova={provaBridge} />
              <Campo etichetta="Cartella risorse di Reaper" aiuto="Vuota = %APPDATA%\REAPER. In Reaper: Options › Show REAPER resource path.">
                <CampoCartella
                  valore={bozza.reaper.cartellaRisorse}
                  titoloDialogo="Cartella risorse di Reaper"
                  onCambia={(v) => modifica((b) => (b.reaper.cartellaRisorse = v))}
                />
              </Campo>
            </div>
          </Sezione>
        </div>
      )}

      {scheda === 'sicurezza' && (
        <div className="flex flex-col gap-7">
          <Sezione titolo="Prima di registrare">
            <Interruttore
              attivo={bozza.sicurezza.preflight}
              onCambia={(v) => modifica((b) => (b.sicurezza.preflight = v))}
              etichetta="Pre-flight prima di ogni take"
              aiuto="Controlla OBS, Reaper, disco, encoder, fotogrammi, audio, pedale, ffmpeg. Con un errore la take non parte e il motivo compare in stage view."
            />
          </Sezione>
          <Sezione titolo="Durante la registrazione">
            <Interruttore
              attivo={bozza.sicurezza.watchdog}
              onCambia={(v) => modifica((b) => (b.sicurezza.watchdog = v))}
              etichetta="Watchdog"
              aiuto="Ogni 2 secondi controlla OBS, disco, fotogrammi persi e Reaper. Avvisa in stage view e, oltre le soglie, ferma la take in modo pulito."
            />
            <Riga titolo="Spazio minimo su disco" descrizione="Sotto questa soglia la take si ferma; al doppio compare un avviso.">
              <input
                type="number"
                min={1}
                max={500}
                className={CLASSE_NUMERO}
                value={bozza.sicurezza.discoMinimoGb}
                onChange={(e) => modifica((b) => (b.sicurezza.discoMinimoGb = Number(e.target.value) || 5))}
              />
              <span className="w-8 text-sm text-zinc-400">GB</span>
            </Riga>
            <Riga titolo="Fotogrammi persi" descrizione="Oltre questa percentuale, misurata dall'inizio della take, la take si ferma; a un quarto compare un avviso.">
              <input
                type="number"
                min={0.5}
                max={50}
                step={0.5}
                className={CLASSE_NUMERO}
                value={bozza.sicurezza.framePersiMax}
                onChange={(e) => modifica((b) => (b.sicurezza.framePersiMax = Number(e.target.value) || 5))}
              />
              <span className="w-8 text-sm text-zinc-400">%</span>
            </Riga>
          </Sezione>
        </div>
      )}

      {scheda === 'ffmpeg' && (
        <Sezione titolo="ffmpeg" descrizione="Serve per la post-produzione. Takeline non lo include: winget install Gyan.FFmpeg">
          <div className="py-3.5">
            <Campo etichetta="Eseguibile" aiuto="Vuoto = ffmpeg dal PATH di Windows.">
              <CampoCartella
                file
                valore={bozza.ffmpeg.percorso}
                segnaposto="ffmpeg"
                titoloDialogo="ffmpeg.exe"
                onCambia={(v) => modifica((b) => (b.ffmpeg.percorso = v))}
              />
            </Campo>
          </div>
        </Sezione>
      )}

      {scheda === 'dati' && (
        <Sezione titolo="Cartelle di Takeline">
          {(
            [
              ['Configurazione', 'Preset e impostazioni, modificabili a mano.', percorsi?.configDir],
              ['Backup di OBS', 'Una copia prima di ogni cambio di preset.', percorsi?.backupDir],
              ['Log', 'Un file al giorno con tutti i passaggi: utile per capire un problema.', cartellaLog],
            ] as const
          ).map(([titolo, descrizione, percorso]) => (
            <Riga
              key={titolo}
              titolo={titolo}
              descrizione={
                <>
                  {descrizione}
                  <span className="mt-0.5 block break-all font-mono text-[11px] text-zinc-600">{percorso}</span>
                </>
              }
            >
              <Pulsante icona={FolderOpen} disabled={!percorso} onClick={() => apri(percorso)}>
                Apri
              </Pulsante>
            </Riga>
          ))}
          <Riga
            titolo="Libreria dei take"
            descrizione={db ? `Database schema v${db.versioneSchema}, ${db.take} take registrati.` : 'Database non disponibile.'}
          />
        </Sezione>
      )}
    </Modale>
  );
}
