const due = (n: number) => String(Math.floor(n)).padStart(2, '0');

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formattaDurata(secondi: number) {
  const s = Math.max(0, Math.floor(secondi));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${due(m)}:${due(s % 60)}` : `${m}:${due(s % 60)}`;
}

/** Timecode da stage view: sempre HH:MM:SS. */
export function formattaTimecode(secondi: number) {
  const s = Math.max(0, Math.floor(secondi));
  return `${due(s / 3600)}:${due((s % 3600) / 60)}:${due(s % 60)}`;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
