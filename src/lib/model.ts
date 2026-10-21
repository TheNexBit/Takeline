// Schema di preset e impostazioni. I file JSON stanno nella cartella di
// configurazione e si possono modificare a mano: tutto quello che arriva dal
// disco passa da `normalizza`, che completa i campi mancanti e scarta i
// valori del tipo sbagliato senza perdere il resto.

export type TipoPreset = 'musicale' | 'formazione' | 'call';

/**
 * - `take-continua`: Reaper registra una sola take lunga, ogni take e' una region.
 * - `start-stop`: Reaper parte e si ferma insieme a OBS.
 * - `disattivato`: Reaper non viene toccato.
 */
export type ModalitaReaper = 'take-continua' | 'start-stop' | 'disattivato';

/**
 * Segni nel progetto di Reaper. Sono solo un aiuto visivo: le posizioni dei
 * take stanno nel database di Takeline, quindi cancellarli non rompe niente.
 */
export type SegniReaper = 'niente' | 'region' | 'tutto';

export type CambioProgetto = 'nuova-sessione' | 'continua';

export interface Preset {
  id: string;
  nome: string;
  tipo: TipoPreset;
  descrizione: string;
  obs: {
    /** Stringa vuota = lascia quella attiva. */
    sceneCollection: string;
    profilo: string;
    scena: string;
    /** Sorgente audio di OBS con il monitor out dell'interfaccia, usata solo per il sync. */
    tracciaGuida: string;
  };
  output: {
    /** Accetta {preset} e {data}. */
    cartella: string;
    /** Accetta {preset} {data} {ora} {take} {titolo}. */
    templateNome: string;
  };
  reaper: {
    modalita: ModalitaReaper;
    /** Solo se in Reaper non c'e' nessuna traccia armata: allora le arma tutte. */
    armaTracce: boolean;
    tornaAllInizio: boolean;
    /** Cosa scrivere nel progetto di Reaper. Serve lo script bridge: senza, niente. */
    segni: SegniReaper;
  };
  transport: {
    /** Flash a schermo e click audio all'avvio di ogni take, riferimento per il sync. */
    clap: boolean;
    /** Tiene sempre attivo il replay buffer di OBS. */
    replayBuffer: boolean;
    /** Minuti che il replay buffer conserva (RecRBTime del profilo OBS). */
    replayMinuti: number;
  };
  sync: {
    /** Misura offset e drift da solo appena Reaper si ferma. */
    automatico: boolean;
    /** Dopo la misura crea MP4 e WAV allineati accanto al video. */
    esporta: boolean;
  };
  post: {
    remuxMp4: boolean;
    separaTracce: boolean;
    normalizza: boolean;
    lufs: number;
    export: string[];
    /** Capitoli YouTube ed EDL dai marker del take. */
    marker: boolean;
  };
  consenso: {
    attivo: boolean;
    testo: string;
  };
}

export interface FilePreset {
  versione: 1;
  preset: Preset[];
}

export interface Impostazioni {
  versione: 1;
  obs: {
    url: string;
    password: string;
    /** Vuota = %APPDATA%\obs-studio. */
    cartellaConfig: string;
    timeoutRicaricoSec: number;
    connettiAllAvvio: boolean;
  };
  reaper: {
    host: string;
    porta: number;
    utente: string;
    password: string;
    /** Command ID (_RS...) dello script Takeline bridge: vuoto = solo marker senza nome. */
    bridgeId: string;
    /** Cartella risorse di Reaper; vuota = %APPDATA%\REAPER. */
    cartellaRisorse: string;
    /** Cosa fare se tra una take e l'altra in Reaper si apre un altro progetto. */
    cambioProgetto: CambioProgetto;
  };
  ffmpeg: {
    /** Vuoto = ffmpeg dal PATH. */
    percorso: string;
  };
  pedale: {
    /** Nome del dispositivo MIDI da ascoltare; vuoto = tutti. */
    dispositivo: string;
    mappa: Partial<Record<Comando, TriggerMidi>>;
  };
  tastiera: {
    /** Scorciatoie attive anche quando Takeline non e' in primo piano. */
    globali: boolean;
    /** Acceleratori nel formato di Tauri, es. "F9" o "Shift+F9". Vuoto = nessuno. */
    mappa: Record<Comando, string>;
  };
  archivio: {
    /** Ultima cartella usata per archiviare i take. */
    cartella: string;
  };
  sicurezza: {
    /** Prima di ogni take: con un errore la take non parte. */
    preflight: boolean;
    /** Durante la take: sorveglia OBS, disco, fotogrammi e Reaper. */
    watchdog: boolean;
    /** Sotto questo spazio libero la take si ferma (e il pre-flight blocca). */
    discoMinimoGb: number;
    /** Oltre questa percentuale di fotogrammi persi la take si ferma. */
    framePersiMax: number;
  };
  /** Sezioni della scaletta, una per capitolo. */
  scaletta: string[];
  /** Id del preset applicato per ultimo. */
  presetAttivo: string;
  /** Valore di {titolo} nei nomi dei file. */
  titolo: string;
}

/** Comandi del transport: pedale, tastiera e pulsanti chiamano questi. */
export type Comando = 'avviaFerma' | 'salvaReplay' | 'buono' | 'taglia' | 'capitolo' | 'scarta';

export const COMANDI: { id: Comando; etichetta: string; breve: string }[] = [
  { id: 'avviaFerma', etichetta: 'Avvia / ferma take', breve: 'REC' },
  { id: 'salvaReplay', etichetta: 'Salva replay buffer', breve: 'Replay' },
  { id: 'buono', etichetta: 'Marca take buono', breve: 'Buono' },
  { id: 'taglia', etichetta: 'Marca da tagliare', breve: 'Taglia' },
  { id: 'capitolo', etichetta: 'Nuovo capitolo', breve: 'Capitolo' },
  { id: 'scarta', etichetta: 'Scarta ultimo take', breve: 'Scarta' },
];

/**
 * Messaggio MIDI che fa scattare un comando. `scatto`: pedale a scatto
 * (latching) che manda un valore diverso a ogni pressione, quindi ogni
 * messaggio conta; altrimenti conta solo la pressione (valore >= 64).
 */
export interface TriggerMidi {
  tipo: 'nota' | 'cc' | 'pc';
  canale: number;
  numero: number;
  scatto: boolean;
}

export const IMPOSTAZIONI_PREDEFINITE: Impostazioni = {
  versione: 1,
  obs: {
    url: 'ws://127.0.0.1:4455',
    password: '',
    cartellaConfig: '',
    timeoutRicaricoSec: 30,
    connettiAllAvvio: true,
  },
  reaper: { host: '127.0.0.1', porta: 8080, utente: '', password: '', bridgeId: '', cartellaRisorse: '', cambioProgetto: 'nuova-sessione' },
  ffmpeg: { percorso: '' },
  pedale: { dispositivo: '', mappa: {} },
  tastiera: {
    globali: false,
    mappa: {
      avviaFerma: 'F9',
      salvaReplay: 'F10',
      buono: 'F7',
      taglia: 'F8',
      capitolo: 'F6',
      scarta: 'Shift+F9',
    },
  },
  archivio: { cartella: '' },
  sicurezza: { preflight: true, watchdog: true, discoMinimoGb: 5, framePersiMax: 5 },
  scaletta: [],
  presetAttivo: '',
  titolo: '',
};

// I campi OBS partono vuoti (= quelli attivi): si collegano alla configurazione
// dell'utente la prima volta, senza creare nulla di inventato in OBS.
export function presetPredefiniti(cartellaVideo: string): Preset[] {
  const cartella = `${cartellaVideo}\\Takeline\\{preset}`;
  return [
    {
      id: 'video-musicale',
      nome: 'Video musicale',
      tipo: 'musicale',
      descrizione:
        'Chitarra in Reaper su una take continua, una region per take. OBS registra il video e la traccia guida.',
      obs: {
        sceneCollection: '',
        profilo: '',
        scena: '',
        tracciaGuida: '',
      },
      output: { cartella, templateNome: '{data}_{titolo}_take{take}' },
      reaper: { modalita: 'take-continua', armaTracce: true, tornaAllInizio: false, segni: 'tutto' },
      transport: { clap: true, replayBuffer: true, replayMinuti: 5 },
      sync: { automatico: true, esporta: true },
      post: { remuxMp4: true, separaTracce: true, normalizza: false, lufs: -14, export: ['youtube'], marker: true },
      consenso: { attivo: false, testo: '' },
    },
    {
      id: 'formazione',
      nome: 'Formazione',
      tipo: 'formazione',
      descrizione: 'Lezioni e corsi: scaletta a capitoli, Reaper e OBS partono e si fermano insieme.',
      obs: {
        sceneCollection: '',
        profilo: '',
        scena: '',
        tracciaGuida: '',
      },
      output: { cartella, templateNome: '{data}_{titolo}_{take}' },
      reaper: { modalita: 'start-stop', armaTracce: true, tornaAllInizio: true, segni: 'tutto' },
      transport: { clap: true, replayBuffer: false, replayMinuti: 5 },
      sync: { automatico: true, esporta: true },
      post: { remuxMp4: true, separaTracce: false, normalizza: true, lufs: -16, export: ['youtube'], marker: true },
      consenso: { attivo: false, testo: '' },
    },
    {
      id: 'call',
      nome: 'Call',
      tipo: 'call',
      descrizione: 'Riunioni e call registrate solo in OBS, con promemoria di consenso prima di partire.',
      obs: {
        sceneCollection: '',
        profilo: '',
        scena: '',
        tracciaGuida: '',
      },
      output: { cartella, templateNome: '{data}_{ora}_call_{titolo}' },
      reaper: { modalita: 'disattivato', armaTracce: false, tornaAllInizio: false, segni: 'niente' },
      transport: { clap: false, replayBuffer: false, replayMinuti: 5 },
      sync: { automatico: false, esporta: false },
      post: { remuxMp4: true, separaTracce: false, normalizza: true, lufs: -16, export: [], marker: true },
      consenso: {
        attivo: true,
        testo:
          'Questa chiamata verrà registrata. Prima di iniziare, chiedi a tutti i partecipanti se sono d’accordo e spiega a cosa servirà la registrazione.',
      },
    },
  ];
}

const TIPI: readonly TipoPreset[] = ['musicale', 'formazione', 'call'];
const MODALITA: readonly ModalitaReaper[] = ['take-continua', 'start-stop', 'disattivato'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Unisce `valore` ai default campo per campo, tenendo solo i tipi giusti. */
function unisci<T>(predefinito: T, valore: unknown): T {
  if (Array.isArray(predefinito)) {
    return (Array.isArray(valore) ? valore.filter((x) => typeof x === 'string') : predefinito) as T;
  }
  if (isObject(predefinito)) {
    const src = isObject(valore) ? valore : {};
    const out: Record<string, unknown> = {};
    for (const [k, d] of Object.entries(predefinito)) out[k] = unisci(d, src[k]);
    return out as T;
  }
  if (typeof valore === typeof predefinito && !(typeof valore === 'number' && !Number.isFinite(valore))) {
    return valore as T;
  }
  return predefinito;
}

export function normalizzaImpostazioni(v: unknown): Impostazioni {
  const imp = unisci(IMPOSTAZIONI_PREDEFINITE, v);
  imp.versione = 1;
  imp.obs.timeoutRicaricoSec = Math.min(120, Math.max(5, imp.obs.timeoutRicaricoSec));
  imp.sicurezza.discoMinimoGb = Math.min(500, Math.max(1, imp.sicurezza.discoMinimoGb));
  imp.sicurezza.framePersiMax = Math.min(50, Math.max(0.5, imp.sicurezza.framePersiMax));
  if (!['nuova-sessione', 'continua'].includes(imp.reaper.cambioProgetto)) imp.reaper.cambioProgetto = 'nuova-sessione';
  // La mappa del pedale non ha chiavi predefinite: unisci() la svuoterebbe.
  imp.pedale.mappa = normalizzaMappaPedale(isObject(v) && isObject(v.pedale) ? v.pedale.mappa : undefined);
  imp.scaletta = imp.scaletta.map((x) => x.trim()).filter(Boolean);
  return imp;
}

function normalizzaMappaPedale(v: unknown): Partial<Record<Comando, TriggerMidi>> {
  const out: Partial<Record<Comando, TriggerMidi>> = {};
  if (!isObject(v)) return out;
  for (const { id } of COMANDI) {
    const t = v[id];
    if (!isObject(t) || !['nota', 'cc', 'pc'].includes(t.tipo as string)) continue;
    const n = (x: unknown, max: number) => (typeof x === 'number' && x >= 0 && x <= max ? Math.round(x) : null);
    const canale = n(t.canale, 15);
    const numero = n(t.numero, 127);
    if (canale === null || numero === null) continue;
    out[id] = { tipo: t.tipo as TriggerMidi['tipo'], canale, numero, scatto: t.scatto === true };
  }
  return out;
}

/** Restituisce i preset validi e un avviso per ogni voce scartata o corretta. */
export function normalizzaFilePreset(v: unknown, cartellaVideo: string): { preset: Preset[]; avvisi: string[] } {
  const avvisi: string[] = [];
  const voci = isObject(v) && Array.isArray(v.preset) ? v.preset : null;
  if (!voci) {
    avvisi.push('Il file non contiene la lista "preset": uso i predefiniti (il file non viene toccato).');
    return { preset: presetPredefiniti(cartellaVideo), avvisi };
  }
  const base = presetPredefiniti(cartellaVideo)[0];
  const visti = new Set<string>();
  const preset: Preset[] = [];
  voci.forEach((raw, i) => {
    if (!isObject(raw) || typeof raw.nome !== 'string' || !raw.nome.trim()) {
      avvisi.push(`Voce ${i + 1} ignorata: manca "nome".`);
      return;
    }
    const p = unisci(base, raw);
    if (!TIPI.includes(p.tipo)) {
      avvisi.push(`"${p.nome}": tipo "${String(raw.tipo)}" sconosciuto, uso "musicale".`);
      p.tipo = 'musicale';
    }
    if (!MODALITA.includes(p.reaper.modalita)) p.reaper.modalita = 'start-stop';
    if (!['niente', 'region', 'tutto'].includes(p.reaper.segni)) p.reaper.segni = 'tutto';
    p.transport.replayMinuti = Math.min(60, Math.max(1, p.transport.replayMinuti));
    if (!p.id.trim() || typeof raw.id !== 'string') p.id = slug(p.nome);
    while (visti.has(p.id)) p.id = `${p.id}-2`;
    visti.add(p.id);
    preset.push(p);
  });
  return { preset, avvisi };
}

export function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'preset'
  );
}

export const ETICHETTA_TIPO: Record<TipoPreset, string> = {
  musicale: 'Video musicale',
  formazione: 'Formazione',
  call: 'Call',
};

export const ETICHETTA_SEGNI: Record<SegniReaper, string> = {
  niente: 'Niente',
  region: 'Solo le region dei take',
  tutto: 'Region e marker',
};

export const ETICHETTA_MODALITA: Record<ModalitaReaper, string> = {
  'take-continua': 'Take continua con region',
  'start-stop': 'Start/stop con OBS',
  disattivato: 'Non usato',
};
