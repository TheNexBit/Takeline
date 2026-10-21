// Regia: il transport. Pedale, tastiera e pulsanti arrivano qui come comandi,
// eseguiti uno alla volta in ordine.
//
// Video musicale (take continua): Reaper registra una sola take lunga per
// tutta la sessione, OBS apre un file per ogni take; ogni take diventa una
// region con nome in Reaper. Il collegamento tra i due mondi e' la posizione
// di Reaper nell'istante in cui OBS apre il file, salvata sul take.
// Altri preset: Reaper (se usato) parte e si ferma insieme a OBS.

import {
  AZIONI_REAPER,
  backend,
  messaggioErrore,
  type InfoSync,
  type ReaperStato,
  type RisultatoSync,
  type Sessione,
  type Take,
  type TipoLavoro,
  type TipoMarker,
} from './backend';
import { suonaClick } from './clap';
import { log, misura } from './log';
import { primoErrore, type Controllo } from './preflight';
import type { EventoMotore, RecordingEngine, StatisticheMotore } from './engine/RecordingEngine';
import type { Comando, Impostazioni, Preset } from './model';
import type { LivelloMessaggio, StatoStage } from './stage';
import { formattaDurata, pad2 } from './tempo';

export type FaseRegia = StatoStage['fase'];

export interface StatoRegia {
  fase: FaseRegia;
  sessione: Sessione | null;
  takes: Take[];
  corrente: { take: Take; inizioMs: number } | null;
  /** indice -1 = scaletta non ancora iniziata. */
  scaletta: { voci: string[]; indice: number };
  ultimoMarker: StatoStage['ultimoMarker'];
  replay: StatoStage['replay'];
  messaggio: StatoStage['messaggio'];
  flash: number;
  /** Esito dell'ultimo uso dello script bridge di Reaper. */
  bridge: 'non-configurato' | 'ok' | 'errore';
  /** Take di cui si sta misurando il sync. */
  sincronizzando: number | null;
  /** Allarme del watchdog, fisso in stage view finche' dura. */
  allarme: { testo: string; livello: 'avviso' | 'errore' } | null;
  /** Esito dell'ultimo pre-flight. */
  preflight: { controlli: Controllo[]; quando: number } | null;
}

interface Dipendenze {
  motore: RecordingEngine;
  impostazioni(): Impostazioni;
  /** Il preset applicato, o null. */
  preset(): Preset | null;
  aggiorna(s: StatoRegia): void;
  /** Controlli prima del REC (vedi preflight.ts). */
  preflight?(): Promise<Controllo[]>;
  /** Promemoria di consenso: true se l'utente conferma. */
  chiediConsenso?(testo: string): Promise<boolean>;
}

type TipoColore = TipoMarker | 'take' | 'replay' | 'scartato';

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** WAV di Reaper che contiene il take e dove sta il suo item nel progetto. */
export interface SorgenteAudio {
  file: string;
  inizioItem: number | null;
  offset: number | null;
  velocita: number | null;
}

/**
 * file_audio sul take: JSON (versione attuale) o, dai take piu' vecchi, un
 * percorso per riga con le barre raddoppiate da Reaper.
 */
export function leggiSorgenti(testo: string | null): SorgenteAudio[] {
  if (!testo) return [];
  if (testo.startsWith('[')) {
    try {
      return JSON.parse(testo) as SorgenteAudio[];
    } catch {
      return [];
    }
  }
  return testo
    .split('\n')
    .filter(Boolean)
    .map((riga) => {
      const [file, inizio, offset, velocita] = riga.replace(/\\\\/g, '\\').split('*');
      const n = (x?: string) => (x === undefined || Number.isNaN(Number(x)) ? null : Number(x));
      return { file, inizioItem: n(inizio), offset: n(offset), velocita: n(velocita) };
    });
}

/** Sotto questa durata un secondo avvia/ferma viene ignorato. */
const DURATA_MINIMA_MS = 1000;

export class Regia {
  private s: StatoRegia = {
    fase: 'fermo',
    sessione: null,
    takes: [],
    corrente: null,
    scaletta: { voci: [], indice: -1 },
    ultimoMarker: null,
    replay: { disponibile: false, attivo: false, avviatoMs: null, secondiMax: 0 },
    messaggio: null,
    flash: 0,
    bridge: 'non-configurato',
    sincronizzando: null,
    allarme: null,
    preflight: null,
  };
  private coda: Promise<unknown> = Promise.resolve();
  private codaSync: Promise<unknown> = Promise.resolve();
  private inCodaSync = new Set<number>();
  /** Take gia' passati a sync e post-produzione automatici. */
  private lavorati = new Set<number>();
  /** Sessione per cui il consenso e' gia' stato confermato. */
  private consensoPer: number | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private basiStatistiche: StatisticheMotore | null = null;
  private attesaObs: ReturnType<typeof setTimeout> | null = null;
  private recuperoFatto = false;
  private sospesa = false;
  private timerReplay: ReturnType<typeof setTimeout> | null = null;

  constructor(private d: Dipendenze) {
    d.motore.ascolta((e) => this.suMotore(e));
  }

  get stato() {
    return this.s;
  }

  private set(p: Partial<StatoRegia>) {
    this.s = { ...this.s, ...p };
    this.d.aggiorna(this.s);
  }

  private messaggio(testo: string, livello: LivelloMessaggio) {
    this.set({ messaggio: { testo, livello, quando: Date.now() } });
    const scrivi = livello === 'errore' ? log.errore : livello === 'avviso' ? log.avviso : log.info;
    scrivi('stage', testo);
  }

  private fallito(e: unknown) {
    this.messaggio(messaggioErrore(e), 'errore');
  }

  /** Riassunto dello stato per le righe di log. */
  private get contesto() {
    const c = this.s.corrente;
    return `fase=${this.s.fase}${c ? ` take=${c.take.numero}` : ''} sessione=${this.s.sessione?.id ?? '-'}`;
  }

  /** Riprende una sessione rimasta aperta (app chiusa senza terminarla). */
  async inizializza() {
    const imp = this.d.impostazioni();
    this.set({ scaletta: { voci: imp.scaletta, indice: -1 } });
    const sessione = await backend.sessioneAperta();
    if (!sessione) return;
    const takes = await backend.sessioneTake(sessione.id);
    this.set({ sessione, takes, scaletta: { voci: sessione.scaletta.length ? sessione.scaletta : imp.scaletta, indice: -1 } });
  }

  /** Durante l'applicazione di un preset il replay non va riavviato. */
  sospendi(s: boolean) {
    this.sospesa = s;
    if (!s) void this.aggiornaReplay(true);
  }

  impostaScaletta(voci: string[]) {
    if (this.s.fase !== 'fermo') return;
    this.set({ scaletta: { voci, indice: Math.min(this.s.scaletta.indice, voci.length - 1) } });
  }

  /** Riporta la scaletta alla prima sezione (la prossima take riparte da li'). */
  ricominciaScaletta() {
    if (this.s.fase !== 'fermo') return;
    this.set({ scaletta: { ...this.s.scaletta, indice: -1 } });
  }

  /**
   * Accoda un comando: pedale e tastiera non aspettano, gli errori finiscono
   * in stage view. `sorgente` serve al log (pedale, tasto, pulsante...).
   */
  comando(c: Comando, sorgente = 'pulsante') {
    log.info('comando', `${c} da ${sorgente} (${this.contesto})`);
    this.coda = this.coda.then(() => this.esegui(c)).catch((e) => this.fallito(e));
    return this.coda;
  }

  avviaSessione() {
    log.info('comando', `avvia sessione da pulsante (${this.contesto})`);
    this.coda = this.coda.then(() => this.apriSessioneCompleta()).catch((e) => this.fallito(e));
    return this.coda;
  }

  fineSessione(motivo = 'pulsante') {
    log.info('comando', `fine sessione da ${motivo} (${this.contesto})`);
    this.coda = this.coda.then(() => this.chiudiSessione()).catch((e) => this.fallito(e));
    return this.coda;
  }

  private async esegui(c: Comando) {
    switch (c) {
      case 'avviaFerma': {
        const c = this.s.corrente;
        if (!c) return this.avviaTake();
        // Un doppio tocco (o un tasto che rimbalza) non deve chiudere la take appena aperta.
        const trascorsi = Date.now() - c.inizioMs;
        if (trascorsi < DURATA_MINIMA_MS) {
          log.avviso('regia', `arresto ignorato: la take ${c.take.numero} e' partita solo ${trascorsi} ms fa`);
          return;
        }
        return this.fermaTake();
      }
      case 'salvaReplay':
        return this.salvaReplay();
      case 'buono':
      case 'taglia':
        return this.marca(c);
      case 'capitolo':
        return this.nuovoCapitolo();
      case 'scarta':
        return this.scartaUltimo();
    }
  }

  // --- Reaper ------------------------------------------------------------

  private get conn() {
    return this.d.impostazioni().reaper;
  }

  private usaReaper(p: Preset | null): p is Preset {
    return !!p && p.reaper.modalita !== 'disattivato';
  }

  private async reaperStato() {
    try {
      return await backend.reaperStato(this.conn);
    } catch {
      return null;
    }
  }

  private async reaper(azione: string) {
    await backend.reaperAzione(this.conn, azione);
  }

  private async attendiReaper(stato: number, ms = 3000) {
    const inizio = Date.now();
    let ultimo: number | null = null;
    while (Date.now() - inizio < ms) {
      ultimo = (await this.reaperStato())?.stato ?? null;
      if (ultimo === stato) {
        log.info('regia', `Reaper nello stato ${stato} dopo ${Date.now() - inizio} ms`);
        return true;
      }
      await pausa(150);
    }
    log.errore('regia', `Reaper non e' arrivato allo stato ${stato} in ${ms} ms (ultimo stato letto: ${ultimo ?? 'nessuna risposta'})`);
    return false;
  }

  /**
   * Le tracce armate le sceglie l'utente in Reaper: Takeline non le tocca.
   * Solo se non ce n'e' nessuna (e il preset lo consente) le arma tutte, per
   * non registrare il vuoto.
   */
  private async avviaReaper(p: Preset, st: ReaperStato) {
    const armate = st.tracce.filter((t) => t.armata);
    log.info(
      'regia',
      `Reaper: ${armate.length}/${st.tracce.length} tracce armate [${armate.map((t) => `${t.numero} ${t.nome}`.trim()).join(', ')}]`,
    );
    if (armate.length === 0) {
      if (!p.reaper.armaTracce) throw new Error('In Reaper non c’è nessuna traccia armata: armane almeno una.');
      log.avviso('regia', 'nessuna traccia armata: le armo tutte (opzione del preset)');
      await this.reaper(AZIONI_REAPER.armaTutte);
    }
    // Fermandosi Reaper riporta il cursore dove era partito: senza questo ogni
    // registrazione finirebbe sopra la precedente. Si riparte dalla fine del progetto.
    if (p.reaper.modalita === 'start-stop' && p.reaper.tornaAllInizio) await this.reaper(AZIONI_REAPER.vaiAllInizio);
    else await this.reaper(AZIONI_REAPER.vaiAllaFine);
    await this.reaper(AZIONI_REAPER.registra);
    if (!(await this.attendiReaper(5))) {
      throw new Error('Reaper non è entrato in registrazione: controlla che ci siano tracce armate.');
    }
  }

  /** Comando allo script bridge; false se non configurato o se non risponde. */
  private async bridge(campi: (string | number)[]) {
    const id = this.conn.bridgeId.trim();
    if (!id) {
      if (this.s.bridge !== 'non-configurato') this.set({ bridge: 'non-configurato' });
      return false;
    }
    try {
      const esito = await backend.reaperBridge(this.conn, id, campi);
      log.info('bridge', `${campi.join(' | ')} -> ${esito}`);
      if (this.s.bridge !== 'ok') this.set({ bridge: 'ok' });
      return true;
    } catch (e) {
      log.errore('bridge', campi.join(' | '), e);
      if (this.s.bridge !== 'errore') this.set({ bridge: 'errore' });
      return false;
    }
  }

  // I segni in Reaper sono un aiuto visivo e li decide il preset. Le posizioni
  // vere stanno nel database: se l'utente li cancella non si rompe niente.
  // Senza script bridge non si scrive nulla (niente marker anonimi).

  private get segni() {
    return this.d.preset()?.reaper.segni ?? 'niente';
  }

  /** Marker con nome, solo con "Region e marker". */
  private async segnaReaper(tipo: TipoColore, nome: string, pos: number) {
    if (this.segni !== 'tutto') return;
    await this.bridge(['marker', pos.toFixed(3), nome, tipo]);
  }

  /** Region del take, con "Solo le region" o "Region e marker". */
  private async regionReaper(inizio: number, fine: number, nome: string, tipo: TipoColore) {
    if (this.segni === 'niente') return;
    log.info('regia', `region in Reaper: ${inizio.toFixed(3)} -> ${fine.toFixed(3)} s "${nome}"`);
    await this.bridge(['region', inizio.toFixed(3), fine.toFixed(3), nome, tipo]);
  }

  private nomeTake(t: Take) {
    const base = this.d.impostazioni().titolo.trim() || this.d.preset()?.nome || 'Takeline';
    return `${base} · ${t.tipo === 'replay' ? 'replay' : 'take'} ${pad2(t.numero)}`;
  }

  // --- sessione ----------------------------------------------------------

  private async apriSessione(p: Preset) {
    const imp = this.d.impostazioni();
    const sessione = await backend.sessioneApri(p.id, imp.titolo, imp.scaletta);
    log.info('regia', `sessione ${sessione.id} aperta: preset "${p.nome}", titolo "${imp.titolo}", Reaper ${p.reaper.modalita}`);
    this.set({ sessione, takes: [], scaletta: { voci: imp.scaletta, indice: -1 } });
    await this.contrassegnaProgetto(p);
  }

  private async assicuraSessione(p: Preset) {
    if (this.s.sessione?.presetId === p.id) {
      if (!(await this.progettoCambiato(p))) return this.s.sessione;
      // In Reaper e' aperto un altro progetto: la sessione vecchia si chiude
      // senza fermare Reaper, che ora sta lavorando sul progetto nuovo.
      await this.chiudiSessione(false);
      await this.apriSessione(p);
      this.messaggio('NUOVO PROGETTO REAPER · SESSIONE NUOVA', 'info');
      return this.s.sessione!;
    }
    if (this.s.sessione) await this.chiudiSessione();
    await this.apriSessione(p);
    return this.s.sessione!;
  }

  // Ogni sessione lascia nel progetto di Reaper un contrassegno invisibile
  // (ProjExtState: non e' un marker, non si vede nella timeline). Se prima di
  // una take il contrassegno e' diverso, in Reaper e' stato aperto un altro progetto.

  private contrassegno(s: Sessione) {
    return `takeline-${s.id}-${Date.parse(s.iniziataIl)}`;
  }

  private async contrassegnaProgetto(p: Preset) {
    const s = this.s.sessione;
    if (!s || !this.usaReaper(p)) return;
    try {
      await backend.reaperProgetto(this.conn, this.contrassegno(s));
    } catch (e) {
      log.avviso('regia', `contrassegno di sessione non scritto in Reaper: ${messaggioErrore(e)}`);
    }
  }

  private async progettoCambiato(p: Preset) {
    const s = this.s.sessione;
    if (!s || !this.usaReaper(p) || this.d.impostazioni().reaper.cambioProgetto !== 'nuova-sessione') return false;
    let letto: string;
    try {
      letto = await backend.reaperProgetto(this.conn);
    } catch {
      return false; // Reaper non risponde: lo segnalera' l'avvio della take
    }
    if (letto === this.contrassegno(s)) return false;
    // Sessione appena aperta (o ripresa) e ancora senza take: si adotta il progetto attuale.
    if (!letto && this.s.takes.length === 0) {
      await this.contrassegnaProgetto(p);
      return false;
    }
    log.info('regia', `progetto di Reaper cambiato: contrassegno "${letto || 'assente'}", sessione "${this.contrassegno(s)}"`);
    return true;
  }

  /** Avvio esplicito: con la take continua Reaper registra da subito, anche il riscaldamento. */
  private async apriSessioneCompleta() {
    const p = this.d.preset();
    if (!p) throw new Error('Applica un preset prima di iniziare.');
    await this.assicuraSessione(p);
    if (p.reaper.modalita === 'take-continua') {
      const st = await this.reaperStato();
      if (!st) throw new Error('Reaper non risponde.');
      log.info('regia', `Reaper prima della sessione: stato ${st.stato}, posizione ${st.posizioneTesto}`);
      if (st.stato !== 5) await this.avviaReaper(p, st);
    }
    await this.aggiornaReplay(true);
    this.messaggio('SESSIONE AVVIATA', 'ok');
  }

  /** `fermaReaper` false quando in Reaper e' gia' aperto un altro progetto. */
  private async chiudiSessione(fermaReaper = true) {
    if (this.s.corrente) await this.fermaTake();
    const p = this.d.preset();
    if (fermaReaper && p?.reaper.modalita === 'take-continua' && (await this.reaperStato())?.stato === 5) {
      log.info('regia', 'fine sessione: fermo la take continua di Reaper');
      await this.reaper(AZIONI_REAPER.stop).catch(() => {});
    }
    // Take continua: solo ora, con Reaper fermo, i WAV sono completi.
    if (fermaReaper) this.dopoTake(this.s.takes, 'fine sessione');
    if (this.s.sessione) {
      await backend.sessioneChiudi(this.s.sessione.id);
      log.info('regia', `sessione ${this.s.sessione.id} chiusa con ${this.s.takes.length} take`);
    }
    const imp = this.d.impostazioni();
    this.set({ sessione: null, takes: [], scaletta: { voci: imp.scaletta, indice: -1 }, ultimoMarker: null });
    this.messaggio('SESSIONE CHIUSA', 'info');
  }

  // --- take --------------------------------------------------------------

  private async avviaTake() {
    const p = this.d.preset();
    if (!p) throw new Error('Applica un preset prima di registrare.');
    if (this.d.motore.statoConnessione !== 'connesso') throw new Error('OBS non è connesso: take non avviata.');
    this.set({ fase: 'avvio' });
    const t0 = performance.now();
    try {
      await this.controllaPrimaDelRec();
      const sessione = await this.assicuraSessione(p);
      if (p.consenso.attivo && this.consensoPer !== sessione.id) {
        this.messaggio('CONSENSO: CONFERMA NELLA FINESTRA PRINCIPALE', 'avviso');
        const confermato = (await this.d.chiediConsenso?.(p.consenso.testo)) ?? true;
        log.info('regia', `consenso ${confermato ? 'confermato' : 'NON confermato'} per la sessione ${sessione.id}`);
        if (!confermato) throw new Error('Registrazione annullata: consenso non confermato.');
        this.consensoPer = sessione.id;
      }
      const numero = Math.max(0, ...this.s.takes.map((t) => t.numero)) + 1;
      log.info('regia', `avvio take ${numero} (sessione ${sessione.id}, preset "${p.nome}")`);
      const imp = this.d.impostazioni();
      const formato = await misura('regia', 'nome file in OBS', () =>
        this.d.motore.impostaNomeFile(p.output.templateNome, { preset: p.nome, titolo: imp.titolo, take: numero, quando: new Date() }),
      );
      log.info('regia', `formato nome OBS: ${formato}`);

      if (this.usaReaper(p)) {
        const st = await this.reaperStato();
        if (!st) throw new Error('Reaper non risponde: take non avviata.');
        log.info('regia', `Reaper prima della take: stato ${st.stato}, posizione ${st.posizioneTesto}`);
        if (st.stato !== 5) await misura('regia', 'avvio registrazione Reaper', () => this.avviaReaper(p, st));
      }

      await misura('regia', 'avvio registrazione OBS (attesa conferma)', () => this.d.motore.avviaRegistrazione());
      const inizioMs = Date.now();
      let reaperInizio: number | null = null;
      if (this.usaReaper(p)) {
        const st = await this.reaperStato();
        if (st?.stato === 5) reaperInizio = st.posizione - (Date.now() - inizioMs) / 1000;
        else log.avviso('regia', `dopo l'avvio di OBS Reaper non risulta in registrazione (stato ${st?.stato ?? 'nessuna risposta'})`);
      }
      const take = await backend.takeCrea(sessione.id, 'take', new Date(inizioMs), reaperInizio, null);
      log.info(
        'regia',
        `take ${take.numero} in registrazione dopo ${Math.round(performance.now() - t0)} ms, inizio in Reaper ${reaperInizio?.toFixed(3) ?? '-'} s`,
      );
      this.set({ fase: 'registra', corrente: { take, inizioMs }, takes: [...this.s.takes, take], allarme: null });
      this.avviaWatchdog();
      this.messaggio(`TAKE ${pad2(numero)}`, 'info');

      if (p.transport.clap) await this.clap();
      const { voci, indice } = this.s.scaletta;
      if (voci.length) {
        const i = Math.max(0, indice);
        this.set({ scaletta: { voci, indice: i } });
        await this.aggiungiMarker('capitolo', voci[i] ?? `Capitolo ${i + 1}`, 0);
      }
    } finally {
      if (!this.s.corrente) {
        log.avviso('regia', `take non avviata, torno a fermo (${Math.round(performance.now() - t0)} ms)`);
        this.set({ fase: 'fermo' });
      }
    }
  }

  /** `giaFermata`: OBS ha chiuso il file da solo (o dall'interfaccia di OBS). */
  private async fermaTake(giaFermata?: { file: string | null }) {
    const c = this.s.corrente;
    if (!c) return;
    const p = this.d.preset();
    this.set({ fase: 'arresto' });
    const fineMs = Date.now();
    log.info('regia', `arresto take ${c.take.numero}${giaFermata ? ' (OBS ha gia\' chiuso il file)' : ''} dopo ${formattaDurata((fineMs - c.inizioMs) / 1000)}`);
    try {
      let reaperFine: number | null = null;
      if (this.usaReaper(p)) {
        const st = await this.reaperStato();
        if (st?.stato === 5) reaperFine = st.posizione - (Date.now() - fineMs) / 1000;
        else log.avviso('regia', `alla fine della take Reaper non risulta in registrazione (stato ${st?.stato ?? 'nessuna risposta'})`);
      }
      let file = giaFermata?.file ?? null;
      if (!giaFermata) file = await misura('regia', 'arresto registrazione OBS', () => this.d.motore.fermaRegistrazione());
      log.info('regia', `file video: ${file ?? 'sconosciuto'}`);
      if (this.usaReaper(p) && p.reaper.modalita === 'start-stop') await this.reaper(AZIONI_REAPER.stop).catch(() => {});

      const take = await backend.takeChiudi(c.take.id, file, (fineMs - c.inizioMs) / 1000, reaperFine);
      if (take.reaperInizioS !== null && reaperFine !== null) {
        await this.regionReaper(take.reaperInizioS, reaperFine, this.nomeTake(take), 'take');
      }
      this.sostituisci(take);
      this.messaggio(`TAKE ${pad2(take.numero)} · ${formattaDurata(take.durataS ?? 0)}`, 'ok');
      // Con start/stop (o senza Reaper) i file sono gia' completi; con la take continua si aspetta la fine sessione.
      if (p?.reaper.modalita !== 'take-continua') this.dopoTake([take], 'fine take');
    } finally {
      this.fermaWatchdog();
      this.set({ fase: 'fermo', corrente: null });
    }
  }

  private sostituisci(t: Take) {
    this.set({ takes: this.s.takes.map((x) => (x.id === t.id ? t : x)) });
  }

  private async clap() {
    const c = this.s.corrente;
    if (!c) return;
    this.set({ flash: this.s.flash + 1 });
    const audio = suonaClick();
    const tempoS = (Date.now() - c.inizioMs) / 1000;
    await backend.takeClap(c.take.id, tempoS);
    await this.aggiungiMarker('clap', audio ? 'CLAP' : 'CLAP (solo flash)', tempoS);
  }

  private async aggiungiMarker(tipo: TipoMarker, etichetta: string, tempoS?: number) {
    const sessione = this.s.sessione;
    if (!sessione) return;
    const c = this.s.corrente;
    const t = tempoS ?? (c ? (Date.now() - c.inizioMs) / 1000 : 0);
    // Stesso istante nella timeline di Reaper, grazie all'offset salvato sul take.
    const reaperS = c && c.take.reaperInizioS !== null ? c.take.reaperInizioS + t : null;
    log.info('regia', `marker ${tipo} "${etichetta}" a ${t.toFixed(3)} s del video, ${reaperS?.toFixed(3) ?? '-'} s in Reaper`);
    await backend.markerAggiungi(sessione.id, c?.take.id ?? null, tipo, t, reaperS, etichetta);
    if (reaperS !== null) await this.segnaReaper(tipo, etichetta, reaperS);
    if (c) this.set({ takes: this.s.takes.map((x) => (x.id === c.take.id ? { ...x, marker: x.marker + 1 } : x)) });
    this.set({ ultimoMarker: { tipo, etichetta, tempoS: t } });
  }

  private ultimoTake() {
    const t = this.s.takes.at(-1);
    if (!t) throw new Error('Nessun take in questa sessione.');
    return t;
  }

  private async rinominaRegion(t: Take, prefisso: string, tipo: TipoColore) {
    // Se l'utente ha cancellato la region, lo script risponde "region non trovata": nessun danno.
    if (this.segni === 'niente' || t.reaperInizioS === null) return;
    const nome = prefisso ? `${prefisso} · ${this.nomeTake(t)}` : this.nomeTake(t);
    await this.bridge(['rinomina', t.reaperInizioS.toFixed(3), nome, tipo]);
  }

  /** Porta Reaper all'inizio del take e lo fa suonare. Mai durante una registrazione. */
  async ascoltaInReaper(t: Take) {
    if (t.reaperInizioS === null) throw new Error('Questo take non ha una posizione in Reaper.');
    const st = await this.reaperStato();
    if (!st) throw new Error('Reaper non risponde.');
    if (st.stato === 5 || st.stato === 6) throw new Error('Reaper sta registrando: ascolta il take a sessione finita.');
    log.info('regia', `ascolto del take ${t.numero} in Reaper da ${t.reaperInizioS.toFixed(3)} s`);
    await this.reaper(`SET/POS/${t.reaperInizioS.toFixed(3)};${AZIONI_REAPER.play}`);
  }

  /**
   * File audio scritti da Reaper che contengono il take (uno per traccia
   * armata). Li chiede allo script bridge la prima volta e li salva sul take.
   */
  async fileAudio(t: Take): Promise<string[]> {
    return (await this.sorgentiAudio(t)).map((s) => s.file);
  }

  /** Come fileAudio, con la posizione degli item in Reaper (serve al sync). */
  private async sorgentiAudio(t: Take): Promise<SorgenteAudio[]> {
    const salvate = leggiSorgenti(t.fileAudio);
    if (salvate.length && salvate.every((s) => s.inizioItem !== null)) return salvate;
    if (t.reaperInizioS === null) throw new Error('Questo take non ha una posizione in Reaper.');
    const id = this.conn.bridgeId.trim();
    if (!id) throw new Error('Per trovare i file audio serve lo script bridge: Impostazioni › Reaper.');
    const st = await this.reaperStato();
    if (st?.stato === 5 || st?.stato === 6) {
      throw new Error('Reaper sta ancora registrando: il file audio sarà pronto quando si ferma (Fine sessione).');
    }
    // Un punto ben dentro il take, lontano dai bordi.
    const durata = t.durataS ?? 0;
    const pos = t.reaperInizioS + Math.max(0.05, Math.min(durata / 2, durata - 0.05));
    const esito = await backend.reaperBridge(this.conn, id, ['sorgenti', pos.toFixed(3)]);
    log.info('bridge', `sorgenti ${pos.toFixed(3)} -> ${esito}`);
    if (!esito.startsWith('ok')) {
      throw new Error(`Lo script bridge non conosce questo comando (“${esito}”): reinstallalo da Impostazioni › Reaper.`);
    }
    const sorgenti = leggiSorgenti(esito.slice(2).trim().split('|').join('\n'));
    if (!sorgenti.length) throw new Error('In Reaper non c’è audio in quel punto: è aperto il progetto in cui hai registrato?');
    if (sorgenti.some((s) => s.inizioItem === null)) {
      throw new Error('Lo script bridge è di una versione precedente: reinstallalo da Impostazioni › Reaper (il command ID resta lo stesso).');
    }
    this.sostituisci(await backend.takeAudio(t.id, JSON.stringify(sorgenti)));
    return sorgenti;
  }

  // --- sync ----------------------------------------------------------------

  /**
   * Misura offset e drift tra il video del take e il WAV di Reaper, li salva
   * sul take e, se il preset lo vuole, crea MP4 e WAV allineati. Gira in una
   * coda sua: il transport non aspetta mai il sync.
   */
  sincronizza(t: Take, opz: { esporta?: boolean; motivo: string; poi?: () => Promise<void> }) {
    if (this.inCodaSync.has(t.id)) return this.codaSync;
    this.inCodaSync.add(t.id);
    this.codaSync = this.codaSync
      .then(() => this.eseguiSync(t, opz))
      .catch((e) => {
        log.errore('sync', `take ${t.numero}: ${messaggioErrore(e)}`);
        this.messaggio(`SYNC TAKE ${pad2(t.numero)}: ${messaggioErrore(e)}`, 'avviso');
      })
      // La post-produzione parte anche se il sync non riesce: lavorera' sul video originale.
      .then(() => opz.poi?.())
      .catch((e) => log.errore('post', `take ${t.numero}`, e))
      .finally(() => this.inCodaSync.delete(t.id));
    return this.codaSync;
  }

  private async eseguiSync(t: Take, { esporta, motivo }: { esporta?: boolean; motivo: string }) {
    const p = this.d.preset();
    if (!t.fileVideo) throw new Error('il take non ha un file video.');
    if (t.reaperInizioS === null) throw new Error('il take non ha una posizione in Reaper.');
    // ffmpeg non deve rubare risorse a una registrazione in corso: si aspetta.
    while (this.s.fase !== 'fermo') await pausa(1000);
    this.set({ sincronizzando: t.id });
    try {
      log.info('sync', `take ${t.numero} (${motivo}): ${t.fileVideo}`);
      const sorgenti = await this.sorgentiAudio(t);
      const { indice: flussoGuida, nota } = await this.d.motore
        .flussoAudio(p?.obs.tracciaGuida ?? '')
        .catch(() => ({ indice: 0, nota: 'OBS non connesso: uso la prima traccia audio del video.' }));
      if (nota) log.info('sync', nota);
      const ffmpeg = this.d.impostazioni().ffmpeg.percorso;

      // Con piu' tracce armate si tiene il file che somiglia di piu' alla traccia guida.
      let migliore: { r: RisultatoSync; s: SorgenteAudio } | null = null;
      let ultimoErrore: unknown = null;
      for (const s of sorgenti.slice(0, 4)) {
        const inizioStimato = s.offset! + (t.reaperInizioS - s.inizioItem!) * s.velocita!;
        try {
          // La durata di un replay e' stimata: la sua posizione in Reaper e' meno precisa.
          const margine = t.tipo === 'replay' ? 8 : 2;
          const r = await backend.syncAnalizza({ ffmpeg, video: t.fileVideo, flussoGuida, audio: s.file, inizioStimato, margine });
          const conf = Math.min(...r.misure.map((m) => m.confidenza));
          log.info('sync', `${s.file}: inizio ${r.inizioAudio.toFixed(4)} s, drift ${r.driftPpm.toFixed(1)} ppm, confidenza ${conf.toFixed(1)}`);
          if (!migliore || conf > Math.min(...migliore.r.misure.map((m) => m.confidenza))) migliore = { r, s };
        } catch (e) {
          ultimoErrore = e;
          log.avviso('sync', `${s.file}: ${messaggioErrore(e)}`);
        }
      }
      if (!migliore) throw ultimoErrore ?? new Error('nessun file audio analizzabile.');

      const { r, s } = migliore;
      for (const a of r.avvisi) log.avviso('sync', a);
      const info: InfoSync = { ...r, fileAudio: s.file, flussoGuida, analizzatoIl: new Date().toISOString() };
      let aggiornato = await backend.takeSync(t.id, r.inizioAudio, r.rapporto, info);
      this.sostituisci(aggiornato);

      if (esporta ?? p?.sync.esporta) {
        const e = await backend.syncEsporta({ ffmpeg, video: t.fileVideo, audio: s.file, inizioAudio: r.inizioAudio, rapporto: r.rapporto });
        log.info('sync', `export: ${e.videoSync} + ${e.audioSync}`);
        await backend.fileRegistra(t.id, 'sync', e.videoSync);
        await backend.fileRegistra(t.id, 'sync-audio', e.audioSync);
        aggiornato = await backend.takeSync(t.id, r.inizioAudio, r.rapporto, { ...info, export: { ...e, creatoIl: new Date().toISOString() } });
        this.sostituisci(aggiornato);
      }
      const segno = r.correzioneMs >= 0 ? '+' : '';
      this.messaggio(
        `SYNC TAKE ${pad2(t.numero)} · ${segno}${r.correzioneMs.toFixed(0)} ms · ${r.driftPpm.toFixed(0)} ppm${r.avvisi.length ? ' · vedi avvisi' : ''}`,
        r.avvisi.length ? 'avviso' : 'ok',
      );
    } finally {
      this.set({ sincronizzando: null });
    }
  }

  /** Sync automatico, se il preset lo vuole e Reaper non sta piu' registrando. */
  /**
   * Dopo la registrazione: sync (se il preset lo vuole e c'e' Reaper), poi
   * post-produzione. I file sono completi solo con Reaper fermo: a fine take
   * con start/stop, a fine sessione con la take continua.
   */
  private dopoTake(takes: Take[], motivo: string) {
    const p = this.d.preset();
    if (!p) return;
    const validi = takes.filter((t) => t.fileVideo && t.stato !== 'scartato' && !this.lavorati.has(t.id));
    if (!validi.length) return;
    for (const t of validi) this.lavorati.add(t.id);
    log.info('post', `dopo la registrazione (${motivo}): take ${validi.map((t) => t.numero).join(', ')}`);
    // Un attimo perche' Reaper e OBS chiudano i file.
    this.codaSync = this.codaSync.then(() => pausa(1500));
    for (const t of validi) {
      const conSync = p.sync.automatico && this.usaReaper(p) && t.reaperInizioS !== null && t.offsetS === null;
      if (conSync) void this.sincronizza(t, { motivo, poi: () => this.accodaPost(t) });
      else this.codaSync = this.codaSync.then(() => this.accodaPost(t)).catch((e) => log.errore('post', `take ${t.numero}`, e));
    }
  }

  /** Mette in coda le lavorazioni del preset; capitoli ed EDL si scrivono subito. */
  private async accodaPost(t: Take) {
    const p = this.d.preset();
    if (!p || !t.fileVideo) return;
    const ffmpeg = this.d.impostazioni().ffmpeg.percorso;
    const lavori: [TipoLavoro, Record<string, unknown>][] = [];
    if (p.post.remuxMp4 && !/\.mp4$/i.test(t.fileVideo)) lavori.push(['remux', {}]);
    if (p.post.separaTracce) lavori.push(['tracce', {}]);
    if (p.post.normalizza) lavori.push(['loudnorm', { lufs: p.post.lufs }]);
    for (const piattaforma of p.post.export) lavori.push(['export', { piattaforma }]);
    for (const [tipo, parametri] of lavori) await backend.postAccoda(t.id, tipo, { ...parametri, ffmpeg });
    if (lavori.length) log.info('post', `take ${t.numero}: in coda ${lavori.map(([x]) => x).join(', ')}`);
    if (p.post.marker && t.marker > 0) {
      await backend
        .takeCapitoli(t.id)
        .then((c) => log.info('post', `take ${t.numero}: capitoli in ${c.file}${c.avvisi.length ? ` (${c.avvisi.join(' ')})` : ''}`))
        .catch(() => {}); // nessun capitolo nel take: niente file
      await backend
        .takeEdl(t.id, ffmpeg)
        .then((f) => log.info('post', `take ${t.numero}: EDL ${f.join(', ')}`))
        .catch((e) => log.avviso('post', `take ${t.numero}: EDL non creato: ${messaggioErrore(e)}`));
    }
  }

  /** Cambio di stato dalla lista dei take (dopo la registrazione, col mouse). */
  cambiaStatoTake(id: number, stato: 'registrato' | 'buono' | 'da_tagliare' | 'scartato') {
    const regione: Record<typeof stato, [string, TipoColore]> = {
      registrato: ['', 'take'],
      buono: ['BUONO', 'buono'],
      da_tagliare: ['DA TAGLIARE', 'taglia'],
      scartato: ['SCARTATO', 'scartato'],
    };
    this.coda = this.coda
      .then(async () => {
        const t = await backend.takeStato(id, stato);
        this.sostituisci(t);
        await this.rinominaRegion(t, ...regione[stato]);
      })
      .catch((e) => this.messaggio(messaggioErrore(e), 'errore'));
    return this.coda;
  }

  private async marca(tipo: 'buono' | 'taglia') {
    const etichetta = tipo === 'buono' ? 'BUONO' : 'DA TAGLIARE';
    if (this.s.corrente) {
      // Durante la take: un punto preciso; "buono" promuove anche il take.
      await this.aggiungiMarker(tipo, etichetta);
      if (tipo === 'buono') this.sostituisci(await backend.takeStato(this.s.corrente.take.id, 'buono'));
      this.messaggio(etichetta, tipo === 'buono' ? 'ok' : 'avviso');
      return;
    }
    const t = await backend.takeStato(this.ultimoTake().id, tipo === 'buono' ? 'buono' : 'da_tagliare');
    this.sostituisci(t);
    await this.rinominaRegion(t, etichetta, tipo);
    this.messaggio(`TAKE ${pad2(t.numero)} · ${etichetta}`, tipo === 'buono' ? 'ok' : 'avviso');
  }

  private async nuovoCapitolo() {
    const { voci, indice } = this.s.scaletta;
    const prossimo = indice + 1;
    const etichetta = voci[prossimo] ?? `Capitolo ${prossimo + 1}`;
    this.set({ scaletta: { voci, indice: prossimo } });
    if (this.s.corrente) await this.aggiungiMarker('capitolo', etichetta);
    this.messaggio(`CAPITOLO · ${etichetta}`, 'info');
  }

  /** Non cancella nulla: il take resta su disco, marcato come scartato. */
  private async scartaUltimo() {
    if (this.s.corrente) await this.fermaTake();
    const t = await backend.takeStato(this.ultimoTake().id, 'scartato');
    this.sostituisci(t);
    await this.rinominaRegion(t, 'SCARTATO', 'scartato');
    this.messaggio(`TAKE ${pad2(t.numero)} SCARTATO`, 'avviso');
  }

  // --- replay buffer -----------------------------------------------------

  private copertoS(oraMs: number) {
    const { avviatoMs, secondiMax } = this.s.replay;
    return avviatoMs === null ? secondiMax : Math.min(secondiMax, (oraMs - avviatoMs) / 1000);
  }

  private async salvaReplay() {
    const p = this.d.preset();
    if (!p) throw new Error('Applica un preset prima di salvare un replay.');
    if (!this.s.replay.attivo) throw new Error('Replay buffer non attivo.');
    const salvatoMs = Date.now();
    const coperto = this.copertoS(salvatoMs);
    this.messaggio('SALVO IL REPLAY…', 'info');
    const file = await this.d.motore.salvaReplay();
    const sessione = await this.assicuraSessione(p);

    let reaperFine: number | null = null;
    if (this.usaReaper(p)) {
      const st = await this.reaperStato();
      if (st?.stato === 5) reaperFine = st.posizione - (Date.now() - salvatoMs) / 1000;
    }
    const reaperInizio = reaperFine === null ? null : Math.max(0, reaperFine - coperto);
    let t = await backend.takeCrea(sessione.id, 'replay', new Date(salvatoMs - coperto * 1000), reaperInizio, file);
    t = await backend.takeChiudi(t.id, file, coperto, reaperFine);
    if (reaperInizio !== null && reaperFine !== null) await this.regionReaper(reaperInizio, reaperFine, this.nomeTake(t), 'replay');
    // Un replay salvato durante una take non deve finire prima del take in corso.
    const takes = [...this.s.takes, t].sort((a, b) => a.numero - b.numero);
    this.set({ takes });
    this.messaggio(`REPLAY SALVATO · ${formattaDurata(coperto)}`, 'ok');
  }

  /** Legge lo stato del buffer e, se il preset lo vuole, lo tiene acceso. */
  async aggiornaReplay(avvia: boolean) {
    if (this.d.motore.statoConnessione !== 'connesso') return;
    try {
      const st = await this.d.motore.statoReplay();
      let attivo = st.attivo;
      if (avvia && !this.sospesa && !st.attivo && st.disponibile && this.d.preset()?.transport.replayBuffer) {
        await this.d.motore.avviaReplay();
        attivo = true;
      }
      const avviatoMs = attivo ? (this.s.replay.attivo ? this.s.replay.avviatoMs : st.attivo ? null : Date.now()) : null;
      this.set({ replay: { disponibile: st.disponibile, attivo, secondiMax: st.secondiMax, avviatoMs } });
    } catch {
      // OBS in ricaricamento: ci pensa il prossimo evento.
    }
  }

  // --- sicurezza: pre-flight, watchdog, recupero ---------------------------

  /** Pre-flight prima di ogni take: con un errore la take non parte. */
  private async controllaPrimaDelRec() {
    if (!this.d.impostazioni().sicurezza.preflight || !this.d.preflight) return;
    // Take una dietro l'altra: un controllo pulito di pochi secondi fa basta, il pedale non deve aspettare.
    const ultimo = this.s.preflight;
    if (ultimo && Date.now() - ultimo.quando < 30_000 && !primoErrore(ultimo.controlli)) return;
    const controlli = await misura('regia', 'pre-flight', () => this.d.preflight!());
    this.set({ preflight: { controlli, quando: Date.now() } });
    const errore = primoErrore(controlli);
    for (const c of controlli.filter((x) => x.esito !== 'ok')) log[c.esito === 'errore' ? 'errore' : 'avviso']('preflight', `${c.titolo}: ${c.dettaglio}`);
    if (errore) throw new Error(`PRE-FLIGHT · ${errore.titolo}: ${errore.dettaglio}`);
  }

  /** Pre-flight a richiesta (pannello della Regia). */
  async preflight() {
    if (!this.d.preflight) return;
    this.set({ preflight: { controlli: await this.d.preflight(), quando: Date.now() } });
  }

  private allarme(testo: string, livello: 'avviso' | 'errore') {
    if (this.s.allarme?.testo === testo) return;
    log[livello === 'errore' ? 'errore' : 'avviso']('watchdog', testo);
    this.set({ allarme: { testo, livello } });
  }

  private avviaWatchdog() {
    this.fermaWatchdog();
    if (!this.d.impostazioni().sicurezza.watchdog) return;
    // Le statistiche di OBS contano da quando OBS e' aperto: serve la base di partenza.
    void this.d.motore
      .statistiche()
      .then((s) => (this.basiStatistiche = s))
      .catch(() => {});
    this.watchdog = setInterval(() => void this.controllaWatchdog(), 2000);
  }

  private fermaWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.basiStatistiche = null;
  }

  private async controllaWatchdog() {
    if (this.s.fase !== 'registra' || this.d.motore.statoConnessione !== 'connesso') return;
    const { sicurezza } = this.d.impostazioni();
    try {
      const s = await this.d.motore.statistiche();
      const sogliaMb = sicurezza.discoMinimoGb * 1024;
      if (s.discoLiberoMb > 0 && s.discoLiberoMb < sogliaMb) {
        return this.fermataDiSicurezza(`DISCO QUASI PIENO (${(s.discoLiberoMb / 1024).toFixed(1)} GB)`);
      }
      const b = this.basiStatistiche;
      if (b) {
        const render = s.renderTotali - b.renderTotali;
        const uscita = s.uscitaTotali - b.uscitaTotali;
        const persi = Math.max(
          render > 0 ? ((s.renderSaltati - b.renderSaltati) / render) * 100 : 0,
          uscita > 0 ? ((s.uscitaSaltati - b.uscitaSaltati) / uscita) * 100 : 0,
        );
        // Almeno qualche secondo di fotogrammi, altrimenti un singolo scatto pesa troppo.
        if (Math.max(render, uscita) > 300) {
          if (persi >= sicurezza.framePersiMax) return this.fermataDiSicurezza(`OBS PERDE IL ${persi.toFixed(1)}% DEI FOTOGRAMMI`);
          if (persi >= sicurezza.framePersiMax / 4) this.allarme(`FOTOGRAMMI PERSI ${persi.toFixed(1)}%`, 'avviso');
        }
      }
      if (s.discoLiberoMb > 0 && s.discoLiberoMb < sogliaMb * 2) this.allarme(`DISCO: ${(s.discoLiberoMb / 1024).toFixed(1)} GB LIBERI`, 'avviso');
      const p = this.d.preset();
      if (this.usaReaper(p)) {
        const st = await this.reaperStato();
        if (!st) this.allarme('REAPER NON RISPONDE', 'avviso');
        else if (st.stato !== 5) this.allarme('REAPER NON STA REGISTRANDO', 'errore');
        else if (this.s.allarme?.testo.startsWith('REAPER')) this.set({ allarme: null });
      }
    } catch {
      // statistiche non disponibili per un attimo: si riprova al giro dopo
    }
  }

  /** Ferma la take prima che il problema la rovini. */
  private fermataDiSicurezza(motivo: string) {
    this.fermaWatchdog();
    this.allarme(`${motivo} · TAKE FERMATA`, 'errore');
    this.coda = this.coda.then(() => this.fermaTake()).catch((e) => this.fallito(e));
  }

  /** OBS non risponde durante una take: si aspetta un po' prima di chiuderla. */
  private obsPerso(motivo?: string) {
    this.allarme('OBS DISCONNESSO · ATTENDO CHE TORNI', 'errore');
    log.errore('watchdog', `OBS perso durante la take ${this.s.corrente?.take.numero}: ${motivo ?? ''}`);
    if (this.attesaObs) clearTimeout(this.attesaObs);
    this.attesaObs = setTimeout(() => {
      this.attesaObs = null;
      if (this.s.fase !== 'registra' || this.d.motore.statoConnessione === 'connesso') return;
      // Niente OBS da fermare: si chiude il take (e Reaper con start/stop) senza perderlo.
      this.coda = this.coda
        .then(() => this.fermaTake({ file: null }))
        .then(() => this.allarme('OBS PERSO: TAKE CHIUSA, CONTROLLA IL FILE', 'errore'))
        .catch((e) => this.fallito(e));
    }, 30_000);
  }

  /** OBS e' tornato durante la take: se registra ancora si continua, altrimenti si chiude. */
  private async obsTornato() {
    if (this.attesaObs) clearTimeout(this.attesaObs);
    this.attesaObs = null;
    const ist = await this.d.motore.istantanea().catch(() => null);
    if (ist?.registrazione.attiva) {
      log.info('watchdog', 'OBS è tornato e sta ancora registrando: la take continua');
      this.set({ allarme: null });
      this.messaggio('OBS DI NUOVO CONNESSO', 'ok');
      return;
    }
    this.coda = this.coda
      .then(() => this.fermaTake({ file: null }))
      .then(() => this.allarme('OBS SI È RIAVVIATO: TAKE INTERROTTA', 'errore'))
      .catch((e) => this.fallito(e));
  }

  /**
   * Al riavvio: un take rimasto aperto (app chiusa durante la registrazione).
   * Se OBS sta ancora registrando lo si riaggancia, altrimenti si cerca il file
   * nella cartella di registrazione e lo si chiude.
   */
  private async recupera() {
    this.recuperoFatto = true;
    const aperti = this.s.takes.filter((t) => t.durataS === null && t.tipo === 'take');
    if (!aperti.length) return;
    const ist = await this.d.motore.istantanea().catch(() => null);
    const ultimo = aperti.at(-1)!;
    const daChiudere = [...aperti];
    if (ist?.registrazione.attiva && this.s.fase === 'fermo') {
      daChiudere.pop();
      this.set({ fase: 'registra', corrente: { take: ultimo, inizioMs: Date.parse(ultimo.iniziatoIl) } });
      this.avviaWatchdog();
      log.info('recupero', `take ${ultimo.numero} riagganciata: OBS stava ancora registrando`);
      this.messaggio(`TAKE ${pad2(ultimo.numero)} RIAGGANCIATA`, 'ok');
    }
    const cartella = ist?.cartellaRegistrazione ?? '';
    for (const t of daChiudere) {
      const inizio = Date.parse(t.iniziatoIl);
      const candidati = cartella ? await backend.fileRecenti(cartella, inizio - 10_000).catch(() => []) : [];
      const file = candidati.find((f) => f.percorso.includes(`take${pad2(t.numero)}`)) ?? candidati[0] ?? null;
      const durata = file ? Math.max(0, (file.modificatoMs - inizio) / 1000) : 0;
      this.sostituisci(await backend.takeChiudi(t.id, file?.percorso ?? null, durata, null));
      log.avviso('recupero', `take ${t.numero} rimasta aperta: chiusa${file ? ` con ${file.percorso}` : ', file non trovato'}`);
      this.messaggio(`TAKE ${pad2(t.numero)} RECUPERATA${file ? '' : ' (FILE NON TROVATO)'}`, file ? 'ok' : 'avviso');
    }
  }

  private suMotore(e: EventoMotore) {
    if (e.tipo === 'livelli' || e.tipo === 'cambiato') {
      // troppo frequenti per il log
    } else if (e.tipo === 'connessione') {
      const scrivi = e.stato === 'disconnesso' && e.motivo ? log.errore : log.info;
      scrivi('obs', `connessione: ${e.stato}${e.motivo ? ` (${e.motivo})` : ''} [${this.contesto}]`);
    } else if (e.tipo === 'registrazione') {
      log.info('obs', `registrazione ${e.attiva ? 'avviata' : 'fermata'}${e.file ? `: ${e.file}` : ''} [${this.contesto}]`);
    } else if (e.tipo === 'replay') {
      log.info('obs', `replay buffer ${e.attivo ? 'avviato' : 'fermato'}`);
    } else if (e.tipo === 'replaySalvato') {
      log.info('obs', `replay salvato: ${e.file}`);
    }

    if (e.tipo === 'replay') {
      this.set({ replay: { ...this.s.replay, attivo: e.attivo, avviatoMs: e.attivo ? Date.now() : null } });
      if (!e.attivo && this.d.preset()?.transport.replayBuffer) {
        // "Tieni attivo": se si ferma (a mano o per errore) lo si riavvia.
        if (this.timerReplay) clearTimeout(this.timerReplay);
        this.timerReplay = setTimeout(() => void this.aggiornaReplay(true), 3000);
      }
    } else if (e.tipo === 'connessione' && e.stato === 'connesso') {
      void this.aggiornaReplay(true);
      if (this.s.fase === 'registra') void this.obsTornato();
      else if (!this.recuperoFatto) void this.recupera();
    } else if (e.tipo === 'connessione' && e.stato === 'disconnesso' && this.s.fase === 'registra') {
      this.obsPerso(e.motivo);
    } else if (e.tipo === 'registrazione' && !e.attiva && this.s.fase === 'registra') {
      // Registrazione fermata fuori da Takeline: si chiude il take senza perderlo.
      this.coda = this.coda
        .then(() => this.fermaTake({ file: e.file }))
        .then(() => this.messaggio('OBS HA FERMATO LA REGISTRAZIONE', 'avviso'))
        .catch((err) => this.messaggio(messaggioErrore(err), 'errore'));
    }
  }
}
