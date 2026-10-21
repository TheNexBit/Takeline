// Applicazione di un preset: configura motore video, cartella, nomi e Reaper
// in un solo gesto. Ogni passo riporta il proprio esito; un errore ferma la
// sequenza. Prima di toccare la configurazione di OBS si fa sempre un backup.

import { backend, messaggioErrore, type ReaperConn } from './backend';
import type { RecordingEngine } from './engine/RecordingEngine';
import type { Preset } from './model';
import { risolviCartella, risolviNome } from './naming';

export type EsitoPasso = 'attesa' | 'in-corso' | 'ok' | 'avviso' | 'errore' | 'saltato';

export interface Passo {
  id: string;
  etichetta: string;
  esito: EsitoPasso;
  dettaglio?: string;
}

export type CampoObs = 'sceneCollection' | 'profilo' | 'scena';

export const ETICHETTA_CAMPO: Record<CampoObs, string> = {
  sceneCollection: 'Scene collection',
  profilo: 'Profilo',
  scena: 'Scena',
};

/** Nome chiesto dal preset che in OBS non c'e', con le alternative esistenti. */
export interface Mancante {
  campo: CampoObs;
  nome: string;
  esistenti: string[];
}

export interface RapportoApplicazione {
  presetId: string;
  passi: Passo[];
  riuscito: boolean;
  /** Si risolvono scegliendo un elemento esistente o creandolo, poi riapplicando. */
  mancanti: Mancante[];
  cartellaBackup?: string;
}

const descriviMancanti = (m: Mancante[]) =>
  m.map((x) => `${ETICHETTA_CAMPO[x.campo].toLowerCase()} "${x.nome}"`).join(', ');

const PASSI: [string, string][] = [
  ['controlli', 'Controlli preliminari'],
  ['backup', 'Backup della configurazione OBS'],
  ['collezione', 'Scene collection'],
  ['profilo', 'Profilo'],
  ['scena', 'Scena'],
  ['cartella', 'Cartella di output'],
  ['nomi', 'Nomi dei file'],
  ['video', 'Frame rate costante'],
  ['replay', 'Replay buffer'],
  ['reaper', 'Reaper'],
];

class ErrorePasso extends Error {}

export async function applicaPreset(
  motore: RecordingEngine,
  preset: Preset,
  opz: { creaMancanti: boolean; titolo: string; reaper: ReaperConn },
  aggiorna: (r: RapportoApplicazione) => void,
): Promise<RapportoApplicazione> {
  const r: RapportoApplicazione = {
    presetId: preset.id,
    passi: PASSI.map(([id, etichetta]) => ({ id, etichetta, esito: 'attesa' })),
    riuscito: false,
    mancanti: [],
  };
  const pubblica = () => aggiorna({ ...r, passi: r.passi.map((p) => ({ ...p })) });
  const imposta = (id: string, esito: EsitoPasso, dettaglio?: string) => {
    const p = r.passi.find((x) => x.id === id)!;
    p.esito = esito;
    p.dettaglio = dettaglio;
    pubblica();
  };
  const passo = async (id: string, fn: () => Promise<[EsitoPasso, string?]>) => {
    imposta(id, 'in-corso');
    try {
      const [esito, dettaglio] = await fn();
      imposta(id, esito, dettaglio);
    } catch (e) {
      imposta(id, 'errore', messaggioErrore(e));
      throw new ErrorePasso();
    }
  };

  const { obs } = preset;
  try {
    let cambiaCollezione = false;
    let cambiaProfilo = false;
    let replayDaFermare = false;

    await passo('controlli', async () => {
      if (motore.statoConnessione !== 'connesso') throw new Error(`${motore.nome} non è connesso.`);
      const s = await motore.istantanea();
      if (s.registrazione.attiva) throw new Error('Registrazione in corso: fermala prima di cambiare preset.');
      if (s.diretta) throw new Error('Diretta in corso: fermala prima di cambiare preset.');
      cambiaCollezione = !!obs.sceneCollection && obs.sceneCollection !== s.collezione;
      cambiaProfilo = !!obs.profilo && obs.profilo !== s.profilo;
      replayDaFermare = (cambiaCollezione || cambiaProfilo) && s.replayBuffer.attivo;
      if (cambiaCollezione && !s.collezioni.includes(obs.sceneCollection)) {
        r.mancanti.push({ campo: 'sceneCollection', nome: obs.sceneCollection, esistenti: s.collezioni });
      }
      if (cambiaProfilo && !s.profili.includes(obs.profilo)) {
        r.mancanti.push({ campo: 'profilo', nome: obs.profilo, esistenti: s.profili });
      }
      if (r.mancanti.length && !opz.creaMancanti) {
        throw new Error(`In OBS non esistono: ${descriviMancanti(r.mancanti)}. Scegli cosa usare qui sotto.`);
      }
      return ['ok', r.mancanti.length ? `Verranno creati: ${descriviMancanti(r.mancanti)}` : undefined];
    });

    await passo('backup', async () => {
      const b = await motore.backup(`preset ${preset.nome}`);
      r.cartellaBackup = b.cartella;
      return ['ok', `${b.fileCopiati} file salvati in ${b.cartella}`];
    });

    await passo('collezione', async () => {
      // OBS non cambia profilo con le uscite attive. Si riavvia al passo Replay buffer.
      if (replayDaFermare) await motore.fermaReplay();
      if (!obs.sceneCollection) return ['saltato', 'Il preset lascia quella attiva'];
      if (!cambiaCollezione) return ['ok', `"${obs.sceneCollection}" già attiva`];
      await motore.cambiaCollezione(obs.sceneCollection, { crea: opz.creaMancanti });
      return ['ok', `Attivata "${obs.sceneCollection}", OBS ha ricaricato`];
    });

    await passo('profilo', async () => {
      if (!obs.profilo) return ['saltato', 'Il preset lascia quello attivo'];
      if (!cambiaProfilo) return ['ok', `"${obs.profilo}" già attivo`];
      await motore.cambiaProfilo(obs.profilo, { crea: opz.creaMancanti });
      return ['ok', `Attivato "${obs.profilo}"`];
    });

    await passo('scena', async () => {
      if (!obs.scena) return ['saltato', 'Il preset lascia quella attiva'];
      const esito = await motore.cambiaScena(obs.scena, { crea: opz.creaMancanti });
      if (esito === 'mancante') {
        const { scene } = await motore.istantanea();
        r.mancanti.push({ campo: 'scena', nome: obs.scena, esistenti: scene });
        return ['avviso', `La scena "${obs.scena}" non esiste in questa collezione`];
      }
      return ['ok', esito === 'creata' ? `Creata e attivata "${obs.scena}" (vuota: aggiungi le sorgenti)` : `"${obs.scena}" in onda`];
    });

    const quando = new Date();
    await passo('cartella', async () => {
      const cartella = risolviCartella(preset.output.cartella, { preset: preset.nome, quando });
      if (!cartella) throw new Error('Il preset non ha una cartella di output.');
      const c = await backend.assicuraCartella(cartella);
      if (!c.scrivibile) throw new Error(c.errore ?? `Impossibile scrivere in ${cartella}`);
      await motore.impostaCartella(cartella);
      return ['ok', `${c.creata ? 'Creata: ' : ''}${cartella}`];
    });

    await passo('nomi', async () => {
      const ctx = { preset: preset.nome, titolo: opz.titolo, take: 1, quando };
      const formato = await motore.impostaNomeFile(preset.output.templateNome, ctx);
      return ['ok', `Esempio: ${risolviNome(preset.output.templateNome, ctx)} (formato OBS: ${formato})`];
    });

    await passo('video', async () => {
      const fr = await motore.controllaFrameRate();
      return [fr.ok ? 'ok' : 'avviso', fr.dettaglio];
    });

    await passo('replay', async () => {
      if (!preset.transport.replayBuffer) return ['saltato', 'Non usato da questo preset'];
      const st = await motore.configuraReplay(preset.transport.replayMinuti * 60);
      if (!st.disponibile) {
        return ['avviso', 'Non abilitato in questo profilo: in OBS apri Impostazioni › Uscita, attiva il Buffer di replay e riapplica il preset'];
      }
      const nota = replayDaFermare ? ' (era stato fermato per il cambio di profilo)' : '';
      return ['ok', `Attivo, conserva gli ultimi ${Math.round(st.secondiMax / 60)} minuti${nota}`];
    });

    await passo('reaper', async () => {
      if (preset.reaper.modalita === 'disattivato') return ['saltato', 'Non usato da questo preset'];
      try {
        const st = await backend.reaperStato(opz.reaper);
        const armate = st.tracce.filter((t) => t.armata).length;
        if (armate === 0 && !preset.reaper.armaTracce) {
          return ['avviso', `Raggiungibile, ma nessuna traccia armata su ${st.tracce.length}`];
        }
        return ['ok', `Raggiungibile, ${armate}/${st.tracce.length} tracce armate`];
      } catch (e) {
        return ['avviso', `${messaggioErrore(e)} Il preset è applicato lo stesso.`];
      }
    });

    r.riuscito = true;
  } catch (e) {
    if (!(e instanceof ErrorePasso)) throw e;
    for (const p of r.passi) if (p.esito === 'attesa') p.esito = 'saltato';
  }
  pubblica();
  return r;
}
