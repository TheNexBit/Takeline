// Chiamate al backend Rust. Un'unica porta d'ingresso, tipizzata.

import { invoke } from '@tauri-apps/api/core';

export interface PercorsiApp {
  configDir: string;
  presetsFile: string;
  settingsFile: string;
  backupDir: string;
  dbFile: string;
  videoDir: string;
  obsConfigDir: string;
}

export interface ReaperConn {
  host: string;
  porta: number;
  utente: string;
  password: string;
}

export interface ReaperTraccia {
  numero: number;
  nome: string;
  armata: boolean;
  muta: boolean;
  solo: boolean;
  piccoDb: number;
}

export interface ReaperStato {
  /** 0 fermo, 1 play, 2 pausa, 5 registrazione, 6 registrazione in pausa. */
  stato: number;
  posizione: number;
  posizioneTesto: string;
  tracce: ReaperTraccia[];
}

export interface EsitoBackup {
  cartella: string;
  fileCopiati: number;
  cartellaObs: string;
}

/** Backtrack del plugin Aitum Vertical Canvas, letto dalla config di OBS. */
export interface BacktrackVerticale {
  installato: boolean;
  attivo: boolean;
  secondi: number;
}

export interface SpazioDisco {
  misuratoSu: string;
  libero: number;
  totale: number;
}

export interface ControlloCartella {
  creata: boolean;
  scrivibile: boolean;
  errore: string | null;
}

export interface InfoFfmpeg {
  trovato: boolean;
  /** ffprobe nella stessa cartella: senza, sync, capitoli e post non partono. */
  ffprobe: boolean;
  comando: string;
  versione: string | null;
  errore: string | null;
}

export interface InfoDb {
  percorso: string;
  versioneSchema: number;
  take: number;
}

export interface Sessione {
  id: number;
  presetId: string;
  titolo: string;
  iniziataIl: string;
  terminataIl: string | null;
  scaletta: string[];
}

export type StatoTake = 'registrato' | 'buono' | 'da_tagliare' | 'scartato' | 'pubblicato' | 'archiviato';

export interface Take {
  id: number;
  sessioneId: number;
  numero: number;
  tipo: 'take' | 'replay';
  stato: StatoTake;
  fileVideo: string | null;
  iniziatoIl: string;
  durataS: number | null;
  /** Posizione nella timeline di Reaper all'inizio del file video: l'offset tra i due mondi. */
  reaperInizioS: number | null;
  reaperFineS: number | null;
  clapS: number | null;
  marker: number;
  /** File audio di Reaper che contengono il take, uno per riga (null = non ancora chiesti). */
  fileAudio: string | null;
  /** Sync misurato: istante del WAV di Reaper a t=0 del video. */
  offsetS: number | null;
  /** Secondi di audio per secondo di video. */
  driftRatio: number | null;
  /** JSON con i dettagli (vedi InfoSync). */
  syncInfo: string | null;
}

export interface MisuraSync {
  tempoVideo: number;
  tempoAudio: number;
  confidenza: number;
}

export interface RisultatoSync {
  inizioAudio: number;
  rapporto: number;
  driftPpm: number;
  correzioneMs: number;
  misure: MisuraSync[];
  durataVideo: number;
  flussiAudioVideo: number;
  video: { fpsNominale: number; fpsMedio: number; fotogrammi: number; attesi: number; cfr: boolean } | null;
  avvisi: string[];
}

export type TipoLavoro = 'remux' | 'tracce' | 'loudnorm' | 'export' | 'proxy';
export type StatoLavoro = 'attesa' | 'in-corso' | 'fatto' | 'errore' | 'annullato';

export interface Lavoro {
  id: number;
  takeId: number | null;
  tipo: TipoLavoro;
  stato: StatoLavoro;
  parametri: Record<string, unknown>;
  progresso: number;
  /** File prodotti, uno per riga. */
  uscita: string | null;
  errore: string | null;
  creatoIl: string;
  iniziatoIl: string | null;
  finitoIl: string | null;
}

export interface FileTake {
  ruolo: string;
  percorso: string;
  byte: number;
  esiste: boolean;
}

export interface VoceLibreria {
  takeId: number;
  sessioneId: number;
  presetId: string;
  titolo: string;
  sessioneIl: string;
  numero: number;
  tipo: Take['tipo'];
  stato: StatoTake;
  iniziatoIl: string;
  durataS: number | null;
  sincronizzato: boolean;
  file: FileTake[];
  byte: number;
}

/** Salvato sul take (sync_info). */
export interface InfoSync extends RisultatoSync {
  fileAudio: string;
  flussoGuida: number;
  analizzatoIl: string;
  export?: { videoSync: string; audioSync: string; creatoIl: string };
}

export type TipoMarker = 'buono' | 'taglia' | 'capitolo' | 'clap';

export interface Marker {
  id: number;
  takeId: number | null;
  tipo: TipoMarker;
  tempoS: number;
  reaperS: number | null;
  etichetta: string;
}

/**
 * Action id nativi di Reaper. La region con nome non ha un'azione: la crea lo
 * script bridge (la spec indicava 40296, che in Reaper e' "seleziona tutte le tracce").
 */
export const AZIONI_REAPER = {
  registra: '1013',
  stop: '1016',
  play: '1007',
  vaiAllInizio: '40042',
  vaiAllaFine: '40043',
  armaTutte: '40490',
  disarmaTutte: '40491',
  inserisciMarker: '40157',
} as const;

export const backend = {
  percorsi: () => invoke<PercorsiApp>('app_paths'),
  caricaDoc: (nome: 'preset' | 'impostazioni') => invoke<unknown | null>('doc_load', { nome }),
  salvaDoc: (nome: 'preset' | 'impostazioni', valore: unknown) => invoke<void>('doc_save', { nome, valore }),
  jsonEsporta: (percorso: string, valore: unknown) => invoke<void>('json_esporta', { percorso, valore }),
  jsonImporta: (percorso: string) => invoke<unknown>('json_importa', { percorso }),
  backupObs: (istantanea: unknown, motivo: string, cartellaObs: string) =>
    invoke<EsitoBackup>('obs_backup', { istantanea, motivo, cartellaObs }),
  backtrackVerticale: (cartellaObs: string) => invoke<BacktrackVerticale>('obs_backtrack_verticale', { cartellaObs }),
  reaperStato: (conn: ReaperConn) => invoke<ReaperStato>('reaper_status', { conn }),
  reaperAzione: (conn: ReaperConn, azione: string) => invoke<void>('reaper_action', { conn, azione }),
  spazioDisco: (percorso: string) => invoke<SpazioDisco>('disk_space', { percorso }),
  assicuraCartella: (percorso: string) => invoke<ControlloCartella>('ensure_dir', { percorso }),
  ffmpeg: (percorso: string) => invoke<InfoFfmpeg>('ffmpeg_info', { percorso }),
  db: () => invoke<InfoDb>('db_info'),
  cartellaLog: () => invoke<string>('log_cartella'),
  fileRecenti: (cartella: string, dopoMs: number) =>
    invoke<{ percorso: string; modificatoMs: number; byte: number }[]>('file_recenti', { cartella, dopoMs }),

  reaperBridge: (conn: ReaperConn, comandoId: string, campi: (string | number)[]) =>
    invoke<string>('reaper_bridge', { conn, comandoId, campi: campi.map(String) }),
  installaBridge: (cartellaReaper: string) => invoke<string>('reaper_installa_bridge', { cartellaReaper }),
  /** Contrassegno di sessione nel progetto attivo di Reaper; con valore lo scrive. */
  reaperProgetto: (conn: ReaperConn, valore?: string) => invoke<string>('reaper_progetto', { conn, valore: valore ?? null }),

  sessioneApri: (presetId: string, titolo: string, scaletta: string[]) =>
    invoke<Sessione>('sessione_apri', { presetId, titolo, scaletta, iniziataIl: new Date().toISOString() }),
  sessioneChiudi: (id: number) => invoke<void>('sessione_chiudi', { id, terminataIl: new Date().toISOString() }),
  sessioneAperta: () => invoke<Sessione | null>('sessione_aperta'),
  sessioneTake: (sessioneId: number) => invoke<Take[]>('sessione_take', { sessioneId }),
  takeCrea: (sessioneId: number, tipo: Take['tipo'], iniziatoIl: Date, reaperInizioS: number | null, fileVideo: string | null) =>
    invoke<Take>('take_crea', { sessioneId, tipo, iniziatoIl: iniziatoIl.toISOString(), reaperInizioS, fileVideo }),
  takeChiudi: (id: number, fileVideo: string | null, durataS: number, reaperFineS: number | null) =>
    invoke<Take>('take_chiudi', { id, fileVideo, durataS, reaperFineS }),
  takeStato: (id: number, stato: StatoTake) => invoke<Take>('take_stato', { id, stato }),
  takeClap: (id: number, clapS: number) => invoke<void>('take_clap', { id, clapS }),
  takeAudio: (id: number, fileAudio: string) => invoke<Take>('take_audio', { id, fileAudio }),
  takeSync: (id: number, offsetS: number, driftRatio: number, syncInfo: InfoSync) =>
    invoke<Take>('take_sync', { id, offsetS, driftRatio, syncInfo: JSON.stringify(syncInfo) }),
  postAccoda: (takeId: number, tipo: TipoLavoro, parametri: Record<string, unknown>) =>
    invoke<Lavoro>('post_accoda', { takeId, tipo, parametri }),
  postElenco: () => invoke<Lavoro[]>('post_elenco'),
  postAnnulla: (id: number) => invoke<void>('post_annulla', { id }),
  postRiprova: (id: number) => invoke<void>('post_riprova', { id }),
  postPausa: (pausa: boolean) => invoke<void>('post_pausa', { pausa }),
  postPulisci: () => invoke<number>('post_pulisci'),
  fileRegistra: (takeId: number, ruolo: string, percorso: string) => invoke<void>('file_registra', { takeId, ruolo, percorso }),
  libreria: () => invoke<VoceLibreria[]>('libreria_take'),
  fileCestina: (takeId: number, percorsi: string[]) => invoke<number>('file_cestina', { takeId, percorsi }),
  takeArchivia: (takeId: number, cartella: string) => invoke<string[]>('take_archivia', { takeId, cartella }),
  takeCapitoli: (takeId: number) => invoke<{ file: string; testo: string; avvisi: string[] }>('take_capitoli', { takeId }),
  takeEdl: (takeId: number, ffmpeg: string) => invoke<string[]>('take_edl', { takeId, ffmpeg }),
  syncAnalizza: (richiesta: {
    ffmpeg: string;
    video: string;
    flussoGuida: number;
    audio: string;
    inizioStimato: number;
    margine?: number;
  }) =>
    invoke<RisultatoSync>('sync_analizza', { richiesta }),
  syncEsporta: (richiesta: { ffmpeg: string; video: string; audio: string; inizioAudio: number; rapporto: number }) =>
    invoke<{ videoSync: string; audioSync: string }>('sync_esporta', { richiesta }),
  markerAggiungi: (
    sessioneId: number,
    takeId: number | null,
    tipo: TipoMarker,
    tempoS: number,
    reaperS: number | null,
    etichetta: string,
  ) => invoke<Marker>('marker_aggiungi', { sessioneId, takeId, tipo, tempoS, reaperS, etichetta }),
};

export function messaggioErrore(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function formattaByte(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
}
