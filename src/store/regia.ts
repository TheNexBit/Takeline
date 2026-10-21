// Collega la regia al resto: pedale MIDI, tastiera, scorciatoie globali e
// stage view. Lo stato del transport vive qui, separato dallo store principale.

import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { create } from 'zustand';

import { messaggioErrore } from '../lib/backend';
import { sbloccaAudio } from '../lib/clap';
import { log } from '../lib/log';
import { descriviMessaggio, Pedale, type MessaggioMidi, type StatoMidi } from '../lib/midi';
import { COMANDI, type Comando, type Impostazioni } from '../lib/model';
import { eseguiPreflight } from '../lib/preflight';
import { Regia, type StatoRegia } from '../lib/regia';
import { apriStage, canaleStage, type StatoStage } from '../lib/stage';
import { acceleratoreDa, inCampoDiTesto, stessoAcceleratore } from '../lib/tastiera';
import { ganciApplica, motore, useApp } from './app';

export type Vista = 'regia' | 'libreria' | 'patchbay';

interface StatoRegiaUi {
  regia: StatoRegia;
  midi: { stato: StatoMidi; dispositivi: string[]; ultimo: MessaggioMidi | null };
  vista: Vista;
  pedaleAperto: boolean;
  /** Promemoria di consenso in attesa di risposta. */
  consenso: { testo: string } | null;
}

const pedale = new Pedale();

const presetAttivo = () => {
  const { preset, impostazioni } = useApp.getState();
  return preset.find((p) => p.id === impostazioni.presetAttivo) ?? null;
};

export const regia = new Regia({
  motore,
  impostazioni: () => useApp.getState().impostazioni,
  preset: presetAttivo,
  aggiorna: (s) => useRegia.setState({ regia: s }),
  preflight: () =>
    eseguiPreflight({
      motore,
      preset: presetAttivo(),
      impostazioni: useApp.getState().impostazioni,
      pedale: { stato: pedale.stato, dispositivi: pedale.dispositivi },
      ffmpeg: useApp.getState().ffmpeg,
    }),
  // La finestra del consenso si apre nella finestra principale; si risolve con rispondiConsenso().
  chiediConsenso: (testo) =>
    new Promise<boolean>((risolvi) => {
      rispostaConsenso?.(false);
      rispostaConsenso = risolvi;
      useRegia.setState({ consenso: { testo } });
    }),
});

let rispostaConsenso: ((ok: boolean) => void) | null = null;

export function rispondiConsenso(ok: boolean) {
  rispostaConsenso?.(ok);
  rispostaConsenso = null;
  useRegia.setState({ consenso: null });
}

export const useRegia = create<StatoRegiaUi>(() => ({
  regia: regia.stato,
  midi: { stato: pedale.stato, dispositivi: [], ultimo: null },
  vista: 'regia',
  pedaleAperto: false,
  consenso: null,
}));

/** Durante l'apprendimento il pedale non deve far partire comandi. */
let apprendimento = false;
export const impostaApprendimento = (v: boolean) => {
  apprendimento = v;
};
export { pedale };

/** `sorgente` finisce nel log: pedale, tasto, pulsante, stage view. */
export function eseguiComando(c: Comando, sorgente = 'pulsante') {
  return regia.comando(c, sorgente);
}

// --- avvio --------------------------------------------------------------

let avviata = false;

export async function avviaRegia() {
  if (avviata) return;
  avviata = true;

  ganciApplica.prima = async (presetId) => {
    regia.sospendi(true);
    // Cambiare preset chiude la sessione del preset precedente (e la sua take continua).
    if (regia.stato.sessione && regia.stato.sessione.presetId !== presetId) await regia.fineSessione('cambio di preset');
  };
  ganciApplica.dopo = () => regia.sospendi(false);

  pedale.quandoCambia(() => {
    log.info('midi', "stato " + pedale.stato + ", dispositivi: " + (pedale.dispositivi.join(', ') || 'nessuno'));
    useRegia.setState((s) => ({ midi: { ...s.midi, stato: pedale.stato, dispositivi: [...pedale.dispositivi] } }));
  });
  pedale.ascolta((m) => {
    useRegia.setState((s) => ({ midi: { ...s.midi, ultimo: m } }));
    if (apprendimento) {
      log.debug('midi', 'apprendimento: ' + descriviMessaggio(m));
      return;
    }
    const { mappa, dispositivo } = useApp.getState().impostazioni.pedale;
    const c = pedale.comandoPer(m, mappa, dispositivo);
    log.debug('midi', descriviMessaggio(m) + ' -> ' + (c ?? 'nessun comando'));
    if (c) void eseguiComando(c, 'pedale');
  });
  // Se c'e' gia' un pedale configurato il permesso e' stato dato: si ascolta subito.
  if (Object.keys(useApp.getState().impostazioni.pedale.mappa).length) void pedale.avvia();

  // Tastiera locale (ripiego): nella finestra principale e, tramite evento, dalla stage view.
  window.addEventListener('keydown', (e) => {
    const acc = acceleratoreDa(e);
    if (!acc || e.repeat) return;
    if ((e.target as HTMLElement | null)?.closest?.('[data-cattura-tasti]')) return;
    if (inCampoDiTesto(e) && !/^F\d/.test(acc.split('+').pop() ?? '')) return;
    const c = comandoDaTasto(acc);
    if (c) {
      e.preventDefault();
      void eseguiComando(c, 'tasto ' + acc);
    }
  });
  canaleStage.suTasto((acc) => {
    const c = comandoDaTasto(acc);
    if (c) void eseguiComando(c, 'tasto ' + acc + ' (stage view)');
  });
  window.addEventListener('pointerdown', sbloccaAudio, { once: true });
  window.addEventListener('keydown', sbloccaAudio, { once: true });

  await regia.inizializza().catch((e) => useApp.getState().avvisa('errore', messaggioErrore(e)));
  await aggiornaScorciatoieGlobali(useApp.getState().impostazioni);

  // Stage view: riceve lo stato a ogni cambiamento e quando si apre.
  canaleStage.suPronta(() => canaleStage.inviaStato(statoStage()));
  let ultimo = '';
  const pubblica = () => {
    const s = statoStage();
    const json = JSON.stringify(s);
    if (json !== ultimo) {
      ultimo = json;
      canaleStage.inviaStato(s);
    }
  };
  useRegia.subscribe(pubblica);
  useApp.subscribe((s, prima) => {
    pubblica();
    if (s.impostazioni.tastiera !== prima.impostazioni.tastiera) void aggiornaScorciatoieGlobali(s.impostazioni);
    if (s.impostazioni.scaletta !== prima.impostazioni.scaletta) regia.impostaScaletta(s.impostazioni.scaletta);
  });
}

function comandoDaTasto(acc: string): Comando | null {
  const { mappa } = useApp.getState().impostazioni.tastiera;
  return COMANDI.find(({ id }) => stessoAcceleratore(mappa[id], acc))?.id ?? null;
}

const anteprima = () => (window as { __TAKELINE_ANTEPRIMA__?: boolean }).__TAKELINE_ANTEPRIMA__ === true;

/** Con "globali" i tasti funzionano anche con Reaper o OBS in primo piano. */
async function aggiornaScorciatoieGlobali(imp: Impostazioni) {
  if (anteprima()) return;
  try {
    await unregisterAll();
    if (!imp.tastiera.globali) return;
    for (const { id } of COMANDI) {
      const acc = imp.tastiera.mappa[id];
      if (!acc) continue;
      await register(acc, (e) => {
        if (e.state === 'Pressed') void eseguiComando(id, 'tasto globale ' + acc);
      });
    }
  } catch (e) {
    useApp.getState().avvisa('errore', `Scorciatoie globali non registrate: ${messaggioErrore(e)}`);
  }
}

export async function apriStageView() {
  try {
    useApp.getState().avvisa('info', await apriStage());
  } catch (e) {
    useApp.getState().avvisa('errore', messaggioErrore(e));
  }
}

// --- stato per la stage view ---------------------------------------------

export function statoStage(): StatoStage {
  const { regia: r, midi } = useRegia.getState();
  const app = useApp.getState();
  const p = presetAttivo();
  const { voci, indice } = r.scaletta;
  const nomePedale = midi.stato === 'pronto' ? (app.impostazioni.pedale.dispositivo || midi.dispositivi[0] || null) : null;
  return {
    fase: r.fase,
    preset: p?.nome ?? '',
    titolo: app.impostazioni.titolo,
    take: r.corrente?.take.numero ?? r.takes.at(-1)?.numero ?? null,
    inizioMs: r.corrente?.inizioMs ?? null,
    sessioneAttiva: r.sessione !== null,
    reaperRegistra: app.reaper.stato?.stato === 5,
    sezione: indice >= 0 ? (voci[indice] ?? `Capitolo ${indice + 1}`) : null,
    prossima: voci[indice + 1] ?? null,
    sezioneNumero: indice + 1,
    sezioniTotali: voci.length,
    ultimoMarker: r.ultimoMarker,
    replay: r.replay,
    messaggio: r.messaggio,
    flash: r.flash,
    obsConnesso: app.obs.stato === 'connesso',
    pedale: nomePedale,
    allarme: r.allarme,
  };
}

