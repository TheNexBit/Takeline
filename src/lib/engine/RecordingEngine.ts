// Contratto del motore di registrazione video. OBS e' la prima (e per ora
// unica) implementazione: il resto dell'app parla solo con questa interfaccia,
// cosi' un motore diverso non tocca preset, transport e UI.

import type { EsitoBackup } from '../backend';
import type { ContestoNome } from '../naming';

export interface InfoMotore {
  motore: string;
  versioneMotore: string;
  versioneProtocollo: string;
  piattaforma: string;
}

export type StatoConnessione = 'disconnesso' | 'connessione' | 'connesso' | 'ricarico';

export interface SorgenteAudio {
  nome: string;
  tipo: string;
  muta: boolean;
}

export interface IstantaneaMotore {
  collezione: string;
  collezioni: string[];
  profilo: string;
  profili: string[];
  scena: string;
  scene: string[];
  registrazione: { attiva: boolean; inPausa: boolean; timecode: string };
  replayBuffer: { disponibile: boolean; attivo: boolean };
  diretta: boolean;
  cartellaRegistrazione: string;
  formatoNomeFile: string;
  sorgentiAudio: SorgenteAudio[];
  video: { fps: number; base: string; uscita: string } | null;
}

export type EventoMotore =
  | { tipo: 'connessione'; stato: StatoConnessione; motivo?: string }
  | { tipo: 'cambiato' }
  | { tipo: 'livelli'; picchiDb: Record<string, number> }
  | { tipo: 'registrazione'; attiva: boolean; file: string | null }
  | { tipo: 'replay'; attivo: boolean }
  | { tipo: 'replaySalvato'; file: string };

export interface StatoReplay {
  /** Il replay buffer e' abilitato nel profilo. */
  disponibile: boolean;
  attivo: boolean;
  /** Durata massima conservata. */
  secondiMax: number;
}

export interface StatisticheMotore {
  fps: number;
  cpu: number;
  renderSaltati: number;
  renderTotali: number;
  uscitaSaltati: number;
  uscitaTotali: number;
  discoLiberoMb: number;
}

export interface OpzioniCambio {
  /** Crea l'elemento se non esiste. */
  crea: boolean;
}

export interface RecordingEngine {
  readonly nome: string;
  readonly statoConnessione: StatoConnessione;
  /** Versioni lette all'ultima connessione riuscita. */
  readonly info: InfoMotore | null;

  connetti(): Promise<InfoMotore>;
  disconnetti(): Promise<void>;
  istantanea(): Promise<IstantaneaMotore>;
  /** Copia di sicurezza completa prima di modificare la configurazione. */
  backup(motivo: string): Promise<EsitoBackup>;

  /** Attende che il motore torni a rispondere dopo il ricaricamento. */
  cambiaCollezione(nome: string, opz: OpzioniCambio): Promise<void>;
  cambiaProfilo(nome: string, opz: OpzioniCambio): Promise<void>;
  cambiaScena(nome: string, opz: OpzioniCambio): Promise<'ok' | 'creata' | 'mancante'>;
  impostaCartella(percorso: string): Promise<void>;
  /** Restituisce il formato effettivamente impostato nel motore. */
  impostaNomeFile(template: string, ctx: ContestoNome): Promise<string>;

  /** Si risolve quando il file e' davvero aperto. */
  avviaRegistrazione(): Promise<void>;
  /** Restituisce il percorso del file chiuso. */
  fermaRegistrazione(): Promise<string | null>;

  statoReplay(): Promise<StatoReplay>;
  /** Imposta la durata e avvia il buffer se e' abilitato. */
  configuraReplay(secondi: number): Promise<StatoReplay>;
  avviaReplay(): Promise<void>;
  fermaReplay(): Promise<void>;
  /** Si risolve col percorso del file salvato. */
  salvaReplay(): Promise<string>;

  /** Indice (da 0) dello stream audio dei file registrati che contiene la sorgente. */
  flussoAudio(sorgente: string): Promise<{ indice: number; nota?: string }>;
  /** Statistiche correnti: fotogrammi saltati, CPU, spazio libero (MB). */
  statistiche(): Promise<StatisticheMotore>;
  /** Encoder di registrazione impostato ("" se sconosciuto). */
  encoder(): Promise<string>;
  /** Le registrazioni escono a frame rate costante? */
  controllaFrameRate(): Promise<{ ok: boolean; dettaglio: string }>;

  ascolta(listener: (e: EventoMotore) => void): () => void;
}
