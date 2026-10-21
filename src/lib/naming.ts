// Template dei nomi: {preset} {data} {ora} {take} {titolo}.

export const VARIABILI = ['preset', 'data', 'ora', 'take', 'titolo'] as const;
export type Variabile = (typeof VARIABILI)[number];

/** Nella cartella hanno senso solo le variabili stabili per tutta la sessione. */
export const VARIABILI_CARTELLA: readonly Variabile[] = ['preset', 'data'];

export interface ContestoNome {
  preset: string;
  titolo: string;
  take: number;
  quando: Date;
}

const due = (n: number) => String(n).padStart(2, '0');
export const formattaData = (d: Date) => `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`;
export const formattaOra = (d: Date) => `${due(d.getHours())}-${due(d.getMinutes())}-${due(d.getSeconds())}`;

/** Toglie i caratteri vietati da Windows nei nomi di file e il % (speciale per OBS). */
export function pulisciNomeFile(s: string): string {
  return s
    .replace(/[<>:"/\\|?*%\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "a__b" quando {titolo} e' vuoto diventa "a_b"; niente separatori in testa o in coda. */
function compattaSeparatori(s: string): string {
  return s.replace(/([_\- .])[_\- .]+/g, '$1').replace(/^[_\- .]+|[_\- .]+$/g, '');
}

export function variabiliSconosciute(template: string, ammesse: readonly string[] = VARIABILI): string[] {
  const trovate = [...template.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  return [...new Set(trovate.filter((v) => !ammesse.includes(v)))];
}

function valori(ctx: ContestoNome): Record<Variabile, string> {
  return {
    preset: pulisciNomeFile(ctx.preset),
    data: formattaData(ctx.quando),
    ora: formattaOra(ctx.quando),
    take: due(ctx.take),
    titolo: pulisciNomeFile(ctx.titolo),
  };
}

export function risolviNome(template: string, ctx: ContestoNome): string {
  const v = valori(ctx);
  const nome = template.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? v[k as Variabile] : m));
  return compattaSeparatori(pulisciNomeFile(nome)) || 'take';
}

/**
 * Template nel formato di OBS (FilenameFormatting): data e ora restano
 * specificatori, cosi' OBS li calcola al momento esatto dell'avvio.
 */
export function templatePerObs(template: string, ctx: ContestoNome): string {
  const v = { ...valori(ctx), data: '§D§', ora: '§O§' };
  const nome = template.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? v[k as Variabile] : m));
  return (compattaSeparatori(pulisciNomeFile(nome)) || 'take')
    .replace(/§D§/g, '%CCYY-%MM-%DD')
    .replace(/§O§/g, '%hh-%mm-%ss');
}

/** Cartella di output: solo {preset} e {data}, separatori di percorso preservati. */
export function risolviCartella(template: string, ctx: Pick<ContestoNome, 'preset' | 'quando'>): string {
  return template
    .replace(/\{preset\}/g, pulisciNomeFile(ctx.preset))
    .replace(/\{data\}/g, formattaData(ctx.quando))
    .replace(/[\\/]+$/, '');
}
