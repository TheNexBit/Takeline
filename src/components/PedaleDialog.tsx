import { Footprints, Keyboard, Loader2, Radio, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { messaggioErrore } from '../lib/backend';
import { descriviMessaggio, descriviTrigger } from '../lib/midi';
import { COMANDI, type Comando, type Impostazioni, type TriggerMidi } from '../lib/model';
import { acceleratoreDa, stessoAcceleratore } from '../lib/tastiera';
import { useApp } from '../store/app';
import { impostaApprendimento, pedale, useRegia } from '../store/regia';
import { BarraSchede, BASE_INPUT, Interruttore, Modale, Pallino, Pulsante, Riga, Sezione } from './ui';

type SchedaPedale = 'pedale' | 'tastiera';

const STATO_MIDI = {
  inattivo: ['spento', 'MIDI non ancora attivato'],
  richiesta: ['avviso', 'Richiesta di accesso in corso…'],
  pronto: ['ok', 'MIDI attivo'],
  negato: ['errore', 'Accesso MIDI negato: riavvia Takeline e consenti l’accesso quando richiesto'],
  'non-supportato': ['errore', 'WebMIDI non disponibile in questo webview'],
} as const;

const stessoTrigger = (a: TriggerMidi, b: TriggerMidi) => a.tipo === b.tipo && a.canale === b.canale && a.numero === b.numero;

export function PedaleDialog() {
  const aperto = useRegia((s) => s.pedaleAperto);
  const midi = useRegia((s) => s.midi);
  const { impostazioni, salvaImpostazioni, avvisa } = useApp();
  const [scheda, setScheda] = useState<SchedaPedale>('pedale');
  const [inAscolto, setInAscolto] = useState<Comando | null>(null);
  const [tastoInAscolto, setTastoInAscolto] = useState<Comando | null>(null);
  const annulla = useRef<AbortController | null>(null);

  useEffect(() => {
    if (aperto && pedale.stato === 'inattivo') void pedale.avvia();
    if (!aperto) annulla.current?.abort();
  }, [aperto]);

  if (!aperto) return null;
  const chiudi = () => {
    annulla.current?.abort();
    useRegia.setState({ pedaleAperto: false });
  };
  const salva = (imp: Impostazioni) => salvaImpostazioni(imp).catch((e) => avvisa('errore', messaggioErrore(e)));

  const impara = async (c: Comando) => {
    annulla.current?.abort();
    const ctrl = new AbortController();
    annulla.current = ctrl;
    setInAscolto(c);
    impostaApprendimento(true);
    try {
      const { dispositivo, ...trigger } = await pedale.impara(ctrl.signal);
      const imp = useApp.getState().impostazioni;
      const mappa = { ...imp.pedale.mappa };
      // Un pedale fa una cosa sola: se era gia' assegnato altrove, lo si sposta.
      for (const { id } of COMANDI) {
        const t = mappa[id];
        if (t && stessoTrigger(t, trigger)) delete mappa[id];
      }
      mappa[c] = trigger;
      await salva({ ...imp, pedale: { dispositivo: imp.pedale.dispositivo || dispositivo, mappa } });
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') avvisa('errore', messaggioErrore(e));
    } finally {
      // Lascia passare il rilascio del pedale prima di riattivare i comandi.
      setTimeout(() => impostaApprendimento(false), 400);
      setInAscolto(null);
    }
  };

  const togli = (c: Comando) => {
    const mappa = { ...impostazioni.pedale.mappa };
    delete mappa[c];
    void salva({ ...impostazioni, pedale: { ...impostazioni.pedale, mappa } });
  };

  const assegnaTasto = (c: Comando, e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key === 'Escape') return setTastoInAscolto(null);
    const acc = acceleratoreDa(e.nativeEvent);
    if (!acc) return;
    const mappa = { ...impostazioni.tastiera.mappa };
    for (const { id } of COMANDI) if (id !== c && stessoAcceleratore(mappa[id], acc)) mappa[id] = '';
    mappa[c] = acc;
    setTastoInAscolto(null);
    void salva({ ...impostazioni, tastiera: { ...impostazioni.tastiera, mappa } });
  };

  const [esito, testoStato] = STATO_MIDI[midi.stato];
  const assegnati = Object.keys(impostazioni.pedale.mappa).length;

  return (
    <Modale
      titolo="Pedale e tasti"
      sottotitolo="Le modifiche si salvano subito"
      onChiudi={chiudi}
      schede={
        <BarraSchede<SchedaPedale>
          valore={scheda}
          onCambia={setScheda}
          schede={[
            { id: 'pedale', etichetta: `Pedale MIDI${assegnati ? ` · ${assegnati}` : ''}`, avviso: midi.stato === 'negato' },
            { id: 'tastiera', etichetta: 'Tasti di ripiego' },
          ]}
        />
      }
    >
      {scheda === 'pedale' && (
        <div className="flex flex-col gap-7">
          <Sezione titolo="Collegamento">
            <Riga
              titolo={testoStato}
              descrizione={
                midi.dispositivi.length ? `Ingressi trovati: ${midi.dispositivi.join(', ')}` : 'Nessun ingresso MIDI collegato.'
              }
            >
              <Pallino esito={esito} />
              {(midi.stato === 'inattivo' || midi.stato === 'negato') && (
                <Pulsante icona={Radio} onClick={() => void pedale.avvia()}>
                  Attiva MIDI
                </Pulsante>
              )}
            </Riga>
            <Riga titolo="Dispositivo da ascoltare" descrizione="Con “Tutti” funziona qualunque pedale collegato.">
              <select
                className={`${BASE_INPUT} w-60`}
                value={impostazioni.pedale.dispositivo}
                onChange={(e) => void salva({ ...impostazioni, pedale: { ...impostazioni.pedale, dispositivo: e.target.value } })}
              >
                <option value="">Tutti gli ingressi</option>
                {[...new Set([...midi.dispositivi, impostazioni.pedale.dispositivo].filter(Boolean))].map((d) => (
                  <option key={d} value={d}>
                    {d}
                    {midi.dispositivi.includes(d) ? '' : ' (non collegato)'}
                  </option>
                ))}
              </select>
            </Riga>
            <Riga
              titolo="Ultimo messaggio ricevuto"
              descrizione={
                <span className="font-mono text-zinc-300">{midi.ultimo ? descriviMessaggio(midi.ultimo) : 'premi un pedale per vederlo qui'}</span>
              }
            />
          </Sezione>

          <Sezione
            titolo="Comandi"
            descrizione="Premi Assegna e poi il pedale. Takeline capisce da sola se è momentaneo o a scatto e ignora i rimbalzi entro 300 ms."
          >
            {COMANDI.map((c) => {
              const t = impostazioni.pedale.mappa[c.id];
              const ascolta = inAscolto === c.id;
              return (
                <Riga
                  key={c.id}
                  titolo={c.etichetta}
                  descrizione={
                    ascolta ? (
                      <span className="flex items-center gap-1.5 text-sky-300">
                        <Loader2 size={13} className="animate-spin" /> Premi ora il pedale…
                      </span>
                    ) : (
                      <span className={`flex items-center gap-1.5 ${t ? 'text-emerald-300' : ''}`}>
                        <Footprints size={13} />
                        {descriviTrigger(t)}
                      </span>
                    )
                  }
                >
                  {ascolta ? (
                    <Pulsante variante="secondario" onClick={() => annulla.current?.abort()}>
                      Annulla
                    </Pulsante>
                  ) : (
                    <>
                      {t && <Pulsante variante="fantasma" icona={X} title="Togli l'assegnazione" onClick={() => togli(c.id)} />}
                      <Pulsante
                        variante={t ? 'secondario' : 'primario'}
                        disabled={midi.stato !== 'pronto' || inAscolto !== null}
                        onClick={() => void impara(c.id)}
                      >
                        {t ? 'Riassegna' : 'Assegna'}
                      </Pulsante>
                    </>
                  )}
                </Riga>
              );
            })}
          </Sezione>
        </div>
      )}

      {scheda === 'tastiera' && (
        <div className="flex flex-col gap-7">
          <Sezione titolo="Tasti" descrizione="Clicca un campo e premi la combinazione. Esc annulla.">
            {COMANDI.map((c) => (
              <Riga key={c.id} titolo={c.etichetta}>
                <div className="relative">
                  <Keyboard size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    readOnly
                    data-cattura-tasti
                    className={`${BASE_INPUT} w-56 cursor-pointer pl-9 font-mono ${tastoInAscolto === c.id ? 'border-sky-500 text-sky-300' : ''}`}
                    value={tastoInAscolto === c.id ? 'premi i tasti…' : impostazioni.tastiera.mappa[c.id] || 'nessuno'}
                    onFocus={() => setTastoInAscolto(c.id)}
                    onBlur={() => setTastoInAscolto(null)}
                    onKeyDown={(e) => tastoInAscolto === c.id && assegnaTasto(c.id, e)}
                  />
                </div>
                <Pulsante
                  variante="fantasma"
                  icona={X}
                  title="Nessun tasto"
                  disabled={!impostazioni.tastiera.mappa[c.id]}
                  onClick={() =>
                    void salva({
                      ...impostazioni,
                      tastiera: { ...impostazioni.tastiera, mappa: { ...impostazioni.tastiera.mappa, [c.id]: '' } },
                    })
                  }
                />
              </Riga>
            ))}
          </Sezione>
          <Sezione titolo="Ambito">
            <Interruttore
              attivo={impostazioni.tastiera.globali}
              onCambia={(v) => void salva({ ...impostazioni, tastiera: { ...impostazioni.tastiera, globali: v } })}
              etichetta="Scorciatoie globali"
              aiuto="Funzionano anche con Reaper o OBS in primo piano. Quei tasti non arrivano più agli altri programmi."
            />
          </Sezione>
        </div>
      )}
    </Modale>
  );
}
