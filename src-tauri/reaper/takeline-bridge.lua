-- Takeline bridge per REAPER
--
-- Takeline scrive un comando in ExtState("Takeline", "cmd") tramite
-- l'interfaccia web e subito dopo esegue questo script col suo command ID.
-- Lo script esegue il comando e scrive l'esito in ExtState("Takeline", "ack").
--
-- Comandi (campi separati da TAB):
--   ping      <testo>
--   marker    <posizione_s> <nome> <tipo>
--   region    <inizio_s> <fine_s> <nome> <tipo>
--   rinomina  <inizio_s> <nome> <tipo>      (region che parte a inizio_s)
--   sorgenti  <posizione_s>                 (file audio degli item in quel punto)
--
-- "sorgenti" risponde "ok " seguito da una voce per file, separate da "|";
-- ogni voce e' file*inizio_item*offset_nel_file*velocita (per tradurre la
-- posizione nel progetto in posizione nel file).
--
-- tipo sceglie il colore: take, buono, taglia, capitolo, clap, replay, scartato.
--
-- Installazione: Actions > Show action list > New action > Load ReaScript,
-- scegli questo file, poi tasto destro sull'azione > Copy selected action
-- command ID e incollalo in Takeline > Impostazioni > Reaper.

local SEZIONE = "Takeline"

local COLORI = {
  take = { 120, 130, 145 },
  buono = { 52, 199, 120 },
  taglia = { 230, 72, 72 },
  capitolo = { 70, 140, 235 },
  clap = { 240, 200, 60 },
  replay = { 170, 110, 230 },
  scartato = { 110, 40, 40 },
}

local function colore(tipo)
  local c = COLORI[tipo or ""]
  if not c then return 0 end
  return reaper.ColorToNative(c[1], c[2], c[3]) | 0x1000000
end

local function campi(testo)
  local out = {}
  for campo in (testo .. "\t"):gmatch("([^\t]*)\t") do
    out[#out + 1] = campo
  end
  return out
end

local cmd = reaper.GetExtState(SEZIONE, "cmd")
if cmd == "" then return end
reaper.DeleteExtState(SEZIONE, "cmd", false)

local p = campi(cmd)
local esito = "ok"

if p[1] == "ping" then
  esito = "pong " .. (p[2] or "")
elseif p[1] == "marker" then
  reaper.AddProjectMarker2(0, false, tonumber(p[2]) or 0, 0, p[3] or "", -1, colore(p[4]))
elseif p[1] == "region" then
  reaper.AddProjectMarker2(0, true, tonumber(p[2]) or 0, tonumber(p[3]) or 0, p[4] or "", -1, colore(p[5]))
elseif p[1] == "rinomina" then
  local inizio = tonumber(p[2]) or -1
  local trovata = false
  local i = 0
  while true do
    local ok, isrgn, pos, fine, _, idx = reaper.EnumProjectMarkers3(0, i)
    if ok == 0 then break end
    if isrgn and math.abs(pos - inizio) < 0.05 then
      reaper.SetProjectMarker3(0, idx, true, pos, fine, p[3] or "", colore(p[4]))
      trovata = true
      break
    end
    i = i + 1
  end
  if not trovata then esito = "region non trovata" end
elseif p[1] == "sorgenti" then
  local pos = tonumber(p[2]) or 0
  local visti, file = {}, {}
  for i = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, i)
    local inizio = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
    local fine = inizio + reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
    local take = reaper.GetActiveTake(item)
    if pos >= inizio and pos <= fine and take and not reaper.TakeIsMIDI(take) then
      local sorgente = reaper.GetMediaItemTake_Source(take)
      sorgente = reaper.GetMediaSourceParent(sorgente) or sorgente
      local nome = reaper.GetMediaSourceFileName(sorgente)
      if nome ~= "" and not visti[nome] then
        visti[nome] = true
        local offset = reaper.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS")
        local velocita = reaper.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE")
        file[#file + 1] = string.format("%s*%.6f*%.6f*%.6f", nome, inizio, offset, velocita)
      end
    end
  end
  esito = "ok " .. table.concat(file, "|")
else
  esito = "comando sconosciuto: " .. tostring(p[1])
end

reaper.SetExtState(SEZIONE, "ack", esito, false)
reaper.UpdateTimeline()
