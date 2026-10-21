import { create } from 'zustand';

import { applicaPreset, type CampoObs, type RapportoApplicazione } from '../lib/applicaPreset';
import {
  backend,
  messaggioErrore,
  type InfoFfmpeg,
  type PercorsiApp,
  type ReaperStato,
  type SpazioDisco,
} from '../lib/backend';
import { ObsEngine } from '../lib/engine/ObsEngine';
import type { InfoMotore, IstantaneaMotore, RecordingEngine, StatoConnessione } from '../lib/engine/RecordingEngine';
import {
  IMPOSTAZIONI_PREDEFINITE,
  normalizzaFilePreset,
  normalizzaImpostazioni,
  presetPredefiniti,
  slug,
  type Impostazioni,
  type Preset,
  type TipoPreset,
} from '../lib/model';
import { log } from '../lib/log';
import { risolviCartella } from '../lib/naming';

export interface NuovoPreset {
  nome: string;
  tipo: TipoPreset;
  /** Da dove prendere le impostazioni iniziali. */
  origine: 'vuoto' | 'copia' | 'obs';
  copiaDa?: string;
}

/** Per un preset importato con lo stesso nome di uno esistente. */
export type AzioneImportazione = 'sostituisci' | 'entrambi' | 'salta';

function idUnico(lista: Preset[], nome: string) {
  const ids = new Set(lista.map((p) => p.id));
  let id = slug(nome);
  for (let n = 2; ids.has(id); n++) id = `${slug(nome)}-${n}`;
  return id;
}

function nomeUnico(lista: Preset[], nome: string) {
  const nomi = new Set(lista.map((p) => p.nome.toLowerCase()));
  let n = nome;
  for (let i = 2; nomi.has(n.toLowerCase()); i++) n = `${nome} ${i}`;
  return n;
}

export type TipoAvviso = 'info' | 'ok' | 'avviso' | 'errore';
export interface Avviso {
  id: number;
  tipo: TipoAvviso;
  testo: string;
}

interface StatoApp {
  pronto: boolean;
  erroreAvvio: string | null;
  percorsi: PercorsiApp | null;
  impostazioni: Impostazioni;

  preset: Preset[];
  /** Il file dei preset non e' leggibile: niente modifiche finche' non si sistema. */
  presetErrore: string | null;
  presetAvvisi: string[];
  inModifica: string | null;
  impostazioniAperte: boolean;

  obs: { stato: StatoConnessione; motivo?: string; info: InfoMotore | null; ist: IstantaneaMotore | null };
  reaper: { stato: ReaperStato | null; errore: string | null };
  disco: SpazioDisco | null;
  ffmpeg: InfoFfmpeg | null;

  rapporto: RapportoApplicazione | null;
  applicando: boolean;
  avvisi: Avviso[];

  avvia(): Promise<void>;
  connettiObs(): Promise<void>;
  disconnettiObs(): Promise<void>;
  aggiornaObs(): Promise<void>;
  salvaImpostazioni(imp: Impostazioni): Promise<void>;
  impostaTitolo(titolo: string): void;
  ricaricaPreset(): Promise<void>;
  salvaPreset(p: Preset): Promise<void>;
  duplicaPreset(id: string): Promise<void>;
  /** Restituisce l'id del preset creato. */
  creaPreset(dati: NuovoPreset): Promise<string>;
  spostaPreset(id: string, verso: -1 | 1): Promise<void>;
  /** Rifiuta il preset attivo. */
  eliminaPreset(id: string): Promise<void>;
  esportaPreset(id: string, percorso: string): Promise<void>;
  leggiImportazione(percorso: string): Promise<Preset[]>;
  aggiungiImportati(scelte: { preset: Preset; azione: AzioneImportazione }[]): Promise<void>;
  ripristinaPredefiniti(): Promise<void>;
  applica(id: string, creaMancanti?: boolean): Promise<void>;
  /** Sostituisce nel preset i nomi scelti (null = crealo in OBS) e riapplica. */
  applicaConScelte(id: string, scelte: Partial<Record<CampoObs, string | null>>): Promise<void>;
  /** Salva nel preset collezione, profilo e scena attivi in OBS e lo applica. */
  collegaAObs(id: string): Promise<void>;
  chiudiRapporto(): void;
  apriEditor(id: string | null): void;
  apriImpostazioni(aperte: boolean): void;
  avvisa(tipo: TipoAvviso, testo: string): void;
  chiudiAvviso(id: number): void;
}

/** Livelli audio separati: arrivano ~12 volte al secondo e non devono ridisegnare tutto. */
export const useLivelli = create<{ obs: Record<string, number> }>(() => ({ obs: {} }));

export const motore: RecordingEngine = new ObsEngine(() => useApp.getState().impostazioni.obs);

/**
 * Agganci della regia intorno all'applicazione di un preset (registrati da
 * store/regia.ts, che dipende da questo modulo e non viceversa).
 */
export const ganciApplica: {
  prima?: (presetId: string) => Promise<void>;
  dopo?: (riuscito: boolean) => void;
} = {};

let prossimoAvviso = 1;
let timerTitolo: ReturnType<typeof setTimeout> | undefined;

export const useApp = create<StatoApp>()((set, get) => {
  const scriviPreset = async (preset: Preset[]) => {
    if (get().presetErrore) throw new Error('Il file dei preset ha errori: sistemalo o ricaricalo prima di salvare.');
    await backend.salvaDoc('preset', { versione: 1, preset });
    set({ preset });
  };

  const misuraDisco = async () => {
    const { obs, preset, impostazioni } = get();
    const attivo = preset.find((p) => p.id === impostazioni.presetAttivo);
    const percorso =
      obs.ist?.cartellaRegistrazione ||
      (attivo ? risolviCartella(attivo.output.cartella, { preset: attivo.nome, quando: new Date() }) : '');
    if (!percorso) return set({ disco: null });
    set({ disco: await backend.spazioDisco(percorso).catch(() => null) });
  };

  const controllaFfmpeg = async () => set({ ffmpeg: await backend.ffmpeg(get().impostazioni.ffmpeg.percorso) });

  // Una sola richiesta alla volta, e "non risponde" solo dopo due errori di
  // fila: un attimo di lentezza di Reaper (es. mentre crea i file) non e' un guasto.
  let erroriReaper = 0;
  const interrogaReaper = async () => {
    const { reaper } = get().impostazioni;
    const prima = get().reaper.stato;
    try {
      const stato = await backend.reaperStato(reaper);
      if (erroriReaper >= 2 || !prima) log.info('reaper', 'raggiungibile');
      if (prima && prima.stato !== stato.stato) log.info('reaper', 'transport: ' + prima.stato + ' -> ' + stato.stato + ' a ' + stato.posizioneTesto);
      const armatePrima = prima?.tracce.filter((t) => t.armata).map((t) => t.numero).join(',');
      const armate = stato.tracce.filter((t) => t.armata).map((t) => t.numero).join(',');
      if (prima && armatePrima !== armate) log.info('reaper', 'tracce armate: [' + armatePrima + '] -> [' + armate + ']');
      erroriReaper = 0;
      set({ reaper: { stato, errore: null } });
    } catch (e) {
      erroriReaper++;
      if (erroriReaper === 2) log.errore('reaper', 'non risponde (due tentativi di fila)', e);
      if (erroriReaper >= 2) set({ reaper: { stato: null, errore: messaggioErrore(e) } });
    } finally {
      setTimeout(interrogaReaper, 1000);
    }
  };

  motore.ascolta((e) => {
    if (e.tipo === 'livelli') {
      useLivelli.setState({ obs: e.picchiDb });
    } else if (e.tipo === 'connessione') {
      set((s) => ({ obs: { ...s.obs, stato: e.stato, motivo: e.motivo, info: motore.info ?? s.obs.info } }));
      if (e.stato === 'connesso') void get().aggiornaObs();
      if (e.stato === 'disconnesso') useLivelli.setState({ obs: {} });
    } else {
      void get().aggiornaObs();
    }
  });

  return {
    pronto: false,
    erroreAvvio: null,
    percorsi: null,
    impostazioni: IMPOSTAZIONI_PREDEFINITE,
    preset: [],
    presetErrore: null,
    presetAvvisi: [],
    inModifica: null,
    impostazioniAperte: false,
    obs: { stato: 'disconnesso', info: null, ist: null },
    reaper: { stato: null, errore: null },
    disco: null,
    ffmpeg: null,
    rapporto: null,
    applicando: false,
    avvisi: [],

    async avvia() {
      try {
        const percorsi = await backend.percorsi();
        let impostazioni = IMPOSTAZIONI_PREDEFINITE;
        try {
          const raw = await backend.caricaDoc('impostazioni');
          impostazioni = normalizzaImpostazioni(raw);
          if (raw === null) await backend.salvaDoc('impostazioni', impostazioni);
        } catch (e) {
          get().avvisa('errore', `${messaggioErrore(e)} Uso le impostazioni predefinite.`);
        }
        set({ percorsi, impostazioni, pronto: true });
        log.info('app', 'finestra principale pronta, OBS ' + impostazioni.obs.url + ', Reaper ' + impostazioni.reaper.host + ':' + impostazioni.reaper.porta + ', bridge ' + (impostazioni.reaper.bridgeId || 'non configurato'));
        await get().ricaricaPreset();
      } catch (e) {
        set({ erroreAvvio: messaggioErrore(e), pronto: true });
        return;
      }

      void controllaFfmpeg();
      void interrogaReaper();
      setInterval(misuraDisco, 15000);
      if (get().impostazioni.obs.connettiAllAvvio) void get().connettiObs();
    },

    async connettiObs() {
      try {
        await motore.connetti();
      } catch {
        // Il motivo e' gia' nello stato di connessione; il motore riprova da solo.
      }
    },

    async disconnettiObs() {
      await motore.disconnetti();
      set({ obs: { stato: 'disconnesso', info: null, ist: null } });
    },

    async aggiornaObs() {
      if (motore.statoConnessione !== 'connesso') return;
      try {
        const ist = await motore.istantanea();
        set((s) => ({ obs: { ...s.obs, ist } }));
        void misuraDisco();
      } catch {
        // OBS sta ricaricando: arrivera' un altro evento a cambio finito.
      }
    },

    async salvaImpostazioni(imp) {
      log.info('app', 'impostazioni salvate');
      const prima = get().impostazioni;
      const impostazioni = normalizzaImpostazioni(imp);
      await backend.salvaDoc('impostazioni', impostazioni);
      set({ impostazioni });
      if (prima.ffmpeg.percorso !== impostazioni.ffmpeg.percorso) void controllaFfmpeg();
      if (prima.obs.url !== impostazioni.obs.url || prima.obs.password !== impostazioni.obs.password) {
        await motore.disconnetti();
        void get().connettiObs();
      }
    },

    impostaTitolo(titolo) {
      set((s) => ({ impostazioni: { ...s.impostazioni, titolo } }));
      clearTimeout(timerTitolo);
      timerTitolo = setTimeout(() => void backend.salvaDoc('impostazioni', get().impostazioni), 600);
    },

    async ricaricaPreset() {
      const video = get().percorsi?.videoDir ?? 'C:\\';
      try {
        const raw = await backend.caricaDoc('preset');
        if (raw === null) {
          const preset = presetPredefiniti(video);
          await backend.salvaDoc('preset', { versione: 1, preset });
          set({ preset, presetErrore: null, presetAvvisi: [] });
          return;
        }
        const { preset, avvisi } = normalizzaFilePreset(raw, video);
        set({ preset, presetErrore: null, presetAvvisi: avvisi });
      } catch (e) {
        set({ preset: [], presetErrore: messaggioErrore(e), presetAvvisi: [] });
      }
    },

    async salvaPreset(p) {
      const lista = get().preset;
      const i = lista.findIndex((x) => x.id === p.id);
      await scriviPreset(i < 0 ? [...lista, p] : lista.map((x, n) => (n === i ? p : x)));
      get().avvisa('ok', `Preset "${p.nome}" salvato.`);
    },

    async duplicaPreset(id) {
      const lista = get().preset;
      const orig = lista.find((p) => p.id === id);
      if (!orig) return;
      const nome = nomeUnico(lista, `${orig.nome} (copia)`);
      const copia: Preset = { ...structuredClone(orig), id: idUnico(lista, nome), nome };
      await scriviPreset([...lista, copia]);
      log.info('preset', `duplicato "${orig.nome}" in "${nome}"`);
      set({ inModifica: copia.id });
    },

    async creaPreset({ nome, tipo, origine, copiaDa }) {
      const lista = get().preset;
      let p: Preset;
      if (origine === 'copia') {
        const orig = lista.find((x) => x.id === copiaDa);
        if (!orig) throw new Error('Scegli il preset da copiare.');
        p = structuredClone(orig);
      } else {
        // Le impostazioni di partenza del tipo scelto, senza nomi di OBS inventati.
        p = presetPredefiniti(get().percorsi?.videoDir ?? 'C:\\').find((x) => x.tipo === tipo)!;
        p.descrizione = '';
        if (origine === 'obs') {
          const ist = get().obs.ist;
          if (!ist) throw new Error('OBS non è connesso: non posso leggerne la configurazione.');
          p.obs = { ...p.obs, sceneCollection: ist.collezione, profilo: ist.profilo, scena: ist.scena };
        }
      }
      p.nome = nome.trim();
      p.id = idUnico(lista, p.nome);
      await scriviPreset([...lista, p]);
      log.info('preset', `creato "${p.nome}" (${origine === 'copia' ? `copia di ${copiaDa}` : `${tipo}, da ${origine}`})`);
      return p.id;
    },

    async spostaPreset(id, verso) {
      const lista = [...get().preset];
      const i = lista.findIndex((p) => p.id === id);
      const j = i + verso;
      if (i < 0 || j < 0 || j >= lista.length) return;
      [lista[i], lista[j]] = [lista[j], lista[i]];
      await scriviPreset(lista);
    },

    async eliminaPreset(id) {
      const p = get().preset.find((x) => x.id === id);
      if (!p) return;
      if (get().impostazioni.presetAttivo === id) {
        throw new Error(`"${p.nome}" è il preset attivo: applicane un altro prima di eliminarlo.`);
      }
      await scriviPreset(get().preset.filter((x) => x.id !== id));
      log.info('preset', `eliminato "${p.nome}"`);
      set((s) => ({ inModifica: s.inModifica === id ? null : s.inModifica }));
      get().avvisa('ok', `Preset "${p.nome}" eliminato. La versione precedente del file è in presets.json.bak.`);
    },

    async esportaPreset(id, percorso) {
      const p = get().preset.find((x) => x.id === id);
      if (!p) return;
      await backend.jsonEsporta(percorso, { versione: 1, preset: [p] });
      log.info('preset', `esportato "${p.nome}" in ${percorso}`);
      get().avvisa('ok', `Preset "${p.nome}" esportato.`);
    },

    async leggiImportazione(percorso) {
      const raw = await backend.jsonImporta(percorso);
      // Accetta un file di Takeline ({ preset: [...] }), un elenco o un preset singolo.
      const voci = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { preset?: unknown }).preset)
          ? (raw as { preset: unknown[] }).preset
          : [raw];
      const { preset, avvisi } = normalizzaFilePreset({ preset: voci }, get().percorsi?.videoDir ?? 'C:\\');
      if (!preset.length) throw new Error(`Nel file non ci sono preset validi. ${avvisi.join(' ')}`);
      return preset;
    },

    async aggiungiImportati(scelte) {
      let lista = [...get().preset];
      for (const { preset, azione } of scelte) {
        if (azione === 'salta') continue;
        const esistente = lista.find((x) => x.nome.toLowerCase() === preset.nome.toLowerCase());
        if (esistente && azione === 'sostituisci') {
          lista = lista.map((x) => (x.id === esistente.id ? { ...structuredClone(preset), id: esistente.id } : x));
        } else {
          const nome = esistente ? nomeUnico(lista, `${preset.nome} (importato)`) : preset.nome;
          lista.push({ ...structuredClone(preset), nome, id: idUnico(lista, nome) });
        }
      }
      await scriviPreset(lista);
      const n = scelte.filter((s) => s.azione !== 'salta').length;
      log.info('preset', `importati ${n} preset`);
      get().avvisa('ok', `${n} preset importat${n === 1 ? 'o' : 'i'}.`);
    },

    async ripristinaPredefiniti() {
      // Il file precedente resta in presets.json.bak (scrittura atomica lato Rust).
      const preset = presetPredefiniti(get().percorsi?.videoDir ?? 'C:\\');
      await backend.salvaDoc('preset', { versione: 1, preset });
      set({ preset, presetErrore: null, presetAvvisi: [] });
      get().avvisa('ok', 'Preset predefiniti ripristinati. Il file precedente è in presets.json.bak.');
    },

    async applica(id, creaMancanti = false) {
      const preset = get().preset.find((p) => p.id === id);
      if (!preset || get().applicando) return;
      set({ applicando: true });
      let riuscito = false;
      try {
        await ganciApplica.prima?.(id);
        const { impostazioni } = get();
        const r = await applicaPreset(
          motore,
          preset,
          { creaMancanti, titolo: impostazioni.titolo, reaper: impostazioni.reaper },
          (rapporto) => set({ rapporto }),
        );
        riuscito = r.riuscito;
        for (const p of r.passi) log.info('preset', '  ' + p.etichetta + ': ' + p.esito + (p.dettaglio ? ' - ' + p.dettaglio : ''));
        log.info('preset', '"' + preset.nome + '" ' + (r.riuscito ? 'applicato' : 'NON applicato') + (creaMancanti ? ' (con creazione)' : ''));
        if (r.riuscito) {
          await get().salvaImpostazioni({ ...get().impostazioni, presetAttivo: id });
          get().avvisa('ok', `Preset "${preset.nome}" applicato.`);
        }
      } catch (e) {
        get().avvisa('errore', messaggioErrore(e));
      } finally {
        set({ applicando: false });
        ganciApplica.dopo?.(riuscito);
        void get().aggiornaObs();
      }
    },

    async applicaConScelte(id, scelte) {
      const preset = get().preset.find((p) => p.id === id);
      if (!preset) return;
      const p = structuredClone(preset);
      let crea = false;
      for (const [campo, valore] of Object.entries(scelte) as [CampoObs, string | null][]) {
        if (valore === null) crea = true;
        else p.obs[campo] = valore;
      }
      try {
        if (JSON.stringify(p) !== JSON.stringify(preset)) await get().salvaPreset(p);
      } catch (e) {
        return get().avvisa('errore', messaggioErrore(e));
      }
      await get().applica(id, crea);
    },

    async collegaAObs(id) {
      const preset = get().preset.find((p) => p.id === id);
      const ist = get().obs.ist;
      if (!preset || !ist) return;
      const p = structuredClone(preset);
      p.obs.sceneCollection = ist.collezione;
      p.obs.profilo = ist.profilo;
      p.obs.scena = ist.scena;
      try {
        await get().salvaPreset(p);
      } catch (e) {
        return get().avvisa('errore', messaggioErrore(e));
      }
      await get().applica(id);
    },

    chiudiRapporto: () => set({ rapporto: null }),
    apriEditor: (inModifica) => set({ inModifica }),
    apriImpostazioni: (impostazioniAperte) => set({ impostazioniAperte }),

    avvisa(tipo, testo) {
      const id = prossimoAvviso++;
      set((s) => ({ avvisi: [...s.avvisi.slice(-3), { id, tipo, testo }] }));
      setTimeout(() => get().chiudiAvviso(id), tipo === 'errore' ? 9000 : 5000);
    },

    chiudiAvviso: (id) => set((s) => ({ avvisi: s.avvisi.filter((a) => a.id !== id) })),
  };
});

