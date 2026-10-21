// Il transport senza strumenti: OBS finto, backend e Reaper simulati.

import { beforeAll, describe, expect, it } from 'vitest';

import { installa, reaperSimulato } from '../dev/anteprimaBrowser';
import type {
  EventoMotore,
  IstantaneaMotore,
  RecordingEngine,
  StatisticheMotore,
  StatoConnessione,
} from './engine/RecordingEngine';
import { backend } from './backend';
import { IMPOSTAZIONI_PREDEFINITE, presetPredefiniti, type Impostazioni, type Preset } from './model';
import type { Controllo } from './preflight';
import { Regia } from './regia';

class ObsFinto implements RecordingEngine {
  readonly nome = 'OBS finto';
  statoConnessione: StatoConnessione = 'connesso';
  readonly info = null;
  registra = false;
  file = 0;
  stat: StatisticheMotore = { fps: 60, cpu: 10, renderSaltati: 0, renderTotali: 1000, uscitaSaltati: 0, uscitaTotali: 1000, discoLiberoMb: 500_000 };
  private ascoltatori = new Set<(e: EventoMotore) => void>();

  emetti(e: EventoMotore) {
    for (const l of this.ascoltatori) l(e);
  }
  ascolta(l: (e: EventoMotore) => void) {
    this.ascoltatori.add(l);
    return () => void this.ascoltatori.delete(l);
  }
  async connetti() {
    return { motore: this.nome, versioneMotore: '32', versioneProtocollo: '5', piattaforma: 'test' };
  }
  async disconnetti() {}
  async istantanea(): Promise<IstantaneaMotore> {
    return {
      collezione: 'C', collezioni: ['C'], profilo: 'P', profili: ['P'], scena: 'S', scene: ['S'],
      registrazione: { attiva: this.registra, inPausa: false, timecode: '' },
      replayBuffer: { disponibile: false, attivo: false }, diretta: false,
      cartellaRegistrazione: 'C:\\video', formatoNomeFile: '', sorgentiAudio: [], video: null,
    };
  }
  async backup() {
    return { cartella: '', fileCopiati: 0, cartellaObs: '' };
  }
  async cambiaCollezione() {}
  async cambiaProfilo() {}
  async cambiaScena() {
    return 'ok' as const;
  }
  async impostaCartella() {}
  async impostaNomeFile() {
    return 'nome';
  }
  async avviaRegistrazione() {
    this.registra = true;
    this.emetti({ tipo: 'registrazione', attiva: true, file: null });
  }
  async fermaRegistrazione() {
    this.registra = false;
    const f = `C:\\video\\take${++this.file}.mp4`;
    this.emetti({ tipo: 'registrazione', attiva: false, file: f });
    return f;
  }
  async statoReplay() {
    return { disponibile: false, attivo: false, secondiMax: 0 };
  }
  async configuraReplay() {
    return this.statoReplay();
  }
  async avviaReplay() {}
  async fermaReplay() {}
  async salvaReplay() {
    return 'C:\\video\\replay.mp4';
  }
  async flussoAudio() {
    return { indice: 0 };
  }
  async statistiche() {
    return { ...this.stat };
  }
  async encoder() {
    return 'nvenc';
  }
  async controllaFrameRate() {
    return { ok: true, dettaglio: '' };
  }
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

function prepara(opz: { preset?: Preset; preflight?: () => Promise<Controllo[]>; consenso?: boolean } = {}) {
  const preset = structuredClone(opz.preset ?? presetPredefiniti('C:\\video')[0]);
  // Niente sync e post-produzione: qui conta solo il transport.
  preset.sync.automatico = false;
  preset.post = { ...preset.post, remuxMp4: false, separaTracce: false, normalizza: false, export: [], marker: false };
  const imp: Impostazioni = structuredClone(IMPOSTAZIONI_PREDEFINITE);
  const obs = new ObsFinto();
  const regia = new Regia({
    motore: obs,
    impostazioni: () => imp,
    preset: () => preset,
    aggiorna: () => {},
    preflight: opz.preflight,
    chiediConsenso: opz.consenso === undefined ? undefined : async () => opz.consenso!,
  });
  return { regia, obs, imp, preset };
}

/** Fa sembrare la take in corso partita da `ms` millisecondi. */
function invecchia(regia: Regia, ms: number) {
  regia.stato.corrente!.inizioMs -= ms;
}

describe('transport', () => {
  beforeAll(() => installa());

  it('avvia e ferma una take, con la take continua Reaper resta in registrazione', async () => {
    const { regia, obs } = prepara();
    await regia.comando('avviaFerma', 'test');
    expect(regia.stato.fase).toBe('registra');
    expect(regia.stato.corrente?.take.numero).toBe(1);
    expect(obs.registra).toBe(true);
    expect(reaperSimulato.azioni).toContain('1013');

    invecchia(regia, 2000);
    await regia.comando('avviaFerma', 'test');
    expect(regia.stato.fase).toBe('fermo');
    const take = regia.stato.takes[0];
    expect(take.fileVideo).toBe('C:\\video\\take1.mp4');
    expect(take.durataS).toBeGreaterThanOrEqual(2);
    expect(reaperSimulato.azioni.at(-1)).not.toBe('1016');
  });

  it('ignora un secondo avvia/ferma entro un secondo', async () => {
    const { regia } = prepara();
    await regia.comando('avviaFerma', 'test');
    await regia.comando('avviaFerma', 'test');
    expect(regia.stato.fase).toBe('registra');
    invecchia(regia, 1500);
    await regia.comando('avviaFerma', 'test');
    expect(regia.stato.fase).toBe('fermo');
  });

  it('con start/stop Reaper si ferma insieme a OBS e riparte dalla fine del progetto', async () => {
    const { regia, imp } = prepara({ preset: presetPredefiniti('C:\\video')[1] });
    await backend.reaperAzione(imp.reaper, '1016'); // Reaper fermo, come all'inizio di una formazione
    reaperSimulato.azioni.length = 0;
    await regia.comando('avviaFerma', 'test');
    invecchia(regia, 2000);
    await regia.comando('avviaFerma', 'test');
    expect(reaperSimulato.azioni).toContain('40042'); // "torna all'inizio" e' attivo nel preset Formazione
    expect(reaperSimulato.azioni.at(-1)).toBe('1016');
  });

  it('un errore di pre-flight blocca la take e lo dice', async () => {
    const { regia, obs } = prepara({
      preflight: async () => [{ id: 'disco', titolo: 'Spazio su disco', esito: 'errore', dettaglio: '2 GB liberi' }],
    });
    await regia.comando('avviaFerma', 'test');
    expect(regia.stato.fase).toBe('fermo');
    expect(obs.registra).toBe(false);
    expect(regia.stato.messaggio?.testo).toContain('PRE-FLIGHT');
  });

  it('un avviso di pre-flight non blocca', async () => {
    const { regia } = prepara({
      preflight: async () => [{ id: 'pedale', titolo: 'Pedale MIDI', esito: 'avviso', dettaglio: 'non collegato' }],
    });
    await regia.comando('avviaFerma', 'test');
    expect(regia.stato.fase).toBe('registra');
  });

  it('senza consenso la call non parte', async () => {
    const call = presetPredefiniti('C:\\video')[2];
    const no = prepara({ preset: call, consenso: false });
    await no.regia.comando('avviaFerma', 'test');
    expect(no.regia.stato.fase).toBe('fermo');
    expect(no.obs.registra).toBe(false);

    const si = prepara({ preset: call, consenso: true });
    await si.regia.comando('avviaFerma', 'test');
    expect(si.regia.stato.fase).toBe('registra');
  });

  it('il watchdog ferma la take se OBS perde troppi fotogrammi', async () => {
    const { regia, obs, imp } = prepara();
    imp.sicurezza.framePersiMax = 5;
    await regia.comando('avviaFerma', 'test');
    await pausa(10); // base delle statistiche
    obs.stat = { ...obs.stat, renderTotali: obs.stat.renderTotali + 1000, renderSaltati: obs.stat.renderSaltati + 200 };
    await (regia as unknown as { controllaWatchdog(): Promise<void> }).controllaWatchdog();
    await regia.comando('capitolo', 'test'); // aspetta la coda dei comandi
    expect(regia.stato.fase).toBe('fermo');
    expect(regia.stato.allarme?.testo).toContain('FOTOGRAMMI');
  });

  it('il watchdog ferma la take con il disco quasi pieno', async () => {
    const { regia, obs } = prepara();
    await regia.comando('avviaFerma', 'test');
    obs.stat = { ...obs.stat, discoLiberoMb: 2000 }; // sotto i 5 GB predefiniti
    await (regia as unknown as { controllaWatchdog(): Promise<void> }).controllaWatchdog();
    await regia.comando('capitolo', 'test');
    expect(regia.stato.fase).toBe('fermo');
    expect(regia.stato.allarme?.testo).toContain('DISCO');
  });

  it('se in Reaper si apre un altro progetto, la take dopo apre una sessione nuova da 01', async () => {
    const { regia } = prepara();
    await regia.comando('avviaFerma', 'test');
    invecchia(regia, 2000);
    await regia.comando('avviaFerma', 'test');
    const prima = regia.stato.sessione!.id;
    expect(regia.stato.takes).toHaveLength(1);

    reaperSimulato.progetto = 'un-altro-progetto';
    await regia.comando('avviaFerma', 'test');
    expect(regia.stato.sessione!.id).not.toBe(prima);
    expect(regia.stato.corrente?.take.numero).toBe(1);
  });

  it('con "continua la numerazione" il cambio di progetto non apre una sessione nuova', async () => {
    const { regia, imp } = prepara();
    imp.reaper.cambioProgetto = 'continua';
    await regia.comando('avviaFerma', 'test');
    invecchia(regia, 2000);
    await regia.comando('avviaFerma', 'test');
    const prima = regia.stato.sessione!.id;
    reaperSimulato.progetto = 'ancora-un-altro';
    await regia.comando('avviaFerma', 'test');
    expect(regia.stato.sessione!.id).toBe(prima);
    expect(regia.stato.corrente?.take.numero).toBe(2);
  });

  it('i capitoli seguono la scaletta', async () => {
    const { regia, imp } = prepara();
    // Come nell'app: la scaletta sta nelle impostazioni e la sessione nuova la rilegge.
    imp.scaletta = ['Intro', 'Accordi', 'Ritmica'];
    await regia.comando('avviaFerma', 'test');
    expect(regia.stato.ultimoMarker?.etichetta).toBe('Intro');
    await regia.comando('capitolo', 'test');
    expect(regia.stato.ultimoMarker?.etichetta).toBe('Accordi');
    expect(regia.stato.scaletta.indice).toBe(1);
  });
});
