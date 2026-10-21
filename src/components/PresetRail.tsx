import { open, save } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  FileJson,
  GraduationCap,
  Guitar,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Upload,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

import { messaggioErrore } from '../lib/backend';
import { ETICHETTA_MODALITA, ETICHETTA_TIPO, type Preset, type TipoPreset } from '../lib/model';
import { useApp } from '../store/app';
import { ConfermaDialog, ImportaDialog, NuovoPresetDialog } from './PresetDialoghi';
import { Menu, Pulsante } from './ui';

export const ICONA_TIPO: Record<TipoPreset, LucideIcon> = {
  musicale: Guitar,
  formazione: GraduationCap,
  call: Video,
};

function RigaPreset({
  p,
  indice,
  totale,
  aperta,
  onApri,
  onElimina,
}: {
  p: Preset;
  indice: number;
  totale: number;
  aperta: boolean;
  onApri: () => void;
  onElimina: () => void;
}) {
  const { impostazioni, applicando, rapporto, obs } = useApp();
  const { applica, apriEditor, duplicaPreset, spostaPreset, esportaPreset, avvisa } = useApp.getState();
  const Icona = ICONA_TIPO[p.tipo];
  const attivo = impostazioni.presetAttivo === p.id;
  const inApplicazione = applicando && rapporto?.presetId === p.id;
  const errore = (e: unknown) => avvisa('errore', messaggioErrore(e));

  const esporta = async () => {
    const percorso = await save({
      title: `Esporta "${p.nome}"`,
      defaultPath: `${p.nome}.json`,
      filters: [{ name: 'Preset Takeline', extensions: ['json'] }],
    });
    if (percorso) await esportaPreset(p.id, percorso).catch(errore);
  };

  const dettaglio = (k: string, v: string) => (
    <div className="flex min-w-0 gap-3">
      <span className="w-20 shrink-0 text-zinc-500">{k}</span>
      <span className={`truncate ${v ? 'text-zinc-300' : 'italic text-zinc-600'}`}>{v || 'quella attiva'}</span>
    </div>
  );

  return (
    <article
      className={`rounded-lg border transition-colors ${aperta ? 'border-zinc-600 bg-rilievo' : 'border-transparent hover:bg-white/[0.03]'}`}
    >
      <div className="flex items-center gap-2 p-2">
        <button type="button" onClick={onApri} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={aperta}>
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${attivo ? 'bg-zinc-100 text-zinc-900' : 'bg-pannello text-zinc-300'}`}
          >
            <Icona size={18} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-zinc-100">{p.nome}</span>
            <span className="flex items-center gap-2 text-xs text-zinc-500">
              {attivo && (
                <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                  attivo
                </span>
              )}
              <span className="truncate">{ETICHETTA_TIPO[p.tipo]}</span>
            </span>
          </span>
        </button>
        {!aperta && (
          <Pulsante
            piccolo
            variante="fantasma"
            icona={inApplicazione ? Loader2 : Play}
            className={`border border-bordo ${inApplicazione ? '[&>svg]:animate-spin' : ''}`}
            disabled={applicando || obs.stato !== 'connesso'}
            title={obs.stato !== 'connesso' ? 'Connetti OBS per applicare il preset' : attivo ? 'Applica di nuovo' : 'Applica il preset'}
            aria-label="Applica"
            onClick={() => applica(p.id)}
          />
        )}
        <Menu
          icona={MoreHorizontal}
          titolo={`Altre azioni su "${p.nome}"`}
          voci={[
            { etichetta: 'Modifica', icona: Pencil, onClick: () => apriEditor(p.id) },
            { etichetta: 'Duplica', icona: Copy, onClick: () => duplicaPreset(p.id).catch(errore) },
            { etichetta: 'Sposta su', icona: ArrowUp, disabilitata: indice === 0, onClick: () => spostaPreset(p.id, -1).catch(errore) },
            {
              etichetta: 'Sposta giù',
              icona: ArrowDown,
              disabilitata: indice === totale - 1,
              onClick: () => spostaPreset(p.id, 1).catch(errore),
            },
            { etichetta: 'Esporta in un file…', icona: Download, separa: true, onClick: () => void esporta() },
            {
              etichetta: 'Elimina…',
              icona: Trash2,
              pericolo: true,
              separa: true,
              disabilitata: attivo,
              nota: attivo ? 'È il preset attivo: applicane un altro prima' : undefined,
              onClick: onElimina,
            },
          ]}
        />
      </div>

      {aperta && (
        <div className="flex flex-col gap-3 px-3 pb-3 pt-1">
          {p.descrizione && <p className="text-[13px] leading-snug text-zinc-400">{p.descrizione}</p>}
          <div className="flex flex-col gap-1 text-xs">
            {dettaglio('Collezione', p.obs.sceneCollection)}
            {dettaglio('Profilo', p.obs.profilo)}
            {dettaglio('Scena', p.obs.scena)}
            {dettaglio('Reaper', ETICHETTA_MODALITA[p.reaper.modalita])}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Pulsante
              variante={attivo ? 'secondario' : 'primario'}
              icona={inApplicazione ? Loader2 : Play}
              className={inApplicazione ? '[&>svg]:animate-spin' : ''}
              disabled={applicando || obs.stato !== 'connesso'}
              title={obs.stato !== 'connesso' ? 'Connetti OBS per applicare il preset' : undefined}
              onClick={() => applica(p.id)}
            >
              {inApplicazione ? 'Applico…' : attivo ? 'Riapplica' : 'Applica'}
            </Pulsante>
            <Pulsante icona={Pencil} onClick={() => apriEditor(p.id)}>
              Modifica
            </Pulsante>
          </div>
        </div>
      )}
    </article>
  );
}

export function PresetRail() {
  const { preset, presetErrore, presetAvvisi, percorsi, impostazioni } = useApp();
  const { ricaricaPreset, ripristinaPredefiniti, eliminaPreset, leggiImportazione, apriEditor, avvisa } = useApp.getState();
  const [aperta, setAperta] = useState<string | null>(null);
  const [nuovo, setNuovo] = useState(false);
  const [daEliminare, setDaEliminare] = useState<Preset | null>(null);
  const [ripristino, setRipristino] = useState(false);
  const [importati, setImportati] = useState<Preset[] | null>(null);
  const errore = (e: unknown) => avvisa('errore', messaggioErrore(e));

  // Senza scelta esplicita resta aperto il preset attivo.
  const idAperta = aperta ?? impostazioni.presetAttivo;

  const importa = async () => {
    const percorso = await open({ title: 'Importa preset', filters: [{ name: 'Preset Takeline', extensions: ['json'] }] });
    if (typeof percorso !== 'string') return;
    try {
      setImportati(await leggiImportazione(percorso));
    } catch (e) {
      errore(e);
    }
  };

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-bordo bg-pannello/40">
      <div className="flex h-14 shrink-0 items-center gap-1 px-3">
        <h2 className="flex-1 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">Preset</h2>
        <Pulsante piccolo icona={Plus} disabled={!!presetErrore} onClick={() => setNuovo(true)}>
          Nuovo
        </Pulsante>
        <Menu
          icona={MoreHorizontal}
          titolo="Altre azioni sui preset"
          voci={[
            { etichetta: 'Importa da un file…', icona: Upload, disabilitata: !!presetErrore, onClick: () => void importa() },
            {
              etichetta: 'Mostra presets.json',
              icona: FileJson,
              separa: true,
              onClick: () => percorsi && revealItemInDir(percorsi.presetsFile).catch(errore),
            },
            {
              etichetta: 'Ricarica dal file',
              icona: RefreshCw,
              nota: 'Dopo una modifica a mano',
              onClick: () => ricaricaPreset().then(() => avvisa('info', 'Preset ricaricati dal file.')),
            },
            { etichetta: 'Ripristina predefiniti…', icona: RotateCcw, pericolo: true, separa: true, onClick: () => setRipristino(true) },
          ]}
        />
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
        {presetErrore && (
          <div className="mx-1 flex flex-col gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
            <div className="flex gap-2">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>{presetErrore}</span>
            </div>
            <span className="text-red-300/80">Correggi il file e scegli ⋯ › Ricarica dal file. Finché è rotto, Takeline non lo sovrascrive.</span>
          </div>
        )}
        {presetAvvisi.map((a) => (
          <div key={a} className="mx-1 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            {a}
          </div>
        ))}
        {!presetErrore && preset.length === 0 && (
          <div className="mx-1 rounded-lg border border-dashed border-bordo p-4 text-center text-[13px] text-zinc-500">
            Nessun preset. Crea il primo con <span className="text-zinc-300">+ Nuovo</span>.
          </div>
        )}
        {preset.map((p, i) => (
          <RigaPreset
            key={p.id}
            p={p}
            indice={i}
            totale={preset.length}
            aperta={idAperta === p.id}
            onApri={() => setAperta(idAperta === p.id ? '' : p.id)}
            onElimina={() => setDaEliminare(p)}
          />
        ))}
      </div>

      {nuovo && (
        <NuovoPresetDialog
          onChiudi={() => setNuovo(false)}
          onCreato={(id) => {
            setNuovo(false);
            setAperta(id);
            apriEditor(id);
          }}
        />
      )}
      {daEliminare && (
        <ConfermaDialog
          titolo={`Eliminare "${daEliminare.nome}"?`}
          conferma="Elimina preset"
          onChiudi={() => setDaEliminare(null)}
          onConferma={() => eliminaPreset(daEliminare.id).catch(errore)}
          testo={
            <>
              <p>Il preset sparisce dalla lista.</p>
              <p className="text-zinc-400">
                Video, take e sessioni già registrati non vengono toccati, e nemmeno la configurazione di OBS. La versione
                precedente del file resta in <span className="font-mono text-zinc-300">presets.json.bak</span>.
              </p>
            </>
          }
        />
      )}
      {ripristino && (
        <ConfermaDialog
          titolo="Ripristinare i preset predefiniti?"
          conferma="Ripristina"
          onChiudi={() => setRipristino(false)}
          onConferma={() => ripristinaPredefiniti().catch(errore)}
          testo={
            <>
              <p>Tutti i preset vengono sostituiti dai tre predefiniti (Video musicale, Formazione, Call).</p>
              <p className="text-zinc-400">
                I tuoi preset attuali restano in <span className="font-mono text-zinc-300">presets.json.bak</span>: se li vuoi
                tenere, esportali prima da ⋯ › Esporta.
              </p>
            </>
          }
        />
      )}
      {importati && <ImportaDialog voci={importati} onChiudi={() => setImportati(null)} />}
    </aside>
  );
}
