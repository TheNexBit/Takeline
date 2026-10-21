import { Component, type ErrorInfo, type ReactNode } from 'react';

import { log } from '../lib/log';

/** Un errore di disegno non deve lasciare la finestra vuota: lo si scrive nel log e si offre di ricaricare. */
export class Protezione extends Component<{ children: ReactNode }, { errore: Error | null }> {
  state = { errore: null as Error | null };

  static getDerivedStateFromError(errore: Error) {
    return { errore };
  }

  componentDidCatch(errore: Error, info: ErrorInfo) {
    const dove = info.componentStack?.split('\n').find((r) => r.trim())?.trim();
    log.errore('js', `errore di interfaccia: ${errore.message}${dove ? ` (${dove})` : ''}`);
  }

  render() {
    if (!this.state.errore) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex max-w-lg flex-col gap-4 rounded-lg border border-red-500/40 bg-red-500/10 p-6 text-sm text-red-100">
          <h1 className="text-base font-semibold">Qualcosa nell’interfaccia si è rotto</h1>
          <p className="font-mono text-xs text-red-200/80">{this.state.errore.message}</p>
          <p className="text-red-200/80">
            L’errore è nel log. Le registrazioni in corso in OBS e Reaper non vengono toccate.
          </p>
          <button
            type="button"
            onClick={() => location.reload()}
            className="h-9 self-start rounded-md bg-zinc-100 px-4 font-medium text-zinc-900 hover:bg-white"
          >
            Ricarica
          </button>
        </div>
      </div>
    );
  }
}
