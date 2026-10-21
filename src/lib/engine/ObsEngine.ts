// OBS Studio pilotato esclusivamente via obs-websocket v5.
//
// Il cambio di scene collection (e di profilo) fa ricaricare OBS: la
// richiesta puo' restare appesa o la connessione cadere. Per questo dopo ogni
// cambio si interroga OBS finche' non conferma il nuovo stato, con un timeout.

import OBSWebSocket, { EventSubscription, OBSWebSocketError } from 'obs-websocket-js';
import type { OBSResponseTypes } from 'obs-websocket-js';

import { backend, messaggioErrore } from '../backend';
import type { Impostazioni } from '../model';
import { templatePerObs, type ContestoNome } from '../naming';
import type {
  EventoMotore,
  InfoMotore,
  IstantaneaMotore,
  OpzioniCambio,
  RecordingEngine,
  SorgenteAudio,
  StatoConnessione,
} from './RecordingEngine';

type ConfigObs = Impostazioni['obs'];

// Codici di obs-websocket usati qui.
const NON_PRONTO = 207;
const RICHIESTA_SCONOSCIUTA = 204;
const AUTENTICAZIONE_FALLITA = 4009;

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

function conTimeout<T>(p: Promise<T>, ms: number, cosa: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scadenza = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`Timeout (${Math.round(ms / 1000)} s): ${cosa}`)), ms);
  });
  return Promise.race([p, scadenza]).finally(() => clearTimeout(timer));
}

function spiegaErroreConnessione(e: unknown, url: string): string {
  if (e instanceof OBSWebSocketError && e.code === AUTENTICAZIONE_FALLITA) {
    return 'Password di obs-websocket errata: controllala in Impostazioni.';
  }
  const dettaglio = messaggioErrore(e).trim();
  return (
    `OBS non raggiungibile su ${url}. Apri OBS e attiva il server in ` +
    `Strumenti › Impostazioni server WebSocket.${dettaglio && dettaglio !== '{}' ? ` (${dettaglio})` : ''}`
  );
}

type Risposta<K extends keyof OBSResponseTypes> = OBSResponseTypes[K];

export class ObsEngine implements RecordingEngine {
  readonly nome = 'OBS Studio';

  private obs = new OBSWebSocket();
  private _stato: StatoConnessione = 'disconnesso';
  private _info: InfoMotore | null = null;
  private ascoltatori = new Set<(e: EventoMotore) => void>();
  private connessioneInCorso: Promise<InfoMotore> | null = null;
  /** L'utente vuole restare connesso: se la connessione cade si riprova. */
  private voluta = false;
  private timerRiconnessione: ReturnType<typeof setTimeout> | null = null;
  private timerCambio: ReturnType<typeof setTimeout> | null = null;
  private ricaricoGuidato = false;
  private ultimiLivelli = 0;

  constructor(private config: () => ConfigObs) {
    this.registraEventi();
  }

  get statoConnessione() {
    return this._stato;
  }

  get info() {
    return this._info;
  }

  ascolta(listener: (e: EventoMotore) => void) {
    this.ascoltatori.add(listener);
    return () => void this.ascoltatori.delete(listener);
  }

  private emetti(e: EventoMotore) {
    for (const l of this.ascoltatori) l(e);
  }

  private impostaStato(stato: StatoConnessione, motivo?: string) {
    if (this._stato === stato && !motivo) return;
    this._stato = stato;
    this.emetti({ tipo: 'connessione', stato, motivo });
  }

  // --- connessione -------------------------------------------------------

  connetti() {
    this.voluta = true;
    return this.assicuraConnessione();
  }

  async disconnetti() {
    this.voluta = false;
    if (this.timerRiconnessione) clearTimeout(this.timerRiconnessione);
    this.timerRiconnessione = null;
    await this.obs.disconnect().catch(() => {});
    this.impostaStato('disconnesso');
  }

  private assicuraConnessione(): Promise<InfoMotore> {
    if (this.connessioneInCorso) return this.connessioneInCorso;
    this.connessioneInCorso = (async () => {
      if (this.timerRiconnessione) clearTimeout(this.timerRiconnessione);
      this.timerRiconnessione = null;
      if (!this.ricaricoGuidato) this.impostaStato('connessione');
      const { url, password } = this.config();
      try {
        const hello = await conTimeout(
          this.obs.connect(url, password || undefined, {
            rpcVersion: 1,
            eventSubscriptions: EventSubscription.All | EventSubscription.InputVolumeMeters,
          }),
          5000,
          'connessione a OBS',
        );
        const v = await this.obs.call('GetVersion');
        this._info = {
          motore: this.nome,
          versioneMotore: v.obsVersion,
          versioneProtocollo: hello.obsWebSocketVersion,
          piattaforma: v.platformDescription,
        };
        if (!this.ricaricoGuidato) this.impostaStato('connesso');
        return this._info;
      } catch (e) {
        const motivo = spiegaErroreConnessione(e, url);
        if (e instanceof OBSWebSocketError && e.code === AUTENTICAZIONE_FALLITA) this.voluta = false;
        await this.obs.disconnect().catch(() => {});
        if (!this.ricaricoGuidato) this.impostaStato('disconnesso', motivo);
        this.programmaRiconnessione();
        throw new Error(motivo);
      } finally {
        this.connessioneInCorso = null;
      }
    })();
    return this.connessioneInCorso;
  }

  private programmaRiconnessione() {
    if (!this.voluta || this.timerRiconnessione || this.ricaricoGuidato) return;
    this.timerRiconnessione = setTimeout(() => {
      this.timerRiconnessione = null;
      if (this.voluta && !this.obs.identified) this.assicuraConnessione().catch(() => {});
    }, 3000);
  }

  private registraEventi() {
    const cambiato = () => {
      if (this.timerCambio) clearTimeout(this.timerCambio);
      this.timerCambio = setTimeout(() => this.emetti({ tipo: 'cambiato' }), 120);
    };

    this.obs.on('ConnectionClosed', (err) => {
      if (this.connessioneInCorso || this.ricaricoGuidato) return;
      this.impostaStato('disconnesso', this.voluta ? `Connessione a OBS persa (${err.message || err.code}).` : undefined);
      this.programmaRiconnessione();
    });
    this.obs.on('ExitStarted', () => this.impostaStato('disconnesso', 'OBS si sta chiudendo.'));

    // Cambi fatti a mano in OBS: anche questi ricaricano tutto.
    this.obs.on('CurrentSceneCollectionChanging', () => this.impostaStato('ricarico'));
    this.obs.on('CurrentProfileChanging', () => this.impostaStato('ricarico'));
    const finitoRicarico = () => {
      if (!this.ricaricoGuidato) this.impostaStato('connesso');
      cambiato();
    };
    this.obs.on('CurrentSceneCollectionChanged', finitoRicarico);
    this.obs.on('CurrentProfileChanged', finitoRicarico);

    this.obs.on('SceneCollectionListChanged', cambiato);
    this.obs.on('ProfileListChanged', cambiato);
    this.obs.on('CurrentProgramSceneChanged', cambiato);
    this.obs.on('SceneListChanged', cambiato);
    this.obs.on('RecordStateChanged', ({ outputActive, outputState, outputPath }) => {
      if (outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED' || outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
        this.emetti({ tipo: 'registrazione', attiva: outputActive, file: outputPath ?? null });
      }
      cambiato();
    });
    this.obs.on('StreamStateChanged', cambiato);
    this.obs.on('ReplayBufferStateChanged', ({ outputActive, outputState }) => {
      if (outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED' || outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
        this.emetti({ tipo: 'replay', attivo: outputActive });
      }
      cambiato();
    });
    this.obs.on('ReplayBufferSaved', ({ savedReplayPath }) => this.emetti({ tipo: 'replaySalvato', file: savedReplayPath }));
    this.obs.on('InputMuteStateChanged', cambiato);
    this.obs.on('InputCreated', cambiato);
    this.obs.on('InputRemoved', cambiato);
    this.obs.on('InputNameChanged', cambiato);

    this.obs.on('InputVolumeMeters', ({ inputs }) => {
      const ora = performance.now();
      if (ora - this.ultimiLivelli < 80) return;
      this.ultimiLivelli = ora;
      const picchiDb: Record<string, number> = {};
      for (const input of inputs as { inputName: string; inputLevelsMul: number[][] }[]) {
        const picco = Math.max(0, ...input.inputLevelsMul.map((canale) => canale[1] ?? 0));
        picchiDb[input.inputName] = picco > 0 ? 20 * Math.log10(picco) : -100;
      }
      this.emetti({ tipo: 'livelli', picchiDb });
    });
  }

  /** Interroga OBS finche' `pronto` non conferma il nuovo stato, o scade il timeout. */
  private async attendi(pronto: () => Promise<boolean>, dopo: string) {
    const secondi = this.config().timeoutRicaricoSec;
    const fine = Date.now() + secondi * 1000;
    let ultimo = '';
    while (Date.now() < fine) {
      try {
        if (!this.obs.identified) await this.assicuraConnessione();
        if (await conTimeout(pronto(), 3000, 'risposta di OBS')) return;
      } catch (e) {
        ultimo = messaggioErrore(e);
      }
      await pausa(400);
    }
    throw new Error(
      `OBS non ha risposto entro ${secondi} s dopo ${dopo}.` +
        (ultimo ? ` Ultimo errore: ${ultimo}.` : '') +
        ' Controlla che OBS sia ancora aperto: la configurazione precedente è nel backup.',
    );
  }

  /** Esegue un cambio che ricarica OBS e attende che torni a rispondere. */
  private async cambioConRicarico(richiesta: () => Promise<unknown>, pronto: () => Promise<boolean>, cosa: string) {
    this.ricaricoGuidato = true;
    this.impostaStato('ricarico');
    try {
      try {
        await conTimeout(richiesta(), this.config().timeoutRicaricoSec * 1000, cosa);
      } catch (e) {
        // Rifiuto vero (non timeout ne' connessione caduta): inutile aspettare.
        if (e instanceof OBSWebSocketError && this.obs.identified && e.code !== NON_PRONTO) {
          throw new Error(`OBS ha rifiutato ${cosa}: ${e.message}`);
        }
      }
      await this.attendi(pronto, cosa);
    } finally {
      this.ricaricoGuidato = false;
      if (this.obs.identified) this.impostaStato('connesso');
      else this.programmaRiconnessione();
      this.emetti({ tipo: 'cambiato' });
    }
  }

  // --- lettura stato -----------------------------------------------------

  async istantanea(): Promise<IstantaneaMotore> {
    const r = await this.obs.callBatch(
      [
        { requestType: 'GetSceneCollectionList' },
        { requestType: 'GetProfileList' },
        { requestType: 'GetSceneList', requestData: {} },
        { requestType: 'GetRecordStatus' },
        { requestType: 'GetStreamStatus' },
        { requestType: 'GetReplayBufferStatus' },
        { requestType: 'GetRecordDirectory' },
        { requestType: 'GetInputList', requestData: {} },
        { requestType: 'GetVideoSettings' },
        {
          requestType: 'GetProfileParameter',
          requestData: { parameterCategory: 'Output', parameterName: 'FilenameFormatting' },
        },
      ],
      { haltOnFailure: false },
    );
    const dati = <K extends keyof OBSResponseTypes>(i: number, _tipo: K): Risposta<K> | null =>
      r[i]?.requestStatus.result ? ((r[i] as { responseData?: unknown }).responseData as Risposta<K>) : null;

    const collezioni = dati(0, 'GetSceneCollectionList');
    const profili = dati(1, 'GetProfileList');
    const scene = dati(2, 'GetSceneList');
    const rec = dati(3, 'GetRecordStatus');
    const diretta = dati(4, 'GetStreamStatus');
    const replay = dati(5, 'GetReplayBufferStatus');
    const cartella = dati(6, 'GetRecordDirectory');
    const input = dati(7, 'GetInputList');
    const video = dati(8, 'GetVideoSettings');
    const formato = dati(9, 'GetProfileParameter');

    return {
      collezione: collezioni?.currentSceneCollectionName ?? '',
      collezioni: collezioni?.sceneCollections ?? [],
      profilo: profili?.currentProfileName ?? '',
      profili: profili?.profiles ?? [],
      scena: scene?.currentProgramSceneName ?? '',
      // OBS elenca le scene dal basso verso l'alto.
      scene: (scene?.scenes ?? []).map((s) => String(s.sceneName)).reverse(),
      registrazione: {
        attiva: rec?.outputActive ?? false,
        inPausa: rec?.outputPaused ?? false,
        timecode: rec?.outputTimecode ?? '',
      },
      replayBuffer: { disponibile: replay !== null, attivo: replay?.outputActive ?? false },
      diretta: diretta?.outputActive ?? false,
      cartellaRegistrazione: cartella?.recordDirectory ?? '',
      formatoNomeFile: formato?.parameterValue ?? '',
      sorgentiAudio: await this.sorgentiAudio((input?.inputs ?? []) as { inputName: string; inputKind: string }[]),
      video: video
        ? {
            fps: video.fpsNumerator / video.fpsDenominator,
            base: `${video.baseWidth}×${video.baseHeight}`,
            uscita: `${video.outputWidth}×${video.outputHeight}`,
          }
        : null,
    };
  }

  /** Le sorgenti audio sono quelle per cui GetInputMute risponde. */
  private async sorgentiAudio(inputs: { inputName: string; inputKind: string }[]): Promise<SorgenteAudio[]> {
    if (inputs.length === 0) return [];
    const r = await this.obs.callBatch(
      inputs.map((i) => ({ requestType: 'GetInputMute' as const, requestData: { inputName: i.inputName } })),
      { haltOnFailure: false },
    );
    return inputs.flatMap((i, n) => {
      const esito = r[n];
      if (!esito?.requestStatus.result) return [];
      const muta = Boolean((esito as { responseData?: { inputMuted?: boolean } }).responseData?.inputMuted);
      return [{ nome: i.inputName, tipo: i.inputKind, muta }];
    });
  }

  async backup(motivo: string) {
    const istantanea = await this.istantanea();
    const r = await this.obs.callBatch(
      istantanea.sorgentiAudio.map((s) => ({
        requestType: 'GetInputSettings' as const,
        requestData: { inputName: s.nome },
      })),
      { haltOnFailure: false },
    );
    const impostazioniSorgenti = Object.fromEntries(
      r.map((x, i) => [istantanea.sorgentiAudio[i]?.nome, (x as { responseData?: unknown }).responseData ?? null]),
    );
    return backend.backupObs(
      { creatoIl: new Date().toISOString(), motivo, ...istantanea, impostazioniSorgenti },
      motivo,
      this.config().cartellaConfig,
    );
  }

  // --- modifiche ---------------------------------------------------------

  async cambiaCollezione(nome: string, { crea }: OpzioniCambio) {
    const { currentSceneCollectionName, sceneCollections } = await this.obs.call('GetSceneCollectionList');
    if (currentSceneCollectionName === nome) return;
    const esiste = sceneCollections.includes(nome);
    if (!esiste && !crea) throw new Error(`La scene collection "${nome}" non esiste in OBS.`);
    await this.cambioConRicarico(
      () =>
        esiste
          ? this.obs.call('SetCurrentSceneCollection', { sceneCollectionName: nome })
          : this.obs.call('CreateSceneCollection', { sceneCollectionName: nome }),
      async () => {
        const { currentSceneCollectionName: ora } = await this.obs.call('GetSceneCollectionList');
        if (ora !== nome) return false;
        await this.obs.call('GetSceneList'); // risponde solo a caricamento finito
        return true;
      },
      `il cambio della scene collection "${nome}"`,
    );
  }

  async cambiaProfilo(nome: string, { crea }: OpzioniCambio) {
    const { currentProfileName, profiles } = await this.obs.call('GetProfileList');
    if (currentProfileName === nome) return;
    const esiste = profiles.includes(nome);
    if (!esiste && !crea) throw new Error(`Il profilo "${nome}" non esiste in OBS.`);
    await this.cambioConRicarico(
      () =>
        esiste
          ? this.obs.call('SetCurrentProfile', { profileName: nome })
          : this.obs.call('CreateProfile', { profileName: nome }),
      async () => (await this.obs.call('GetProfileList')).currentProfileName === nome,
      `il cambio del profilo "${nome}"`,
    );
  }

  async cambiaScena(nome: string, { crea }: OpzioniCambio) {
    const { scenes, currentProgramSceneName } = await this.obs.call('GetSceneList');
    if (currentProgramSceneName === nome) return 'ok';
    const esiste = scenes.some((s) => s.sceneName === nome);
    if (!esiste && !crea) return 'mancante';
    if (!esiste) await this.obs.call('CreateScene', { sceneName: nome });
    await this.obs.call('SetCurrentProgramScene', { sceneName: nome });
    return esiste ? 'ok' : 'creata';
  }

  async impostaCartella(percorso: string) {
    try {
      await this.obs.call('SetRecordDirectory', { recordDirectory: percorso });
    } catch (e) {
      if (!(e instanceof OBSWebSocketError && e.code === RICHIESTA_SCONOSCIUTA)) throw e;
      // obs-websocket < 5.3: si scrive direttamente il parametro del profilo.
      const { parameterValue: modo } = await this.obs.call('GetProfileParameter', {
        parameterCategory: 'Output',
        parameterName: 'Mode',
      });
      const [categoria, nome] = modo === 'Advanced' ? ['AdvOut', 'RecFilePath'] : ['SimpleOutput', 'FilePath'];
      await this.obs.call('SetProfileParameter', {
        parameterCategory: categoria,
        parameterName: nome,
        parameterValue: percorso,
      });
    }
  }

  async impostaNomeFile(template: string, ctx: ContestoNome) {
    const formato = templatePerObs(template, ctx);
    await this.obs.call('SetProfileParameter', {
      parameterCategory: 'Output',
      parameterName: 'FilenameFormatting',
      parameterValue: formato,
    });
    return formato;
  }

  // --- registrazione e replay buffer ------------------------------------

  /** Attende il primo evento per cui `filtro` restituisce un valore. */
  private attendiEvento<T>(filtro: (e: EventoMotore) => T | undefined, ms: number, cosa: string): Promise<T> {
    let stacca = () => {};
    const evento = new Promise<T>((ok) => {
      stacca = this.ascolta((e) => {
        const v = filtro(e);
        if (v !== undefined) ok(v);
      });
    });
    return conTimeout(evento, ms, cosa).finally(() => stacca());
  }

  async avviaRegistrazione() {
    const partita = this.attendiEvento(
      (e) => (e.tipo === 'registrazione' && e.attiva ? true : undefined),
      10000,
      'OBS non ha confermato l’avvio della registrazione',
    );
    partita.catch(() => {});
    await this.obs.call('StartRecord');
    await partita;
  }

  async fermaRegistrazione() {
    const chiusa = this.attendiEvento(
      (e) => (e.tipo === 'registrazione' && !e.attiva ? e.file : undefined),
      15000,
      'OBS non ha confermato la chiusura del file',
    );
    chiusa.catch(() => {});
    const { outputPath } = await this.obs.call('StopRecord');
    const file = await chiusa.catch(() => null);
    return file || outputPath || null;
  }

  /** RecRBTime sta in SimpleOutput o in AdvOut a seconda della modalita' di uscita. */
  private async categoriaUscita() {
    const { parameterValue } = await this.obs.call('GetProfileParameter', {
      parameterCategory: 'Output',
      parameterName: 'Mode',
    });
    return parameterValue === 'Advanced' ? 'AdvOut' : 'SimpleOutput';
  }

  async statoReplay() {
    let disponibile = true;
    let attivo = false;
    try {
      attivo = (await this.obs.call('GetReplayBufferStatus')).outputActive;
    } catch {
      disponibile = false; // non abilitato nel profilo
    }
    const { parameterValue, defaultParameterValue } = await this.obs.call('GetProfileParameter', {
      parameterCategory: await this.categoriaUscita(),
      parameterName: 'RecRBTime',
    });
    return { disponibile, attivo, secondiMax: Number(parameterValue ?? defaultParameterValue) || 20 };
  }

  async configuraReplay(secondi: number) {
    await this.obs.call('SetProfileParameter', {
      parameterCategory: await this.categoriaUscita(),
      parameterName: 'RecRBTime',
      parameterValue: String(Math.round(secondi)),
    });
    const st = await this.statoReplay();
    if (st.disponibile && !st.attivo) {
      await this.avviaReplay();
      return { ...st, attivo: true };
    }
    return st;
  }

  async avviaReplay() {
    const partito = this.attendiEvento((e) => (e.tipo === 'replay' && e.attivo ? true : undefined), 8000, 'avvio del replay buffer');
    partito.catch(() => {});
    await this.obs.call('StartReplayBuffer');
    await partito;
  }

  async fermaReplay() {
    const fermo = this.attendiEvento((e) => (e.tipo === 'replay' && !e.attivo ? true : undefined), 8000, 'arresto del replay buffer');
    fermo.catch(() => {});
    await this.obs.call('StopReplayBuffer');
    await fermo;
  }

  async salvaReplay() {
    const salvato = this.attendiEvento(
      (e) => (e.tipo === 'replaySalvato' ? e.file : undefined),
      15000,
      'OBS non ha confermato il salvataggio del replay',
    );
    salvato.catch(() => {});
    await this.obs.call('SaveReplayBuffer');
    return salvato;
  }

  // --- sync ----------------------------------------------------------------

  private async parametro(categoria: string, nome: string) {
    const { parameterValue, defaultParameterValue } = await this.obs.call('GetProfileParameter', {
      parameterCategory: categoria,
      parameterName: nome,
    });
    return parameterValue ?? defaultParameterValue ?? '';
  }

  /**
   * Nei file di OBS gli stream audio sono le tracce registrate (1-6) in
   * ordine. L'uscita semplice ne registra una sola, con tutto il mix.
   */
  async flussoAudio(sorgente: string) {
    if (!sorgente) return { indice: 0, nota: 'Nessuna traccia guida nel preset: uso la prima traccia audio del video.' };
    if ((await this.parametro('Output', 'Mode')) !== 'Advanced') {
      return { indice: 0, nota: 'Uscita semplice di OBS: una sola traccia con tutto il mix, traccia guida compresa.' };
    }
    const maschera = Number(await this.parametro('AdvOut', 'RecTracks')) || 1;
    const registrate = [1, 2, 3, 4, 5, 6].filter((t) => maschera & (1 << (t - 1)));
    const { inputAudioTracks } = await this.obs.call('GetInputAudioTracks', { inputName: sorgente });
    const traccia = registrate.find((t) => (inputAudioTracks as Record<string, boolean>)[String(t)]);
    if (traccia === undefined) {
      return { indice: 0, nota: `"${sorgente}" non va in nessuna traccia registrata: uso la prima traccia audio del video.` };
    }
    return { indice: registrate.indexOf(traccia) };
  }

  async statistiche() {
    const s = await this.obs.call('GetStats');
    return {
      fps: s.activeFps,
      cpu: s.cpuUsage,
      renderSaltati: s.renderSkippedFrames,
      renderTotali: s.renderTotalFrames,
      uscitaSaltati: s.outputSkippedFrames,
      uscitaTotali: s.outputTotalFrames,
      /** Spazio libero dove OBS registra, in MB. */
      discoLiberoMb: s.availableDiskSpace,
    };
  }

  /** Nome dell'encoder di registrazione impostato nel profilo. */
  async encoder() {
    if ((await this.parametro('Output', 'Mode')) === 'Advanced') {
      // "none" = la registrazione usa lo stesso encoder dello streaming.
      const rec = await this.parametro('AdvOut', 'RecEncoder');
      return rec && rec !== 'none' ? rec : this.parametro('AdvOut', 'Encoder');
    }
    // Uscita semplice con qualita' "uguale allo streaming": encoder dello streaming.
    if ((await this.parametro('SimpleOutput', 'RecQuality')) === 'Stream') return this.parametro('SimpleOutput', 'StreamEncoder');
    return (await this.parametro('SimpleOutput', 'RecEncoder')) || this.parametro('SimpleOutput', 'StreamEncoder');
  }

  /**
   * OBS registra sempre a frame rate costante con gli encoder normali; il
   * rischio e' l'uscita personalizzata FFmpeg. Ogni file viene poi
   * verificato dopo la take.
   */
  async controllaFrameRate() {
    const v = await this.obs.call('GetVideoSettings');
    const fps = +(v.fpsNumerator / v.fpsDenominator).toFixed(3);
    if ((await this.parametro('Output', 'Mode')) === 'Advanced' && (await this.parametro('AdvOut', 'RecType')) === 'FFmpeg') {
      return {
        ok: false,
        dettaglio:
          'Registrazione con "Output personalizzato (FFmpeg)": può uscire a frame rate variabile. In OBS › Impostazioni › Uscita › Registrazione scegli il tipo Standard.',
      };
    }
    return { ok: true, dettaglio: `${fps} fps costanti; ogni file viene comunque verificato dopo la take` };
  }
}
