// Clap: click audio breve e secco, suonato sull'uscita predefinita di Windows.
// Se quell'uscita e' l'interfaccia, il click finisce sia nel monitor out (e
// quindi nella traccia guida di OBS) sia in cuffia: un riferimento certo per
// il sync. Il flash visivo lo disegnano la regia e la stage view.

let contesto: AudioContext | null = null;

/** Il webview blocca l'audio finche' l'utente non interagisce: si sblocca al primo gesto. */
export function sbloccaAudio() {
  try {
    contesto ??= new AudioContext({ latencyHint: 'interactive' });
    if (contesto.state === 'suspended') void contesto.resume();
  } catch {
    // Nessun dispositivo audio: il clap resta solo visivo.
  }
}

export function audioPronto() {
  return contesto?.state === 'running';
}

/** 30 ms a 1 kHz con attacco istantaneo: un picco facile da trovare in una forma d'onda. */
export function suonaClick() {
  sbloccaAudio();
  if (!contesto || contesto.state !== 'running') return false;
  const t = contesto.currentTime + 0.005;
  const osc = contesto.createOscillator();
  const gain = contesto.createGain();
  osc.type = 'square';
  osc.frequency.value = 1000;
  gain.gain.setValueAtTime(0.9, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  osc.connect(gain).connect(contesto.destination);
  osc.start(t);
  osc.stop(t + 0.04);
  return true;
}
