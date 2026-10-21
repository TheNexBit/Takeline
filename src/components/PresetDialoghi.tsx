// Finestre della gestione preset: nuovo, elimina, importa, ripristina.

import { Plus, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';

import { messaggioErrore } from '../lib/backend';
import { ETICHETTA_TIPO, type Preset, type TipoPreset } from '../lib/model';
import { useApp, type AzioneImportazione, type NuovoPreset } from '../store/app';
import { BASE_INPUT, CLASSE_INPUT, Campo, Modale, Pulsante, Segmenti } from './ui';

const TIPI: { valore: TipoPreset; etichetta: string; descrizione: string }[] = [
  { valore: 'musicale', etichetta: 'Video musicale', descrizione: 'Reaper con take continua' },
  { valore: 'formazione', etichetta: 'Formazione', descrizione: 'Reaper con start/stop' },
  { valore: 'call', etichetta: 'Call', descrizione: 'Solo OBS, con consenso' },
];

export function NuovoPresetDialog({ onChiudi, onCreato }: { onChiudi: () => void; onCreato: (id: string) => void }) {
  const { preset, obs, creaPreset, avvisa } = useApp();
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<TipoPreset>('musicale');
  const [origine, setOrigine] = useState<NuovoPreset['origine']>('vuoto');
  const [copiaDa, setCopiaDa] = useState(preset[0]?.id ?? '');
  const [inCorso, setInCorso] = useState(false);

  const ist = obs.ist;
  const doppione = preset.some((p) => p.nome.trim().toLowerCase() === nome.trim().toLowerCase());
  const errore = !nome.trim()
    ? null
    : doppione
      ? 'Esiste già un preset con questo nome.'
      : origine === 'obs' && !ist
        ? 'OBS non è connesso: non posso leggerne la configurazione.'
        : null;
  const pronto = !!nome.trim() && !errore && (origine !== 'copia' || !!copiaDa);

  const crea = async () => {
    setInCorso(true);
    try {
      const id = await creaPreset({ nome, tipo, origine, copiaDa });
      onCreato(id);
    } catch (e) {
      avvisa('errore', messaggioErrore(e));
      setInCorso(false);
    }
  };

  return (
    <Modale
      compatta
      titolo="Nuovo preset"
      onChiudi={onChiudi}
      piede={
        <>
          <div className="flex-1" />
          <Pulsante onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante variante="primario" icona={Plus} disabled={!pronto || inCorso} onClick={crea}>
            Crea e modifica
          </Pulsante>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (pronto) void crea();
        }}
      >
        <Campo etichetta="Nome" errore={errore}>
          <input autoFocus className={CLASSE_INPUT} placeholder="es. Lezione di ritmica" value={nome} onChange={(e) => setNome(e.target.value)} />
        </Campo>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-zinc-200">Parti da</span>
          <Segmenti<NuovoPreset['origine']>
            valore={origine}
            onCambia={setOrigine}
            opzioni={[
              { valore: 'vuoto', etichetta: 'Impostazioni base', descrizione: 'Quelle del tipo scelto' },
              { valore: 'copia', etichetta: 'Un altro preset', descrizione: 'Ne fa una copia' },
              {
                valore: 'obs',
                etichetta: 'OBS di adesso',
                descrizione: ist ? `${ist.collezione} · ${ist.scena}` : 'OBS non connesso',
              },
            ]}
          />
        </div>

        {origine === 'copia' ? (
          <Campo etichetta="Preset da copiare">
            <select className={CLASSE_INPUT} value={copiaDa} onChange={(e) => setCopiaDa(e.target.value)}>
              {preset.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </Campo>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-zinc-200">Tipo</span>
            <Segmenti<TipoPreset> valore={tipo} onCambia={setTipo} opzioni={TIPI} />
          </div>
        )}
        <p className="text-xs text-zinc-500">Dopo la creazione si apre l’editor per completare le impostazioni.</p>
      </form>
    </Modale>
  );
}

export function ConfermaDialog({
  titolo,
  testo,
  conferma,
  onConferma,
  onChiudi,
}: {
  titolo: string;
  testo: React.ReactNode;
  conferma: string;
  onConferma: () => void;
  onChiudi: () => void;
}) {
  return (
    <Modale
      compatta
      titolo={titolo}
      onChiudi={onChiudi}
      piede={
        <>
          <div className="flex-1" />
          <Pulsante onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante
            variante="pericolo"
            icona={Trash2}
            onClick={() => {
              onChiudi();
              onConferma();
            }}
          >
            {conferma}
          </Pulsante>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-zinc-300">{testo}</div>
    </Modale>
  );
}

export function ImportaDialog({ voci, onChiudi }: { voci: Preset[]; onChiudi: () => void }) {
  const { preset, aggiungiImportati, avvisa } = useApp();
  const esiste = (p: Preset) => preset.some((x) => x.nome.toLowerCase() === p.nome.toLowerCase());
  const [azioni, setAzioni] = useState<AzioneImportazione[]>(() => voci.map((p) => (esiste(p) ? 'entrambi' : 'entrambi')));
  const daImportare = azioni.filter((a) => a !== 'salta').length;

  const importa = async () => {
    try {
      await aggiungiImportati(voci.map((preset, i) => ({ preset, azione: azioni[i] })));
      onChiudi();
    } catch (e) {
      avvisa('errore', messaggioErrore(e));
    }
  };

  return (
    <Modale
      compatta
      titolo="Importa preset"
      sottotitolo={`${voci.length} preset nel file`}
      onChiudi={onChiudi}
      piede={
        <>
          <div className="flex-1" />
          <Pulsante onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante variante="primario" icona={Upload} disabled={!daImportare} onClick={importa}>
            Importa {daImportare}
          </Pulsante>
        </>
      }
    >
      <div className="flex flex-col divide-y divide-bordo/70">
        {voci.map((p, i) => {
          const doppione = esiste(p);
          return (
            <div key={`${p.id}-${i}`} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm text-zinc-100">{p.nome}</div>
                <div className="text-xs text-zinc-500">
                  {ETICHETTA_TIPO[p.tipo]}
                  {doppione && <span className="text-amber-300"> · esiste già un preset con questo nome</span>}
                </div>
              </div>
              <select
                className={`${BASE_INPUT} w-52`}
                value={azioni[i]}
                onChange={(e) => setAzioni((a) => a.map((x, j) => (j === i ? (e.target.value as AzioneImportazione) : x)))}
              >
                {doppione ? (
                  <>
                    <option value="entrambi">Tieni entrambi</option>
                    <option value="sostituisci">Sostituisci l’esistente</option>
                  </>
                ) : (
                  <option value="entrambi">Importa</option>
                )}
                <option value="salta">Non importare</option>
              </select>
            </div>
          );
        })}
      </div>
    </Modale>
  );
}
