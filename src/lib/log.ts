// Log dell'app: tutto finisce nel file giornaliero scritto dal backend
// (<config>\log\takeline-AAAA-MM-GG.log). Le righe si accumulano e partono a
// gruppi, cosi' anche una raffica di messaggi MIDI non rallenta nulla.

import { invoke } from '@tauri-apps/api/core';

import { messaggioErrore } from './backend';

type Livello = 'debug' | 'info' | 'avviso' | 'errore';

interface Voce {
  quando: number;
  livello: Livello;
  origine: string;
  testo: string;
}

let coda: Voce[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function svuota() {
  timer = null;
  if (!coda.length) return;
  const voci = coda;
  coda = [];
  invoke('log_scrivi', { voci }).catch(() => {
    // Il log non deve mai rompere l'app.
  });
}

function scrivi(livello: Livello, origine: string, testo: string) {
  coda.push({ quando: Date.now(), livello, origine, testo });
  if (livello === 'errore') console.error(`[${origine}] ${testo}`);
  if (coda.length > 200) svuota();
  else timer ??= setTimeout(svuota, 400);
}

export const log = {
  debug: (origine: string, testo: string) => scrivi('debug', origine, testo),
  info: (origine: string, testo: string) => scrivi('info', origine, testo),
  avviso: (origine: string, testo: string) => scrivi('avviso', origine, testo),
  errore: (origine: string, testo: string, e?: unknown) =>
    scrivi('errore', origine, e === undefined ? testo : `${testo}: ${messaggioErrore(e)}`),
};

/** Misura la durata di un passo e la scrive insieme all'esito. */
export async function misura<T>(origine: string, passo: string, f: () => Promise<T>): Promise<T> {
  const inizio = performance.now();
  try {
    const v = await f();
    log.info(origine, `${passo}: ok (${Math.round(performance.now() - inizio)} ms)`);
    return v;
  } catch (e) {
    log.errore(origine, `${passo}: fallito dopo ${Math.round(performance.now() - inizio)} ms`, e);
    throw e;
  }
}

/** Errori non gestiti e chiusura della finestra: anche questi nel log. */
export function intercettaErrori(finestra: string) {
  window.addEventListener('error', (e) => log.errore('js', `${finestra}: ${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => log.errore('js', `${finestra}: promessa rifiutata`, e.reason));
  window.addEventListener('beforeunload', svuota);
}
