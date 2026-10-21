// Pre-flight: tutto quello che deve essere a posto prima del REC. Ogni
// controllo ha un esito (ok, avviso, errore) e, se serve, un'azione per
// risolverlo. Un errore blocca la take; un avviso no.

import { backend, formattaByte, messaggioErrore, type InfoFfmpeg } from './backend';
import type { RecordingEngine } from './engine/RecordingEngine';
import type { StatoMidi } from './midi';
import type { Impostazioni, Preset } from './model';
import { risolviCartella } from './naming';

export type EsitoControllo = 'ok' | 'avviso' | 'errore';

export type AzionePreflight =
  | 'connettiObs'
  | 'riapplica'
  | 'editor'
  | 'impostazioni'
  | 'pedale'
  | 'installaFfmpeg'
  | 'libreria'
  | 'armaTracce'
  | 'patchbay';

export interface Controllo {
  id: string;
  titolo: string;
  esito: EsitoControllo;
  dettaglio: string;
  azione?: { tipo: AzionePreflight; etichetta: string };
}

export interface ContestoPreflight {
  motore: RecordingEngine;
  preset: Preset | null;
  impostazioni: Impostazioni;
  pedale: { stato: StatoMidi; dispositivi: string[] };
  ffmpeg: InfoFfmpeg | null;
}

const ok = (id: string, titolo: string, dettaglio: string): Controllo => ({ id, titolo, esito: 'ok', dettaglio });

/** Un controllo che fallisce per un'eccezione diventa un avviso, mai un blocco silenzioso. */
async function prova(id: string, titolo: string, f: () => Promise<Controllo>): Promise<Controllo> {
  try {
    return await f();
  } catch (e) {
    return { id, titolo, esito: 'avviso', dettaglio: `Controllo non riuscito: ${messaggioErrore(e)}` };
  }
}

export async function eseguiPreflight(c: ContestoPreflight): Promise<Controllo[]> {
  const { motore, preset: p, impostazioni: imp } = c;
  const connesso = motore.statoConnessione === 'connesso';
  const usaReaper = !!p && p.reaper.modalita !== 'disattivato';

  const base: Controllo[] = [
    connesso
      ? ok('obs', 'OBS', `Connesso${motore.info ? ` (OBS ${motore.info.versioneMotore})` : ''}`)
      : {
          id: 'obs',
          titolo: 'OBS',
          esito: 'errore',
          dettaglio: 'Non connesso: senza OBS non si registra il video.',
          azione: { tipo: 'connettiObs', etichetta: 'Connetti' },
        },
    p
      ? ok('preset', 'Preset', `"${p.nome}" applicato`)
      : { id: 'preset', titolo: 'Preset', esito: 'errore', dettaglio: 'Nessun preset applicato: scegline uno nella lista a sinistra.' },
  ];
  if (!connesso || !p) return base;

  const ist = await motore.istantanea().catch(() => null);
  const cartella = ist?.cartellaRegistrazione || risolviCartella(p.output.cartella, { preset: p.nome, quando: new Date() });

  const controlli = await Promise.all([
    prova('coerenza', 'Configurazione OBS', async () => {
      const diversi = [
        p.obs.sceneCollection && p.obs.sceneCollection !== ist?.collezione ? 'collezione' : '',
        p.obs.profilo && p.obs.profilo !== ist?.profilo ? 'profilo' : '',
        p.obs.scena && p.obs.scena !== ist?.scena ? 'scena' : '',
      ].filter(Boolean);
      return diversi.length
        ? {
            id: 'coerenza',
            titolo: 'Configurazione OBS',
            esito: 'avviso',
            dettaglio: `In OBS ${diversi.join(', ')} non corrisponde al preset.`,
            azione: { tipo: 'riapplica', etichetta: 'Riapplica il preset' },
          }
        : ok('coerenza', 'Configurazione OBS', `${ist?.collezione} · ${ist?.profilo} · ${ist?.scena}`);
    }),

    prova('cartella', 'Cartella di output', async () => {
      const r = await backend.assicuraCartella(cartella);
      return r.scrivibile
        ? ok('cartella', 'Cartella di output', cartella)
        : {
            id: 'cartella',
            titolo: 'Cartella di output',
            esito: 'errore',
            dettaglio: r.errore ?? `Non si può scrivere in ${cartella}.`,
            azione: { tipo: 'editor', etichetta: 'Cambia cartella' },
          };
    }),

    prova('disco', 'Spazio su disco', async () => {
      const d = await backend.spazioDisco(cartella);
      const soglia = imp.sicurezza.discoMinimoGb * 1024 ** 3;
      const esito: EsitoControllo = d.libero < soglia ? 'errore' : d.libero < soglia * 3 ? 'avviso' : 'ok';
      return {
        id: 'disco',
        titolo: 'Spazio su disco',
        esito,
        dettaglio: `${formattaByte(d.libero)} liberi su ${d.misuratoSu}${esito === 'ok' ? '' : ` (minimo ${imp.sicurezza.discoMinimoGb} GB)`}`,
        azione: esito === 'ok' ? undefined : { tipo: 'libreria', etichetta: 'Libera spazio' },
      };
    }),

    prova('encoder', 'Encoder', async () => {
      const enc = await motore.encoder();
      const software = /x264|x265|aom|svt|rav1e/i.test(enc);
      const altezza = Number(ist?.video?.uscita.split('×')[1] ?? 0);
      if (!enc) return { id: 'encoder', titolo: 'Encoder', esito: 'avviso', dettaglio: 'Non riesco a leggere l’encoder di registrazione dal profilo di OBS.' };
      if (software && altezza >= 2160) {
        return {
          id: 'encoder',
          titolo: 'Encoder',
          esito: 'avviso',
          dettaglio: `"${enc}" è un encoder software: in 4K rischia di perdere fotogrammi. Meglio uno hardware (NVENC, AMF, QuickSync).`,
        };
      }
      return ok('encoder', 'Encoder', `${enc}${ist?.video ? ` · ${ist.video.uscita} a ${+ist.video.fps.toFixed(2)} fps` : ''}`);
    }),

    prova('fotogrammi', 'Fotogrammi persi', async () => {
      const s = await motore.statistiche();
      const render = s.renderTotali ? (s.renderSaltati / s.renderTotali) * 100 : 0;
      const uscita = s.uscitaTotali ? (s.uscitaSaltati / s.uscitaTotali) * 100 : 0;
      const peggiore = Math.max(render, uscita);
      const dettaglio = `${peggiore.toFixed(2)}% da quando OBS è aperto · CPU ${s.cpu.toFixed(0)}% · ${s.fps.toFixed(1)} fps`;
      return peggiore >= 1
        ? { id: 'fotogrammi', titolo: 'Fotogrammi persi', esito: 'avviso', dettaglio: `${dettaglio}. OBS è sotto carico: chiudi programmi pesanti o abbassa la qualità.` }
        : ok('fotogrammi', 'Fotogrammi persi', dettaglio);
    }),

    prova('cfr', 'Frame rate costante', async () => {
      const r = await motore.controllaFrameRate();
      return { id: 'cfr', titolo: 'Frame rate costante', esito: r.ok ? 'ok' : 'avviso', dettaglio: r.dettaglio };
    }),

    prova('audio', 'Sorgenti audio', async () => {
      const sorgenti = ist?.sorgentiAudio ?? [];
      const guida = p.obs.tracciaGuida ? sorgenti.find((s) => s.nome === p.obs.tracciaGuida) : undefined;
      if (p.obs.tracciaGuida && !guida) {
        return {
          id: 'audio',
          titolo: 'Sorgenti audio',
          esito: 'avviso',
          dettaglio: `La traccia guida "${p.obs.tracciaGuida}" non c'è in OBS: il sync userà la prima traccia del video.`,
          azione: { tipo: 'editor', etichetta: 'Modifica preset' },
        };
      }
      if (guida?.muta) {
        return {
          id: 'audio',
          titolo: 'Sorgenti audio',
          esito: 'errore',
          dettaglio: `La traccia guida "${guida.nome}" è mutata in OBS: il sync non avrebbe riferimento.`,
          azione: { tipo: 'patchbay', etichetta: 'Vedi la patchbay' },
        };
      }
      const mute = sorgenti.filter((s) => s.muta).map((s) => s.nome);
      return mute.length
        ? { id: 'audio', titolo: 'Sorgenti audio', esito: 'avviso', dettaglio: `Mutate in OBS: ${mute.join(', ')}. Va bene se è voluto.` }
        : ok('audio', 'Sorgenti audio', sorgenti.length ? `${sorgenti.length} sorgenti, nessuna mutata` : 'Nessuna sorgente audio in OBS');
    }),

    prova('reaper', 'Reaper', async () => {
      if (!usaReaper) return ok('reaper', 'Reaper', 'Non usato da questo preset');
      let st;
      try {
        st = await backend.reaperStato(imp.reaper);
      } catch (e) {
        return {
          id: 'reaper',
          titolo: 'Reaper',
          esito: 'errore',
          dettaglio: messaggioErrore(e),
          azione: { tipo: 'impostazioni', etichetta: 'Impostazioni Reaper' },
        };
      }
      const armate = st.tracce.filter((t) => t.armata).length;
      if (armate === 0) {
        return p.reaper.armaTracce
          ? {
              id: 'reaper',
              titolo: 'Reaper',
              esito: 'avviso',
              dettaglio: `Nessuna traccia armata su ${st.tracce.length}: all'avvio verranno armate tutte.`,
              azione: { tipo: 'armaTracce', etichetta: 'Armale ora' },
            }
          : {
              id: 'reaper',
              titolo: 'Reaper',
              esito: 'errore',
              dettaglio: `Nessuna traccia armata su ${st.tracce.length}: Reaper non registrerebbe niente.`,
              azione: { tipo: 'armaTracce', etichetta: 'Arma tutte' },
            };
      }
      return ok('reaper', 'Reaper', `Raggiungibile, ${armate}/${st.tracce.length} tracce armate`);
    }),

    prova('bridge', 'Script bridge', async () => {
      const serve = usaReaper && (p.reaper.segni !== 'niente' || p.sync.automatico);
      if (!serve) return ok('bridge', 'Script bridge', 'Non serve con questo preset');
      if (!imp.reaper.bridgeId) {
        return {
          id: 'bridge',
          titolo: 'Script bridge',
          esito: 'avviso',
          dettaglio: 'Non installato: niente region in Reaper e niente sync automatico.',
          azione: { tipo: 'impostazioni', etichetta: 'Installa' },
        };
      }
      const r = await backend.reaperBridge(imp.reaper, imp.reaper.bridgeId, ['ping', 'preflight']);
      return r === 'pong preflight'
        ? ok('bridge', 'Script bridge', 'Risponde')
        : { id: 'bridge', titolo: 'Script bridge', esito: 'avviso', dettaglio: `Risposta inattesa: ${r}`, azione: { tipo: 'impostazioni', etichetta: 'Impostazioni' } };
    }),

    prova('replay', 'Replay buffer', async () => {
      if (!p.transport.replayBuffer) return ok('replay', 'Replay buffer', 'Non usato da questo preset');
      const r = await motore.statoReplay();
      return !r.disponibile
        ? {
            id: 'replay',
            titolo: 'Replay buffer',
            esito: 'avviso',
            dettaglio: 'Non abilitato in OBS: Impostazioni › Uscita › Buffer di replay, poi riapplica il preset.',
            azione: { tipo: 'riapplica', etichetta: 'Riapplica' },
          }
        : ok('replay', 'Replay buffer', r.attivo ? `Attivo, ${Math.round(r.secondiMax / 60)} minuti` : 'Abilitato ma fermo: si riavvia da solo');
    }),

    // Il backtrack del canvas verticale non ha un buffer suo: usa quello
    // principale di OBS. Senza, OBS alza un dialogo modale a ogni REC.
    prova('backtrack', 'Backtrack verticale', async () => {
      const bt = await backend.backtrackVerticale(imp.obs.cartellaConfig);
      if (!bt.installato) return ok('backtrack', 'Backtrack verticale', 'Plugin Aitum Vertical non installato');
      if (!bt.attivo) return ok('backtrack', 'Backtrack verticale', 'Spento nel canvas verticale');
      const r = await motore.statoReplay();
      return r.disponibile
        ? ok('backtrack', 'Backtrack verticale', `Acceso, ${bt.secondi} s${r.attivo ? '' : ' (parte con il buffer di replay)'}`)
        : {
            id: 'backtrack',
            titolo: 'Backtrack verticale',
            esito: 'avviso',
            dettaglio:
              'Acceso nel canvas verticale ma in OBS il Buffer di replay è disattivato: a ogni REC compare l’errore ' +
              '«no replay buffer found» e il verticale non viene registrato. Abilita il Buffer di replay in OBS › ' +
              'Impostazioni › Uscita, oppure spegni il backtrack nel pannello Vertical.',
          };
    }),

    prova('pedale', 'Pedale MIDI', async () => {
      const { mappa, dispositivo } = imp.pedale;
      const collegato = dispositivo ? c.pedale.dispositivi.includes(dispositivo) : c.pedale.dispositivi.length > 0;
      if (c.pedale.stato === 'pronto' && mappa.avviaFerma && collegato) {
        return ok('pedale', 'Pedale MIDI', dispositivo || c.pedale.dispositivi[0]);
      }
      const motivo = !mappa.avviaFerma ? 'avvia/ferma non è assegnato' : c.pedale.stato !== 'pronto' ? 'MIDI non attivo' : 'pedale non collegato';
      return {
        id: 'pedale',
        titolo: 'Pedale MIDI',
        esito: 'avviso',
        dettaglio: `${motivo[0].toUpperCase()}${motivo.slice(1)}: restano i tasti (${imp.tastiera.mappa.avviaFerma || 'nessuno'}).`,
        azione: { tipo: 'pedale', etichetta: 'Configura' },
      };
    }),

    prova('ffmpeg', 'ffmpeg', async () => {
      if (!c.ffmpeg?.trovato) {
        return {
          id: 'ffmpeg',
          titolo: 'ffmpeg',
          esito: 'avviso',
          dettaglio: 'Non trovato: niente sync né post-produzione. Takeline può procurarselo da solo.',
          azione: { tipo: 'installaFfmpeg', etichetta: 'Installa ffmpeg' },
        };
      }
      // Sync, capitoli, proxy e loudnorm passano da ffprobe, che Takeline cerca
      // accanto a ffmpeg: le copie incluse in altri programmi spesso non ce l'hanno.
      return c.ffmpeg.ffprobe
        ? ok('ffmpeg', 'ffmpeg', `Versione ${c.ffmpeg.versione ?? 'sconosciuta'}`)
        : {
            id: 'ffmpeg',
            titolo: 'ffmpeg',
            esito: 'avviso',
            dettaglio:
              'ffmpeg c’è ma ffprobe manca nella stessa cartella: sync, capitoli, proxy e normalizzazione ' +
              'falliranno. Questa è una build parziale, inclusa in un altro programma: meglio installarne una completa.',
            azione: { tipo: 'installaFfmpeg', etichetta: 'Installa ffmpeg' },
          };
    }),
  ]);
  return [...base, ...controlli];
}

/** Il primo errore, da mostrare in stage view se la take non puo' partire. */
export function primoErrore(controlli: Controllo[]) {
  return controlli.find((x) => x.esito === 'errore') ?? null;
}
