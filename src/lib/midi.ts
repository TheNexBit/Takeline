// Pedale MIDI via WebMIDI. Ascolta tutti gli ingressi (o solo quello scelto),
// traduce i messaggi e li confronta con le associazioni comando -> trigger.

import { log } from './log';
import { COMANDI, type Comando, type TriggerMidi } from './model';

export interface MessaggioMidi {
  dispositivo: string;
  tipo: TriggerMidi['tipo'];
  canale: number;
  numero: number;
  valore: number;
}

export type StatoMidi = 'inattivo' | 'richiesta' | 'pronto' | 'negato' | 'non-supportato';

export function descriviTrigger(t: TriggerMidi | undefined) {
  if (!t) return 'non assegnato';
  const tipo = t.tipo === 'nota' ? `Nota ${t.numero}` : t.tipo === 'cc' ? `CC ${t.numero}` : `Program ${t.numero}`;
  return `${tipo} · canale ${t.canale + 1}${t.tipo === 'cc' && t.scatto ? ' · a scatto' : ''}`;
}

export function descriviMessaggio(m: MessaggioMidi) {
  const tipo = m.tipo === 'nota' ? `Nota ${m.numero}` : m.tipo === 'cc' ? `CC ${m.numero}` : `Program ${m.numero}`;
  return `${tipo} = ${m.valore} · canale ${m.canale + 1} · ${m.dispositivo}`;
}

function traduci(dispositivo: string, d: Uint8Array): MessaggioMidi | null {
  if (d.length < 2) return null;
  const tipo = d[0] & 0xf0;
  const canale = d[0] & 0x0f;
  if (tipo === 0x90) return { dispositivo, tipo: 'nota', canale, numero: d[1], valore: d[2] ?? 0 };
  if (tipo === 0x80) return { dispositivo, tipo: 'nota', canale, numero: d[1], valore: 0 };
  if (tipo === 0xb0) return { dispositivo, tipo: 'cc', canale, numero: d[1], valore: d[2] ?? 0 };
  if (tipo === 0xc0) return { dispositivo, tipo: 'pc', canale, numero: d[1], valore: 127 };
  return null;
}

const stessoControllo = (t: Pick<TriggerMidi, 'tipo' | 'canale' | 'numero'>, m: MessaggioMidi) =>
  t.tipo === m.tipo && t.canale === m.canale && t.numero === m.numero;

/** Il messaggio corrisponde a una pressione del pedale associato? */
export function scatta(t: TriggerMidi, m: MessaggioMidi) {
  if (!stessoControllo(t, m)) return false;
  if (t.tipo === 'pc') return true;
  if (t.tipo === 'cc' && t.scatto) return true;
  return m.valore >= 64 || (t.tipo === 'nota' && m.valore > 0);
}

export class Pedale {
  stato: StatoMidi = 'inattivo';
  dispositivi: string[] = [];
  private accesso: MIDIAccess | null = null;
  private ascoltatori = new Set<(m: MessaggioMidi) => void>();
  private cambiamenti = new Set<() => void>();
  private ultimoScatto = new Map<Comando, number>();

  /** Chiede il permesso (la prima volta WebView2 mostra una richiesta). */
  async avvia() {
    if (this.accesso || this.stato === 'richiesta') return;
    if (!('requestMIDIAccess' in navigator)) {
      this.imposta('non-supportato');
      return;
    }
    this.imposta('richiesta');
    try {
      this.accesso = await navigator.requestMIDIAccess({ sysex: false });
      this.accesso.onstatechange = () => this.collega();
      this.collega();
      this.imposta('pronto');
    } catch {
      this.imposta('negato');
    }
  }

  private imposta(stato: StatoMidi) {
    this.stato = stato;
    for (const c of this.cambiamenti) c();
  }

  private collega() {
    if (!this.accesso) return;
    this.dispositivi = [];
    this.accesso.inputs.forEach((input) => {
      if (input.state !== 'connected') return;
      const nome = input.name ?? input.id;
      this.dispositivi.push(nome);
      input.onmidimessage = (ev) => {
        if (!ev.data) return;
        const m = traduci(nome, ev.data);
        if (m) for (const a of this.ascoltatori) a(m);
      };
    });
    for (const c of this.cambiamenti) c();
  }

  ascolta(f: (m: MessaggioMidi) => void) {
    this.ascoltatori.add(f);
    return () => void this.ascoltatori.delete(f);
  }

  quandoCambia(f: () => void) {
    this.cambiamenti.add(f);
    return () => void this.cambiamenti.delete(f);
  }

  /**
   * Comando da eseguire per questo messaggio. Antirimbalzo di 300 ms: alcuni
   * footswitch mandano raffiche di messaggi a ogni pressione.
   */
  comandoPer(m: MessaggioMidi, mappa: Partial<Record<Comando, TriggerMidi>>, dispositivo: string): Comando | null {
    if (dispositivo && m.dispositivo !== dispositivo) return null;
    for (const { id } of COMANDI) {
      const t = mappa[id];
      if (!t || !scatta(t, m)) continue;
      const ora = performance.now();
      const trascorsi = ora - (this.ultimoScatto.get(id) ?? 0);
      if (trascorsi < 300) {
        log.debug('midi', id + ' ignorato: ripetuto dopo ' + Math.round(trascorsi) + ' ms (antirimbalzo)');
        return null;
      }
      this.ultimoScatto.set(id, ora);
      return id;
    }
    return null;
  }

  /**
   * Apprendimento: aspetta la prossima pressione e capisce se il pedale e'
   * momentaneo (manda subito anche il rilascio) o a scatto.
   */
  impara(segnale: AbortSignal): Promise<TriggerMidi & { dispositivo: string }> {
    return new Promise((ok, ko) => {
      let primo: MessaggioMidi | null = null;
      let rilascio = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fine = () => {
        stacca();
        clearTimeout(timer);
      };
      segnale.addEventListener('abort', () => {
        fine();
        ko(new DOMException('Annullato', 'AbortError'));
      });
      const stacca = this.ascolta((m) => {
        if (!primo) {
          // Un rilascio isolato (valore 0) non e' una pressione.
          if (m.tipo !== 'pc' && m.valore === 0) return;
          primo = m;
          if (m.tipo !== 'cc') {
            fine();
            ok({ tipo: m.tipo, canale: m.canale, numero: m.numero, scatto: false, dispositivo: m.dispositivo });
            return;
          }
          timer = setTimeout(() => {
            fine();
            const p = primo!;
            ok({ tipo: p.tipo, canale: p.canale, numero: p.numero, scatto: !rilascio, dispositivo: p.dispositivo });
          }, 900);
        } else if (stessoControllo(primo, m) && m.valore < 64) {
          rilascio = true;
        }
      });
    });
  }
}
