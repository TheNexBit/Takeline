import React from 'react';
import ReactDOM from 'react-dom/client';

import { Protezione } from './components/Protezione';
import './index.css';
import { intercettaErrori, log } from './lib/log';

// Aperta in un browser normale durante lo sviluppo: backend simulato.
if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
  (await import('./dev/anteprimaBrowser')).installa();
}

const stage = new URLSearchParams(location.search).get('vista') === 'stage';
intercettaErrori(stage ? 'stage view' : 'principale');
if (stage) log.info('stage', 'stage view aperta');

// Import separati: la stage view non deve caricare il codice della finestra
// principale, che alla partenza crea connessione a OBS e regia.
const Vista = stage ? (await import('./components/Stage')).Stage : (await import('./App')).default;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Protezione>
      <Vista />
    </Protezione>
  </React.StrictMode>,
);
