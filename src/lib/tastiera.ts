// Scorciatoie da tastiera, il ripiego del pedale. Il formato e' quello degli
// acceleratori di Tauri ("F9", "Shift+F9", "Ctrl+Alt+R") cosi' la stessa
// stringa vale per la finestra e per le scorciatoie globali.

const MODIFICATORI = ['Ctrl', 'Alt', 'Shift'] as const;

/** Nome del tasto come lo scrive un acceleratore, o null per i soli modificatori. */
function nomeTasto(e: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  if (e.code.startsWith('Key')) return e.code.slice(3);
  if (e.code.startsWith('Digit')) return e.code.slice(5);
  const speciali: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Tab: 'Tab',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };
  return speciali[e.code] ?? null;
}

export function acceleratoreDa(e: KeyboardEvent): string | null {
  const tasto = nomeTasto(e);
  if (!tasto) return null;
  const mod = MODIFICATORI.filter((m) => (m === 'Ctrl' ? e.ctrlKey : m === 'Alt' ? e.altKey : e.shiftKey));
  return [...mod, tasto].join('+');
}

/** Confronto indipendente dall'ordine dei modificatori e dalle maiuscole. */
export function stessoAcceleratore(a: string, b: string) {
  const norm = (s: string) =>
    s
      .split('+')
      .map((x) => x.trim().toLowerCase().replace('control', 'ctrl').replace('commandorcontrol', 'ctrl'))
      .sort()
      .join('+');
  return !!a && !!b && norm(a) === norm(b);
}

/** Durante la scrittura in un campo le scorciatoie senza modificatori non devono scattare. */
export function inCampoDiTesto(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
