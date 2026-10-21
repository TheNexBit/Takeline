// Solo sviluppo: permette di aprire l'interfaccia in un browser normale
// (npm run dev, http://localhost:1420) senza il backend Tauri. Le chiamate al
// backend rispondono con dati finti; OBS invece e' quello vero, se e' aperto.

import { mockIPC } from '@tauri-apps/api/mocks';

const documenti: Record<string, unknown> = {};
const sessioni: Record<string, unknown>[] = [];
const takes: Record<string, unknown>[] = [];
const reaper = { stato: 0, inizio: 0 };

/** Stato del Reaper simulato, modificabile dai test (es. aprire un altro progetto). */
export const reaperSimulato = { progetto: '', azioni: [] as string[] };

export function installa() {
  (window as { __TAKELINE_ANTEPRIMA__?: boolean }).__TAKELINE_ANTEPRIMA__ = true;
  mockIPC((cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    const posizione = reaper.stato === 5 ? (Date.now() - reaper.inizio) / 1000 : 0;
    switch (cmd) {
      case 'reaper_progetto':
        if (typeof a.valore === 'string') reaperSimulato.progetto = a.valore;
        return reaperSimulato.progetto;
      case 'reaper_action':
        reaperSimulato.azioni.push(String(a.azione));
        if (a.azione === '1013') Object.assign(reaper, { stato: 5, inizio: Date.now() });
        if (a.azione === '1016') reaper.stato = 0;
        return null;
      case 'reaper_bridge':
        return (a.campi as string[])[0] === 'ping' ? 'pong takeline' : 'ok';
      case 'sessione_apri': {
        const s = { id: sessioni.length + 1, presetId: a.presetId, titolo: a.titolo, iniziataIl: a.iniziataIl, terminataIl: null, scaletta: a.scaletta };
        sessioni.push(s);
        return s;
      }
      case 'sessione_chiudi':
      case 'take_clap':
        return null;
      case 'sessione_aperta':
        return null;
      case 'sessione_take':
        return takes.filter((t) => t.sessioneId === a.sessioneId);
      case 'take_crea': {
        const numero = Math.max(0, ...takes.filter((t) => t.sessioneId === a.sessioneId).map((t) => t.numero as number)) + 1;
        const t = { id: takes.length + 1, sessioneId: a.sessioneId, numero, tipo: a.tipo, stato: 'registrato', fileVideo: a.fileVideo, iniziatoIl: a.iniziatoIl, durataS: null, reaperInizioS: a.reaperInizioS, reaperFineS: null, clapS: null, marker: 0, fileAudio: null };
        takes.push(t);
        return t;
      }
      case 'take_audio':
        return { ...takes.find((x) => x.id === a.id)!, fileAudio: a.fileAudio };
      case 'take_chiudi':
      case 'take_stato': {
        const t = takes.find((x) => x.id === a.id)!;
        if (cmd === 'take_stato') t.stato = a.stato;
        else Object.assign(t, { fileVideo: a.fileVideo ?? t.fileVideo, durataS: a.durataS, reaperFineS: a.reaperFineS });
        return { ...t };
      }
      case 'libreria_take': {
        const file = (n: string, mb: number, ruolo = 'originale') => ({ ruolo, percorso: 'C:\\Video\\' + n, byte: mb * 1024 ** 2, esiste: true });
        const voce = (id: number, numero: number, stato: string, files: ReturnType<typeof file>[]) => ({
          takeId: id, sessioneId: id < 4 ? 2 : 1, presetId: 'video-musicale', titolo: 'Blues in La', sessioneIl: '2026-10-21T10:00:00Z',
          numero, tipo: 'take', stato, iniziatoIl: '', durataS: 95 + id, sincronizzato: id % 2 === 1, file: files, byte: files.reduce((a, x) => a + x.byte, 0),
        });
        return [
          voce(3, 3, 'buono', [file('take03.mp4', 2300), file('take03_sync.mp4', 2310, 'sync'), file('take03_14LUFS.mp4', 2310, 'loudnorm')]),
          voce(2, 2, 'scartato', [file('take02.mp4', 1800)]),
          voce(1, 1, 'pubblicato', [file('take01.mp4', 4100), file('take01_youtube.mp4', 3000, 'export')]),
          voce(4, 1, 'registrato', [file('take01b.mp4', 900)]),
        ];
      }
      case 'marker_aggiungi':
        return { id: Date.now(), takeId: a.takeId, tipo: a.tipo, tempoS: a.tempoS, reaperS: a.reaperS, etichetta: a.etichetta };
      case 'app_paths':
        return {
          configDir: 'C:\\anteprima\\takeline',
          presetsFile: 'C:\\anteprima\\takeline\\presets.json',
          settingsFile: 'C:\\anteprima\\takeline\\impostazioni.json',
          backupDir: 'C:\\anteprima\\takeline\\backup-obs',
          dbFile: 'C:\\anteprima\\takeline\\takeline.db',
          videoDir: 'C:\\Users\\anteprima\\Videos',
          obsConfigDir: 'C:\\Users\\anteprima\\AppData\\Roaming\\obs-studio',
        };
      case 'doc_load':
        return documenti[a.nome as string] ?? null;
      case 'doc_save':
        documenti[a.nome as string] = a.valore;
        return null;
      case 'reaper_status':
        return {
          stato: reaper.stato,
          posizione,
          posizioneTesto: `${Math.floor(posizione / 60)}:${(posizione % 60).toFixed(3).padStart(6, '0')}`,
          tracce: [
            { numero: 1, nome: 'Chitarra DI', armata: true, muta: false, solo: false, piccoDb: -14 - Math.random() * 6 },
            { numero: 2, nome: 'Chitarra mic', armata: true, muta: false, solo: false, piccoDb: -20 - Math.random() * 6 },
            { numero: 3, nome: 'Click', armata: false, muta: true, solo: false, piccoDb: -150 },
          ],
        };
      case 'disk_space':
        return { misuratoSu: 'C:\\', libero: 412 * 1024 ** 3, totale: 953 * 1024 ** 3 };
      case 'ensure_dir':
        return { creata: false, scrivibile: true, errore: null };
      case 'ffmpeg_info':
        return { trovato: true, ffprobe: true, comando: 'ffmpeg (dal PATH)', versione: '7.1', errore: null };
      case 'db_info':
        return { percorso: 'C:\\anteprima\\takeline\\takeline.db', versioneSchema: 1, take: 0 };
      case 'obs_backtrack_verticale':
        return { installato: true, attivo: true, secondi: 15 };
      case 'obs_backup':
        return { cartella: 'C:\\anteprima\\takeline\\backup-obs\\anteprima', fileCopiati: 7, cartellaObs: '' };
      default:
        return null;
    }
  });
}
