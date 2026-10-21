// Coda di post-produzione vista dal frontend: elenco dei lavori, aggiornato
// dagli eventi del backend, e pausa automatica durante le registrazioni.

import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';

import { backend, type Lavoro } from '../lib/backend';
import { log } from '../lib/log';
import { useRegia } from './regia';

export const useLavori = create<{ lavori: Lavoro[] }>(() => ({ lavori: [] }));

const anteprima = () => (window as { __TAKELINE_ANTEPRIMA__?: boolean }).__TAKELINE_ANTEPRIMA__ === true;

let avviata = false;

export async function avviaPost() {
  if (avviata || anteprima()) return;
  avviata = true;

  await listen<Lavoro>('takeline://lavoro', ({ payload }) => {
    useLavori.setState((s) => {
      const i = s.lavori.findIndex((l) => l.id === payload.id);
      const lavori = i < 0 ? [payload, ...s.lavori] : s.lavori.map((l, n) => (n === i ? payload : l));
      return { lavori };
    });
  });
  useLavori.setState({ lavori: await backend.postElenco().catch(() => []) });

  // ffmpeg non deve togliere risorse a OBS: durante una take la coda si ferma
  // (il lavoro in corso torna in attesa e riparte da capo dopo).
  let inPausa = false;
  const aggiorna = () => {
    const pausa = useRegia.getState().regia.fase !== 'fermo';
    if (pausa === inPausa) return;
    inPausa = pausa;
    log.info('post', pausa ? 'coda in pausa: registrazione in corso' : 'coda ripresa');
    void backend.postPausa(pausa);
  };
  useRegia.subscribe(aggiorna);
  aggiorna();
}

export async function pulisciFiniti() {
  await backend.postPulisci();
  useLavori.setState((s) => ({ lavori: s.lavori.filter((l) => l.stato !== 'fatto' && l.stato !== 'annullato') }));
}
