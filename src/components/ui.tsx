// Mattoncini dell'interfaccia: pochi, coerenti, scuri. Bersagli grandi
// (minimo 32 px) e impostazioni a righe: nome e spiegazione a sinistra,
// comando a destra.

import { X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type Esito = 'ok' | 'avviso' | 'errore' | 'spento' | 'attivo';

export const COLORE_ESITO: Record<Esito, string> = {
  ok: 'bg-emerald-400',
  avviso: 'bg-amber-400',
  errore: 'bg-red-500',
  spento: 'bg-zinc-600',
  attivo: 'bg-red-500 animate-pulse',
};

export const BORDO_ESITO: Record<Esito, string> = {
  ok: 'border-emerald-500/30',
  avviso: 'border-amber-500/40',
  errore: 'border-red-500/50',
  spento: 'border-bordo',
  attivo: 'border-red-500/70',
};

export function Pallino({ esito, className = '' }: { esito: Esito; className?: string }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${COLORE_ESITO[esito]} ${className}`} />;
}

type Variante = 'primario' | 'secondario' | 'fantasma' | 'pericolo';
const VARIANTI: Record<Variante, string> = {
  primario: 'bg-zinc-100 text-zinc-900 hover:bg-white disabled:bg-zinc-700 disabled:text-zinc-400',
  secondario: 'bg-rilievo text-zinc-100 border border-bordo hover:bg-zinc-800 hover:border-zinc-600 disabled:text-zinc-500',
  fantasma: 'text-zinc-300 hover:text-white hover:bg-white/10 disabled:text-zinc-600',
  pericolo: 'bg-red-600 text-white hover:bg-red-500 disabled:bg-red-900 disabled:text-red-300',
};

export function Pulsante({
  variante = 'secondario',
  piccolo,
  icona: Icona,
  children,
  className = '',
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante;
  piccolo?: boolean;
  icona?: LucideIcon;
}) {
  const soloIcona = !children;
  const dim = piccolo
    ? `h-8 text-[13px] gap-1.5 ${soloIcona ? 'w-8' : 'px-3'}`
    : `h-9 text-sm gap-2 ${soloIcona ? 'w-9' : 'px-4'}`;
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed ${dim} ${VARIANTI[variante]} ${className}`}
      {...resto}
    >
      {Icona && <Icona size={piccolo ? 16 : 18} strokeWidth={2} />}
      {children}
    </button>
  );
}

/** Senza larghezza: per i campi a misura fissa (w-60, w-56...), che con w-full perderebbero. */
export const BASE_INPUT =
  'h-9 rounded-md border border-bordo bg-fondo px-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-400 disabled:opacity-40';
export const CLASSE_INPUT = `${BASE_INPUT} w-full`;
/** Campi numerici corti, da mettere a destra di una riga. */
export const CLASSE_NUMERO = `${BASE_INPUT} w-24 text-right tabular-nums`;

/** Campo impilato: etichetta sopra, valore a tutta larghezza (percorsi, testi lunghi). */
export function Campo({
  etichetta,
  aiuto,
  errore,
  children,
  className = '',
}: {
  etichetta: string;
  aiuto?: ReactNode;
  errore?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[13px] font-medium text-zinc-200">{etichetta}</span>
      {children}
      {errore ? (
        <span className="text-xs text-amber-400">{errore}</span>
      ) : aiuto ? (
        <span className="text-xs text-zinc-500">{aiuto}</span>
      ) : null}
    </label>
  );
}

/** Riga di impostazione: nome e spiegazione a sinistra, comando a destra. */
export function Riga({
  titolo,
  descrizione,
  children,
  sotto,
}: {
  titolo: string;
  descrizione?: ReactNode;
  children?: ReactNode;
  /** Contenuto a tutta larghezza sotto la riga (es. un testo da modificare). */
  sotto?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-3.5">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="text-sm text-zinc-100">{titolo}</div>
          {descrizione && <div className="mt-0.5 text-xs leading-relaxed text-zinc-500">{descrizione}</div>}
        </div>
        {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
      </div>
      {sotto}
    </div>
  );
}

export function Interruttore({
  attivo,
  onCambia,
  etichetta,
  aiuto,
  disabilitato,
}: {
  attivo: boolean;
  onCambia: (v: boolean) => void;
  etichetta: string;
  aiuto?: ReactNode;
  disabilitato?: boolean;
}) {
  return (
    <Riga titolo={etichetta} descrizione={aiuto}>
      <button
        type="button"
        role="switch"
        aria-checked={attivo}
        aria-label={etichetta}
        disabled={disabilitato}
        onClick={() => onCambia(!attivo)}
        className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors disabled:opacity-40 ${attivo ? 'bg-emerald-500' : 'bg-zinc-700'}`}
      >
        <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${attivo ? 'translate-x-5' : ''}`} />
      </button>
    </Riga>
  );
}

export function Segmenti<T extends string>({
  valore,
  opzioni,
  onCambia,
}: {
  valore: T;
  opzioni: { valore: T; etichetta: string; descrizione?: string }[];
  onCambia: (v: T) => void;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${opzioni.length}, minmax(0, 1fr))` }}>
      {opzioni.map((o) => (
        <button
          key={o.valore}
          type="button"
          onClick={() => onCambia(o.valore)}
          className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${valore === o.valore ? 'border-zinc-300 bg-rilievo' : 'border-bordo hover:border-zinc-600'}`}
        >
          <span className={`text-sm font-medium ${valore === o.valore ? 'text-white' : 'text-zinc-300'}`}>{o.etichetta}</span>
          {o.descrizione && <span className="text-xs leading-snug text-zinc-500">{o.descrizione}</span>}
        </button>
      ))}
    </div>
  );
}

/** Gruppo di righe con titolo; le righe sono separate da una linea sottile. */
export function Sezione({
  titolo,
  descrizione,
  children,
  azioni,
}: {
  titolo: string;
  descrizione?: ReactNode;
  children: ReactNode;
  azioni?: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <div className="mb-1 flex items-end justify-between gap-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{titolo}</h3>
          {descrizione && <p className="mt-1 text-xs leading-relaxed text-zinc-500">{descrizione}</p>}
        </div>
        {azioni}
      </div>
      <div className="flex flex-col divide-y divide-bordo/70">{children}</div>
    </section>
  );
}

export interface Scheda<T extends string> {
  id: T;
  etichetta: string;
  /** Pallino d'avviso sulla scheda (es. un campo da correggere). */
  avviso?: boolean;
}

export function BarraSchede<T extends string>({
  schede,
  valore,
  onCambia,
}: {
  schede: Scheda<T>[];
  valore: T;
  onCambia: (v: T) => void;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto px-5" role="tablist">
      {schede.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={valore === s.id}
          onClick={() => onCambia(s.id)}
          className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${valore === s.id ? 'border-zinc-100 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          {s.etichetta}
          {s.avviso && <Pallino esito="avviso" />}
        </button>
      ))}
    </nav>
  );
}

export function Modale({
  titolo,
  sottotitolo,
  onChiudi,
  children,
  piede,
  laterale,
  compatta,
  schede,
}: {
  titolo: string;
  sottotitolo?: string;
  onChiudi: () => void;
  children: ReactNode;
  piede?: ReactNode;
  /** Pannello a destra a tutta altezza invece della finestra centrata. */
  laterale?: boolean;
  /** Finestra piccola, alta quanto il contenuto (conferme, creazione). */
  compatta?: boolean;
  /** Barra di schede sotto il titolo. */
  schede?: ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onChiudi();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onChiudi]);

  return (
    <div
      className={`fixed inset-0 z-40 flex bg-black/60 ${laterale ? 'justify-end' : 'items-center justify-center p-6'}`}
      onMouseDown={(e) => e.target === e.currentTarget && onChiudi()}
    >
      <div
        className={`flex flex-col border-bordo bg-pannello shadow-2xl ${laterale ? 'h-full w-[620px] max-w-full border-l' : compatta ? 'max-h-full w-[500px] max-w-full rounded-xl border' : 'h-[min(720px,100%)] w-[720px] max-w-full rounded-xl border'}`}
      >
        <header className={`flex shrink-0 items-center justify-between gap-4 px-5 pt-4 ${schede ? '' : 'border-b border-bordo pb-4'}`}>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-white">{titolo}</h2>
            {sottotitolo && <p className="truncate text-xs text-zinc-500">{sottotitolo}</p>}
          </div>
          <Pulsante variante="fantasma" icona={X} onClick={onChiudi} title="Chiudi (Esc)" aria-label="Chiudi" />
        </header>
        {schede && <div className="shrink-0 border-b border-bordo pt-2">{schede}</div>}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {piede && <footer className="flex shrink-0 items-center gap-2 border-t border-bordo px-5 py-3">{piede}</footer>}
      </div>
    </div>
  );
}

/** Barra di livello: -60 dB a sinistra, 0 dB a destra. */
export function Livello({ db, className = '' }: { db: number | undefined; className?: string }) {
  const v = db === undefined ? 0 : Math.min(1, Math.max(0, (db + 60) / 60));
  const colore = db === undefined ? '' : db > -3 ? 'bg-red-500' : db > -12 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <span className={`relative block h-1.5 overflow-hidden rounded-full bg-zinc-800 ${className}`}>
      <span className={`absolute inset-y-0 left-0 ${colore} transition-[width] duration-75`} style={{ width: `${v * 100}%` }} />
    </span>
  );
}

export interface VoceMenu {
  etichetta: string;
  icona?: LucideIcon;
  onClick: () => void;
  pericolo?: boolean;
  disabilitata?: boolean;
  /** Perche' e' disabilitata: compare sotto l'etichetta. */
  nota?: string;
  /** Linea di separazione prima della voce. */
  separa?: boolean;
}

/** Menu a tendina aperto da un pulsante (es. "⋯"). Si chiude con Esc o cliccando fuori. */
export function Menu({
  voci,
  icona,
  titolo,
  etichetta,
  allinea = 'destra',
}: {
  voci: VoceMenu[];
  icona: LucideIcon;
  titolo: string;
  etichetta?: string;
  allinea?: 'destra' | 'sinistra';
}) {
  const [aperto, setAperto] = useState(false);
  const [posizione, setPosizione] = useState<React.CSSProperties>({});
  const radice = useRef<HTMLDivElement>(null);

  // Posizione fissa sopra tutto: dentro un elenco che scorre il menu non viene tagliato.
  const apri = () => {
    const r = radice.current?.getBoundingClientRect();
    if (r) {
      const altezza = voci.length * 44 + 16;
      const sopra = r.bottom + altezza > window.innerHeight - 8 && r.top > altezza;
      setPosizione({
        position: 'fixed',
        ...(sopra ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        ...(allinea === 'destra' ? { right: window.innerWidth - r.right } : { left: r.left }),
      });
    }
    setAperto(true);
  };

  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => !radice.current?.contains(e.target as Node) && setAperto(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAperto(false);
    // Con la posizione fissa, scorrere o ridimensionare lo staccherebbe dal pulsante.
    const chiudi = () => setAperto(false);
    window.addEventListener('mousedown', fuori);
    window.addEventListener('keydown', esc);
    window.addEventListener('scroll', chiudi, true);
    window.addEventListener('resize', chiudi);
    return () => {
      window.removeEventListener('mousedown', fuori);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', chiudi, true);
      window.removeEventListener('resize', chiudi);
    };
  }, [aperto]);

  return (
    <div ref={radice} className="relative">
      <Pulsante
        variante="fantasma"
        icona={icona}
        title={titolo}
        aria-label={titolo}
        aria-expanded={aperto}
        className={aperto ? 'bg-white/10 text-white' : ''}
        onClick={(e) => {
          e.stopPropagation();
          if (aperto) setAperto(false);
          else apri();
        }}
      >
        {etichetta}
      </Pulsante>
      {aperto && (
        <div
          role="menu"
          style={posizione}
          className="z-50 w-64 overflow-hidden rounded-lg border border-bordo bg-rilievo py-1 shadow-2xl"
        >
          {voci.map((v) => {
            const Icona = v.icona;
            return (
              <div key={v.etichetta}>
                {v.separa && <div className="my-1 h-px bg-bordo" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={v.disabilitata}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAperto(false);
                    v.onClick();
                  }}
                  className={`flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${v.pericolo ? 'text-red-300 hover:bg-red-500/15' : 'text-zinc-100 hover:bg-white/10'}`}
                >
                  {Icona && <Icona size={16} className="mt-0.5 shrink-0" />}
                  <span className="flex flex-col">
                    {v.etichetta}
                    {v.nota && <span className="text-xs text-zinc-500">{v.nota}</span>}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
