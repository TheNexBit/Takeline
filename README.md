# Takeline

Console operativa per Windows che orchestra **OBS Studio** e **Reaper** per registrare
video musicali, formazioni e call: preset di lavoro, take, sync tra video e audio e
post-produzione.

È pensata per chi registra sé stesso mentre suona: durante la registrazione le mani sono
sulla chitarra e gli occhi non sono sullo schermo. Per questo tutto quello che serve
mentre si registra passa dal pedale MIDI e da una *stage view* leggibile da lontano;
mouse e tastiera servono prima e dopo.

> Stato: **Milestone 5** — tutte le milestone della specifica: preset operativi, patchbay,
> transport a mani libere (pedale MIDI, replay buffer, take come region di Reaper, clap,
> stage view, scaletta), sync tra video e audio con correzione del drift, post-produzione
> in coda e ciclo di vita dei file, pre-flight, watchdog, recupero e consenso.

## Come funziona

```
chitarra ─► interfaccia ASIO ─► Reaper            (audio vero, take continua)
                    │
                    └─ monitor out ─► OBS          (solo traccia guida per il sync)
camera / schermo ─────────────────► OBS ─► file video
```

- **OBS resta il motore video** e si pilota solo via obs-websocket v5. Takeline non
  include né modifica OBS.
- **L'audio non passa da OBS**: la chitarra entra in Reaper via ASIO. OBS registra il
  video più una traccia audio di riferimento che serve solo ad allineare.
- **Reaper** si controlla dalla sua interfaccia web nativa.

## Requisiti

- Windows 10 o 11 con [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)
  (già presente su Windows 11)
- [OBS Studio](https://obsproject.com/) 30 o successivo (obs-websocket v5 è incluso)
- [Reaper](https://www.reaper.fm/)
- [ffmpeg](https://ffmpeg.org/) nel `PATH` o indicato nelle impostazioni. Takeline lo
  usa ma non lo include: se manca, **Impostazioni › ffmpeg › Installa** (o il pulsante
  nel pre-flight) se lo procura da solo, prima con `winget install Gyan.FFmpeg` e, se
  winget non c’è, scaricando la build *essentials* nella cartella dati. Serve una build
  completa: `ffprobe` viene cercato nella stessa cartella di `ffmpeg` e senza di lui
  sync, capitoli, proxy e normalizzazione non partono. Le copie incluse in altri
  programmi (ShareX, CapCut) spesso hanno solo `ffmpeg.exe`; il pre-flight lo segnala.

Per compilare dai sorgenti servono anche:

- [Node.js](https://nodejs.org/) 20 o successivo: `winget install OpenJS.NodeJS.LTS`
- [Rust](https://rustup.rs/): `winget install Rustlang.Rustup`
- Build Tools di Visual Studio con il carico di lavoro C++ (richiesti da Rust su Windows)

## Avvio rapido (dai sorgenti)

Gli script stanno in `script\` e si lanciano con un doppio clic:

| Script | Cosa fa |
| --- | --- |
| `setup.bat` | Prima installazione: controlla gli strumenti, installa le dipendenze |
| `dev.bat` | Avvia Takeline in sviluppo, con dati di prova in `dev-dati\dev` |
| `verifica.bat` | `npm run typecheck`, `npm test` (transport simulato), `cargo check`, `cargo test` e prove complete di sync e post-produzione con file generati da ffmpeg |
| `build.bat` | Crea l'installer in `src-tauri\target\release\bundle\nsis` |

```bash
script\setup.bat
```

```bash
script\dev.bat
```

La prima compilazione Rust richiede qualche minuto, le successive sono rapide.

## Configurare OBS

1. In OBS apri **Strumenti › Impostazioni server WebSocket**.
2. Spunta **Abilita server WebSocket**. La porta predefinita è `4455`.
3. Se attivi l'autenticazione, copia la password (**Mostra informazioni di connessione**)
   e incollala in Takeline › Impostazioni › OBS.

Takeline si connette all'avvio e, se OBS si chiude o si riavvia, riprova da solo ogni
pochi secondi.

## Configurare Reaper

Takeline usa l'interfaccia web integrata in Reaper:

1. In Reaper apri **Options › Preferences › Control/OSC/web**.
2. Premi **Add** e scegli **Web browser interface** come *Control surface mode*.
3. Lascia la porta `8080` (o scegline un'altra e indicala in Takeline › Impostazioni).
4. Per l'uso in locale non servono utente e password; se li imposti, inseriscili anche
   in Takeline.
5. Conferma con **OK**. In Takeline › Impostazioni › Reaper premi **Prova connessione**.

Takeline legge lo stato con `GET /_/TRANSPORT;NTRACK;TRACK` e comanda Reaper con le
azioni native (`GET /_/{actionId}`): 1013 registra, 1016 stop, 1007 play, 40042 vai
all'inizio, 40490/40491 arma/disarma tutte le tracce, 40157 inserisci marker, 40296 crea
region dalla selezione.

## Preset

Un preset è un contesto di lavoro completo. Applicarlo, con un clic:

1. controlla che non ci siano registrazioni o dirette in corso;
2. **fa un backup** della configurazione di OBS (scene collection e profili, più
   un'istantanea letta via websocket);
3. cambia scene collection e profilo, **attendendo che OBS finisca di ricaricare**
   (con un timeout e un messaggio chiaro se non risponde);
4. mette in onda la scena;
5. crea la cartella di output e la imposta in OBS;
6. imposta il nome dei file in OBS dal template del preset;
7. verifica che Reaper risponda e che ci siano tracce armate.

Se il preset nomina una scene collection, un profilo o una scena che in OBS non esistono,
Takeline non crea niente da sola: ti fa scegliere tra quelli che hai già (proponendo quello
attivo) oppure, solo se lo scegli, lo crea vuoto dopo aver rifatto il backup. La scelta
viene salvata nel preset.

Ci sono tre preset predefiniti: **Video musicale**, **Formazione** e **Call**. All'inizio
usano la configurazione di OBS che trovano attiva; dopo averne applicato uno, **Ricorda nel
preset** lo collega a quella raccolta, profilo e scena. Se poi OBS non corrisponde più al
preset attivo, la patchbay lo segnala e offre **Riapplica il preset** oppure **Usa la
configurazione attuale**.

### Gestire i preset

- **+ Nuovo** (in cima alla lista): nome, e da dove partire: le impostazioni base di un
  tipo (video musicale, formazione, call), la copia di un altro preset o la configurazione
  che OBS ha aperta in quel momento. Poi si apre l’editor per completarlo.
- **Clic su un preset**: mostra i dettagli con **Applica** e **Modifica**.
- **⋯ su un preset**: Modifica, Duplica, Sposta su/giù, Esporta in un file, Elimina.
  Eliminare chiede conferma e non tocca video, take, sessioni né OBS; il preset attivo non
  si può eliminare finché è applicato.
- **⋯ in cima alla lista**: Importa da un file (se un preset con lo stesso nome esiste già
  scegli se tenerli entrambi o sostituirlo), Mostra presets.json, Ricarica dal file,
  Ripristina predefiniti.

### Il file dei preset

I preset stanno in `presets.json` nella cartella di configurazione
(`%APPDATA%\com.thenexbit.takeline`): si possono modificare a mano, copiare e condividere.
Dopo una modifica a mano premi **Ricarica** nell'elenco dei preset. Se il file contiene
un errore di sintassi Takeline lo segnala con riga e colonna e non lo sovrascrive. A ogni
salvataggio la versione precedente resta in `presets.json.bak`.

```json
{
  "versione": 1,
  "preset": [
    {
      "id": "video-musicale",
      "nome": "Video musicale",
      "tipo": "musicale",
      "obs": {
        "sceneCollection": "Takeline - Musicale",
        "profilo": "Takeline - Musicale",
        "scena": "Chitarra",
        "tracciaGuida": "Guida (monitor out)"
      },
      "output": {
        "cartella": "C:\\Users\\io\\Videos\\Takeline\\{preset}",
        "templateNome": "{data}_{titolo}_take{take}"
      },
      "reaper": { "modalita": "take-continua", "armaTracce": true, "tornaAllInizio": false },
      "post": { "remuxMp4": true, "separaTracce": true, "normalizza": false, "lufs": -14, "export": ["youtube"] },
      "consenso": { "attivo": false, "testo": "" }
    }
  ]
}
```

- Un campo OBS vuoto (`""`) lascia invariato quello attivo.
- `tipo`: `musicale`, `formazione` o `call`.
- `reaper.modalita`: `take-continua` (una sola registrazione lunga, una region per take),
  `start-stop` (Reaper parte e si ferma con OBS) o `disattivato`.
- I campi mancanti prendono il valore predefinito.

### Template dei nomi

| Variabile | Esempio | Dove |
| --- | --- | --- |
| `{preset}` | `Video musicale` | nome e cartella |
| `{data}` | `2026-10-21` | nome e cartella |
| `{ora}` | `18-42-07` | nome |
| `{take}` | `03` | nome |
| `{titolo}` | `Blues in La` (dal campo *Titolo* in alto) | nome |

`{data}` e `{ora}` diventano specificatori di OBS (`%CCYY-%MM-%DD`, `%hh-%mm-%ss`),
quindi corrispondono all'istante esatto in cui parte la registrazione. I caratteri non
ammessi da Windows vengono tolti e i separatori doppi (quando `{titolo}` è vuoto)
compattati.

## Backup e ripristino di OBS

Prima di ogni cambio Takeline copia `basic\scenes` e `basic\profiles` di OBS in
`%APPDATA%\com.thenexbit.takeline\backup-obs\<data>_<motivo>\`. Ogni backup contiene un
`LEGGIMI.txt` con le istruzioni; in breve: chiudi OBS, copia la cartella `basic` del
backup in `%APPDATA%\obs-studio` sovrascrivendo, riapri OBS.

Se usi OBS in modalità portable, indica la sua cartella di configurazione in
Impostazioni › OBS: senza backup Takeline non applica il preset.

## Registrare a mani libere

Durante la registrazione si usano solo il pedale e la stage view. La scheda **Regia**
della finestra principale serve prima (per prepararsi) e dopo (per rimediare).

### Comandi

| Comando | Cosa fa | Tasto di ripiego |
| --- | --- | --- |
| Avvia / ferma take | Apre o chiude un file video in OBS (e Reaper, secondo il preset) | F9 |
| Salva replay buffer | Salva gli ultimi minuti di OBS come take “replay” | F10 |
| Marca take buono | Durante la take: marker “buono” e take promosso. Dopo: segna l’ultimo take | F7 |
| Marca da tagliare | Durante la take: marker nel punto da togliere. Dopo: segna l’ultimo take | F8 |
| Nuovo capitolo | Passa alla sezione successiva della scaletta e mette un marker col suo nome | F6 |
| Scarta ultimo take | Ferma la take in corso (se c’è) e segna l’ultimo take come scartato | Shift+F9 |

Scartare non cancella niente: il file resta su disco, segnato come scartato.

### Pedale MIDI

Collega il pedale (o la pedaliera) all’interfaccia o via USB, poi in alto clicca
**Pedale › Assegna** accanto a un comando e premi il pedale. Takeline capisce da solo se è
momentaneo o a scatto e ignora i rimbalzi entro 300 ms. Note, Control Change e Program
Change vanno tutti bene. La prima volta Windows/WebView2 può chiedere il permesso di
accedere ai dispositivi MIDI: consentilo.

I tasti sono il ripiego. Con **Scorciatoie globali** funzionano anche con Reaper o OBS in
primo piano (e quei tasti non arrivano più agli altri programmi).

### Take e sessioni

- **Video musicale (take continua):** Reaper registra **una sola take lunga** per tutta la
  sessione; OBS apre un file per ogni take. Ogni take diventa una **region con nome** in
  Reaper (“Blues in La · take 04”) e sul take viene salvata la posizione di Reaper
  all’istante in cui OBS ha aperto il file: è l’offset che collega video e audio. Con
  **Avvia sessione** Reaper inizia a registrare subito, anche il riscaldamento.
- **Formazione e Call:** Reaper (se usato) parte e si ferma insieme a OBS.

Prima di far partire Reaper Takeline porta il cursore alla fine del progetto, così una
registrazione non finisce mai sopra la precedente (con "torna all’inizio" attivo, invece,
riparte da zero). Un secondo avvia/ferma entro 1 secondo dall’avvio viene ignorato: un
doppio tocco non chiude la take appena aperta.

Nella lista dei take, oltre al file video, ogni riga ha **Ascolta in Reaper** (porta il
cursore all’inizio del take e avvia il play) e **Mostra il file audio** (chiede a Reaper,
tramite lo script bridge, quali WAV contengono il take e li ricorda).

**Cosa resta in Reaper lo decidi tu.** Nel preset, scheda Reaper, scegli tra *Niente*,
*Solo region* (una region con nome per take) e *Region e marker* (anche clap, buono, da
tagliare, capitoli). Servono lo script bridge: senza, Takeline non scrive niente nel
progetto. Sono solo un aiuto visivo: le posizioni dei take stanno nel database di Takeline,
quindi puoi cancellarli quando vuoi senza rompere niente.

**Cambio di progetto.** Ogni sessione lascia nel progetto di Reaper un contrassegno
invisibile (ProjExtState: non è un marker e non si vede nella timeline). Se prima di una
take Takeline trova un progetto diverso, chiude la sessione e ne apre una nuova da take 01;
in Impostazioni › Reaper puoi scegliere invece di continuare la numerazione. Se il
contrassegno manca (progetto mai salvato e riaperto) il peggio che succede è una sessione
nuova: nessun file viene toccato.

Il numero di take entra nel nome del file (`{take}`). Una sessione si chiude con **Fine
sessione** o applicando un altro preset; se l’app si chiude a metà, al riavvio la sessione
riprende da dove era.

### Replay buffer

Se il preset lo prevede, Takeline tiene sempre acceso il replay buffer di OBS e ne imposta
la durata (5 minuti di default). Quando succede qualcosa di buono mentre stavi solo
scaldando, un colpo di pedale lo salva; con la take continua di Reaper diventa anche una
region “replay” nell’audio. Il replay buffer va abilitato una volta in OBS:
**Impostazioni › Uscita › Buffer di replay**.

Al buffer di replay si appoggia anche il *backtrack* del plugin **Aitum Vertical Canvas**,
che non ne ha uno suo: se è acceso nel canvas verticale ma il buffer è disabilitato nel
profilo, a ogni REC OBS alza un dialogo «no replay buffer found» e il verticale non viene
registrato. Il pre-flight lo segnala prima che succeda.

### Clap

All’avvio di ogni take Takeline fa lampeggiare di bianco la stage view e suona un click
secco sull’uscita audio predefinita di Windows. Se quell’uscita è l’interfaccia, il click
finisce nel monitor out e quindi nella traccia guida di OBS. L’istante del clap viene
salvato sul take.

### Stage view

**Regia › Stage view** apre una finestra separata; con due monitor va a tutto schermo su
quello libero. Mostra REC, timecode grande, numero di take, sezione corrente e successiva
della scaletta, ultimo marker, stato di replay buffer, Reaper e pedale. Anche i messaggi
(“BUONO”, “TAKE 04 SCARTATO”, errori) compaiono qui, in grande. F11 o doppio clic
alternano il tutto schermo.

La finestra principale riapre dove e come l’avevi lasciata (posizione, dimensione,
massimizzata). La stage view no: si piazza da sé sul monitor libero a ogni apertura.

### Scaletta

Per le formazioni: scrivi le sezioni nella scheda Regia, una per riga. Alla prima take
parte la prima sezione; ogni **Nuovo capitolo** passa alla successiva e mette un marker
col suo nome, così a fine registrazione i capitoli sono già pronti.

### Script bridge per Reaper

L’interfaccia web di Reaper sa eseguire azioni, ma non creare region o marker **con
nome** (l’action 40296 indicata in origine per “region dalla selezione” in Reaper è
“seleziona tutte le tracce”). Takeline include un piccolo script Lua che lo fa:

1. **Impostazioni › Reaper · script bridge › Installa script** lo copia in
   `%APPDATA%\REAPER\Scripts\Takeline\takeline-bridge.lua`.
2. In Reaper: **Actions › Show action list › New action › Load ReaScript** e scegli il file.
3. Tasto destro sull’azione › **Copy selected action command ID** e incollalo in Takeline.
4. **Prova** deve rispondere `pong takeline`.

Se aggiorni Takeline, ripremi **Installa script**: il file viene sostituito nello stesso
percorso e il command ID resta lo stesso.

Senza script tutto funziona lo stesso, ma ogni take diventa una coppia di marker numerati.

## Sync tra video e audio

Video (OBS) e audio (Reaper) escono da due programmi con due clock diversi. Allineare
l’inizio non basta: con 20 ppm di differenza, dopo 10 minuti si è fuori di 12 ms.

1. **Traccia guida.** In OBS aggiungi una sorgente *Acquisizione ingresso audio* collegata
   al monitor out (o loopback) dell’interfaccia, e indicala nel preset (scheda OBS e file).
   È di qualità scarsa, ma contiene la stessa musica che registra Reaper. Senza traccia
   guida Takeline usa la prima traccia audio del video. Con l’uscita *Avanzata* di OBS,
   Takeline capisce da sola in quale traccia del file finisce la guida.
2. **Frame rate costante.** Applicando il preset Takeline controlla che OBS non usi l’uscita
   personalizzata FFmpeg (l’unica che può produrre frame rate variabile) e dopo ogni take
   verifica il file con ffprobe: fotogrammi contati contro fotogrammi attesi.
3. **Offset.** ffmpeg estrae un tratto della traccia guida e il tratto corrispondente del
   WAV di Reaper; una correlazione incrociata (GCC-PHAT) trova il punto esatto, al decimo
   di millisecondo.
4. **Drift.** La stessa misura si ripete verso la fine della take: dalla differenza esce il
   rapporto tra i due clock (in ppm). Serve una take di almeno 45 secondi circa.

Offset, drift, confidenza ed eventuali avvisi si salvano sul take e si vedono nella colonna
**Sync** della lista (passa sopra col mouse per i dettagli). Il sync parte da solo appena
Reaper si ferma (a fine take con start/stop, a fine sessione con la take continua), mai
durante una registrazione; si può anche rifare a mano.

Con **Crea video e audio sincronizzati** accanto al video nascono:

- `<nome>_sync.mp4`: il video originale, non ricodificato, con l’audio di Reaper allineato;
- `<nome>_audio_sync.wav`: lo stesso audio a 24 bit, lungo esattamente quanto il video.

L’audio non viene solo spostato: la velocità viene corretta con `asetrate` + `aresample`
(sovracampionando a 384 kHz, per una precisione di circa 3 ppm). I file originali non
vengono mai toccati.

Serve lo script bridge (versione aggiornata: dopo un aggiornamento di Takeline ripremi
**Installa script**).

## Post-produzione

A fine take (con la take continua: a fine sessione, dopo il sync) Takeline mette in coda le
lavorazioni scelte nella scheda **Post-produzione** del preset:

| Lavorazione | Cosa produce |
| --- | --- |
| Remux MKV → MP4 | `<nome>.mp4`, senza ricodifica (solo se OBS registra in MKV) |
| Tracce separate | `<nome>_traccia1.m4a`, `_traccia2…`: ogni traccia audio del video, senza perdite |
| Loudness | `<nome>_14LUFS.mp4`: `loudnorm` a due passate (misura, poi correzione lineare) |
| Export per piattaforma | `<nome>_youtube.mp4` (anche `vimeo`, `facebook`, `instagram`) |
| Capitoli YouTube | `<nome>_capitoli.txt`, dai marker “Nuovo capitolo” |
| EDL | `<nome>.edl` (montaggio, marker come locator) e `<nome>_marker_resolve.edl` |

Ogni lavorazione parte dal file migliore disponibile: il video con l’audio di Reaper
allineato, se c’è, poi il remux, poi l’originale; l’export parte dal file normalizzato.
**I file originali non vengono mai modificati.**

La **coda** sta nella scheda **Libreria**: stato e avanzamento di ogni lavoro, annulla
(ffmpeg viene fermato davvero e il file a metà cancellato), riprova. **Durante una
registrazione la coda si ferma**: il lavoro in corso torna in attesa e riparte dopo, così
OBS non perde fotogrammi. La coda sopravvive alla chiusura dell’app.

I capitoli YouTube seguono le regole di YouTube (il primo a 00:00, almeno tre, ognuno di
almeno 10 secondi): se non sono rispettate, Takeline lo segnala. Per Resolve: *Timeline ›
Import › Timeline Markers from EDL* con il file `_marker_resolve.edl`; Premiere importa il
file `.edl` come sequenza.

## Ciclo di vita dei file

Dodici take in 4K riempiono un disco in fretta. Nella scheda **Libreria**:

- ogni take ha uno **stato** (registrato, buono, da tagliare, scartato, **pubblicato**,
  archiviato) e mostra quanti file ha e quanto occupano;
- Takeline **propone**: spostare nel Cestino i take scartati, archiviare i pubblicati su un
  altro disco, o crearne un **proxy** leggero (720p) da tenere al posto dell’originale;
- **Archivia** sposta tutti i file del take nella cartella scelta (mai sovrascrivendo) e
  aggiorna la libreria;
- **Sposta nel Cestino** usa il Cestino di Windows: si può ancora recuperare.

Ogni azione chiede conferma mostrando l’elenco esatto dei file e il totale. Takeline tocca
solo i file del take (il video e quelli che ha prodotto lei), **mai i WAV di Reaper**, che
con la take continua contengono anche le altre take.

## Sicurezza: pre-flight, watchdog, recupero, consenso

### Pre-flight

Prima di ogni take (e quando premi **Controlla** nel pannello della Regia) Takeline
verifica: OBS connesso, preset applicato e coerente con OBS, cartella scrivibile, spazio
su disco, encoder (avvisa se è software in 4K), fotogrammi persi da OBS, frame rate
costante, sorgenti audio (traccia guida mutata = errore), Reaper raggiungibile con tracce
armate, script bridge, replay buffer, backtrack del canvas verticale, pedale MIDI, ffmpeg.

Ogni controllo ha un esito (ok, avviso, errore) e, se serve, un pulsante per risolvere
(*Connetti*, *Riapplica il preset*, *Arma tutte*, *Libera spazio*, *Configura*…). **Un
errore blocca la take** e il motivo compare in grande in stage view; un avviso no. Per non
far aspettare il pedale, se l’ultimo controllo pulito ha meno di 30 secondi non si ripete.

### Watchdog

Durante la registrazione, ogni 2 secondi:

| Situazione | Cosa fa |
| --- | --- |
| Spazio su disco sotto la soglia (5 GB) | Ferma la take in modo pulito; al doppio della soglia avvisa |
| Fotogrammi persi oltre la soglia (5%, dall’inizio della take) | Ferma la take; a un quarto della soglia avvisa |
| Reaper non risponde o non sta registrando | Avviso fisso in stage view |
| OBS si disconnette | Allarme e attesa fino a 30 s: se torna e registra ancora, si continua; se si è riavviato o non torna, il take viene chiuso (con Reaper, se start/stop) |

Gli allarmi restano visibili in stage view finché durano. Soglie e interruttori in
**Impostazioni › Sicurezza**.

### Recupero della sessione

Se Takeline si chiude durante una take, al riavvio: se OBS sta ancora registrando la take
viene **riagganciata** (il pedale la ferma come sempre); altrimenti Takeline cerca il file
nella cartella di registrazione e chiude il take con quello che trova.

### Consenso per le call

Con il preset **Call** (o qualunque preset con il promemoria attivo) la prima take di
ogni sessione apre un promemoria: in Unione Europea chi partecipa a una riunione deve
sapere che viene registrata. Si registra solo dopo *Tutti d’accordo, registra*. Testo
personalizzabile e disattivabile nel preset (scheda Registrazione).

## Patchbay

La schermata principale mostra la catena del segnale com'è adesso, letta da OBS e
Reaper: tracce armate e livelli in Reaper, sorgenti audio e livelli in OBS (con la
traccia guida evidenziata), collezione, profilo e scena confrontati con il preset attivo,
cartella di registrazione, spazio libero e presenza di ffmpeg.

## Collaudo

`docs/collaudo.html` è la checklist passo per passo per provare tutto con strumenti veri
(chitarra, interfaccia, pedale, OBS e Reaper): cosa fare, cosa deve succedere, cosa
annotare se non va.

## Struttura

```
src/                     frontend React + TypeScript
  lib/engine/            RecordingEngine (contratto) e ObsEngine (obs-websocket)
  lib/applicaPreset.ts   sequenza di applicazione del preset
  lib/regia.ts           transport: sessioni, take, region, marker, clap, replay, watchdog
  lib/preflight.ts       controlli prima del REC
  lib/*.test.ts          test (vitest): transport con OBS e Reaper simulati, nomi
  lib/midi.ts            pedale (WebMIDI) con apprendimento
  lib/stage.ts           canale verso la stage view
  lib/model.ts           schema e default di preset e impostazioni
  lib/naming.ts          template dei nomi
  store/                 stato dell'app (zustand)
  components/            interfaccia
src-tauri/src/           backend Rust
  reaper.rs              HTTP verso l'interfaccia web di Reaper
  obs_backup.rs          backup della configurazione di OBS
  docs.rs                lettura/scrittura sicura di presets.json e impostazioni
  db.rs                  SQLite (rusqlite, migrazioni numerate)
  libreria.rs            sessioni, take e marker
  sync.rs                sync video-audio: correlazione, drift, verifica CFR, export
  post.rs                coda di post-produzione (ffmpeg con avanzamento e annullamento)
  ciclo.rs               libreria, archivio, Cestino, capitoli YouTube ed EDL
  system.rs              spazio disco, cartelle, ffmpeg, finestra attiva (Win32)
  ffmpeg.rs              installazione di ffmpeg: winget, altrimenti download
src-tauri/reaper/        script Lua "Takeline bridge" per Reaper
script/                  script .bat di sviluppo
```

Il motore video sta dietro l'interfaccia `RecordingEngine`: OBS è la prima
implementazione. Siccome obs-websocket gira nel frontend, il contratto è un'interfaccia
TypeScript (l'equivalente del trait Rust).

## Licenza

[MIT](LICENSE). OBS Studio è GPLv2 ed è usato solo come programma esterno, via websocket.
