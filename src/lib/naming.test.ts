import { describe, expect, it } from 'vitest';

import { risolviCartella, risolviNome, templatePerObs, variabiliSconosciute } from './naming';

const ctx = { preset: 'Video musicale', titolo: 'Blues in La', take: 3, quando: new Date(2026, 9, 21, 18, 42, 7) };

describe('nomi dei file', () => {
  it('risolve tutte le variabili', () => {
    expect(risolviNome('{data}_{ora}_{preset}_{titolo}_take{take}', ctx)).toBe('2026-10-21_18-42-07_Video musicale_Blues in La_take03');
  });

  it('compatta i separatori quando il titolo e\' vuoto', () => {
    expect(risolviNome('{data}_{titolo}_take{take}', { ...ctx, titolo: '' })).toBe('2026-10-21_take03');
  });

  it('toglie i caratteri vietati da Windows e il % di OBS', () => {
    expect(risolviNome('{titolo}', { ...ctx, titolo: 'A/B: 100% "live"?' })).toBe('AB 100 live');
  });

  it('per OBS lascia data e ora come specificatori', () => {
    expect(templatePerObs('{data}_{ora}_{titolo}', ctx)).toBe('%CCYY-%MM-%DD_%hh-%mm-%ss_Blues in La');
  });

  it('segnala le variabili sconosciute', () => {
    expect(variabiliSconosciute('{data}_{autore}_{take}')).toEqual(['autore']);
  });

  it('nella cartella usa solo preset e data', () => {
    expect(risolviCartella('C:\\Video\\{preset}\\{data}\\', ctx)).toBe('C:\\Video\\Video musicale\\2026-10-21');
  });
});
