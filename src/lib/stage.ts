// Stage view: finestra separata, a tutto schermo sul secondo monitor. La
// finestra principale resta l'unica fonte di verita' e le invia lo stato; la
// stage view rimanda indietro solo i tasti premuti (tastiera di ripiego).

import { emit, listen } from '@tauri-apps/api/event';
import { availableMonitors, currentMonitor } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

import type { TipoMarker } from './backend';

export type LivelloMessaggio = 'info' | 'ok' | 'avviso' | 'errore';

export interface StatoStage {
  fase: 'fermo' | 'avvio' | 'registra' | 'arresto';
  preset: string;
  titolo: string;
  take: number | null;
  /** Epoch ms in cui OBS ha aperto il file: il timecode si calcola da qui. */
  inizioMs: number | null;
  sessioneAttiva: boolean;
  reaperRegistra: boolean;
  sezione: string | null;
  prossima: string | null;
  sezioneNumero: number;
  sezioniTotali: number;
  ultimoMarker: { tipo: TipoMarker; etichetta: string; tempoS: number } | null;
  replay: { disponibile: boolean; attivo: boolean; avviatoMs: number | null; secondiMax: number };
  messaggio: { testo: string; livello: LivelloMessaggio; quando: number } | null;
  /** Ogni incremento fa partire un flash a tutto schermo (clap). */
  flash: number;
  obsConnesso: boolean;
  pedale: string | null;
  /** Allarme del watchdog: resta visibile finche' dura. */
  allarme: { testo: string; livello: 'avviso' | 'errore' } | null;
}

const EVENTO_STATO = 'takeline://stage-stato';
const EVENTO_PRONTA = 'takeline://stage-pronta';
const EVENTO_TASTO = 'takeline://tasto';

/** Nell'anteprima nel browser non c'e' Tauri: si usa un BroadcastChannel. */
const anteprima = () => (window as { __TAKELINE_ANTEPRIMA__?: boolean }).__TAKELINE_ANTEPRIMA__ === true;
let canale: BroadcastChannel | null = null;
const bc = () => (canale ??= new BroadcastChannel('takeline'));

function invia(evento: string, payload: unknown) {
  if (anteprima()) bc().postMessage({ evento, payload });
  else void emit(evento, payload);
}

function ricevi<T>(evento: string, f: (p: T) => void): () => void {
  if (anteprima()) {
    const h = (e: MessageEvent) => e.data?.evento === evento && f(e.data.payload as T);
    bc().addEventListener('message', h);
    return () => bc().removeEventListener('message', h);
  }
  const stacca = listen<T>(evento, (e) => f(e.payload));
  return () => void stacca.then((s) => s());
}

export const canaleStage = {
  inviaStato: (s: StatoStage) => invia(EVENTO_STATO, s),
  suStato: (f: (s: StatoStage) => void) => ricevi(EVENTO_STATO, f),
  annunciaPronta: () => invia(EVENTO_PRONTA, null),
  suPronta: (f: () => void) => ricevi(EVENTO_PRONTA, f),
  /** La stage view non conosce le scorciatoie: manda il tasto, la finestra principale lo traduce. */
  inviaTasto: (acceleratore: string) => invia(EVENTO_TASTO, acceleratore),
  suTasto: (f: (acceleratore: string) => void) => ricevi<string>(EVENTO_TASTO, f),
};

/** Apre la stage view; con piu' monitor la mette a tutto schermo su quello libero. */
export async function apriStage(): Promise<string> {
  if (anteprima()) {
    window.open('/?vista=stage', 'takeline-stage', 'width=1280,height=720');
    return 'Stage view aperta in una nuova finestra del browser.';
  }
  const esistente = await WebviewWindow.getByLabel('stage');
  if (esistente) {
    await esistente.setFocus();
    return 'Stage view già aperta.';
  }
  const [monitor, mio] = await Promise.all([availableMonitors(), currentMonitor()]);
  const altro = monitor.find((m) => m.name !== mio?.name);

  const w = new WebviewWindow('stage', {
    url: 'index.html?vista=stage',
    title: 'Takeline · Stage',
    width: 1280,
    height: 720,
    focus: false,
    backgroundColor: '#000000',
  });
  await new Promise<void>((ok, ko) => {
    void w.once('tauri://created', () => ok());
    void w.once('tauri://error', (e) => ko(new Error(`Stage view non aperta: ${JSON.stringify(e.payload)}`)));
  });
  if (altro) {
    await w.setPosition(altro.position);
    await w.setFullscreen(true);
    return `Stage view a tutto schermo su ${altro.name ?? 'secondo monitor'}.`;
  }
  return 'Un solo monitor: stage view in finestra. F11 o doppio clic per il tutto schermo.';
}
