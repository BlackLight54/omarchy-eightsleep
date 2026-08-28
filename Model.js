// Pure functions for the Eight Sleep widget. No QML types in here so the whole
// file runs under `node --test test/` as well as inside the shell.
//
// Input is the JSON printed by bin/eightsleep-api; output is plain objects the
// QML binds to directly.

// Nerd Font Material Design glyphs.
var BAR_GLYPH = "󰋣"          // md-bed
var GLYPH = {
  bed: "󰋣",                  // md-bed
  sleep: "󰒲",              // md-sleep
  heating: "󰈸",             // md-fire
  cooling: "󰜗",             // md-snowflake
  holding: "󰔏",           // md-thermometer
  off: "󰐥",                // md-power
  heart: "󰗶",              // md-heart_pulse
  alert: "󰀦",              // md-alert
  water: "󰖍",              // md-water_off
  offline: "󰖪",          // md-wifi_off
  copy: "󰆏",                // md-content_copy
  key: "󰌆"                   // md-key
}

// Eight Sleep's raw level scale. The app shows -10..+10; the API uses -100..100
// in steps the app never exposes, so one app step is 10 raw units.
var LEVEL_MIN = -100
var LEVEL_MAX = 100
var LEVEL_STEP = 10

// Raw level → approximate surface temperature. These are the mapping points the
// mobile app uses (via pyEight's constants); anything between is interpolated.
var LEVEL_TO_C = [
  [-100, 13], [-97, 14], [-94, 15], [-91, 16], [-83, 17], [-75, 18], [-67, 19], [-58, 20],
  [-50, 21], [-42, 22], [-33, 23], [-25, 24], [-17, 25], [-8, 26], [0, 27], [6, 28],
  [11, 29], [17, 30], [22, 31], [28, 32], [33, 33], [39, 34], [44, 35], [50, 36],
  [56, 37], [61, 38], [67, 39], [72, 40], [78, 41], [83, 42], [89, 43], [100, 44]
]
var LEVEL_TO_F = [
  [-100, 55], [-99, 56], [-97, 57], [-95, 58], [-94, 59], [-92, 60], [-90, 61], [-86, 62],
  [-81, 63], [-77, 64], [-72, 65], [-68, 66], [-63, 67], [-58, 68], [-54, 69], [-49, 70],
  [-44, 71], [-40, 72], [-35, 73], [-31, 74], [-26, 75], [-21, 76], [-17, 77], [-12, 78],
  [-7, 79], [-3, 80], [1, 81], [4, 82], [7, 83], [10, 84], [14, 85], [17, 86],
  [20, 87], [23, 88], [26, 89], [29, 90], [32, 91], [35, 92], [38, 93], [41, 94],
  [44, 95], [48, 96], [51, 97], [54, 98], [57, 99], [60, 100], [63, 101], [66, 102],
  [69, 103], [72, 104], [75, 105], [78, 106], [81, 107], [85, 108], [88, 109], [92, 110], [100, 111]
]

// Everything below this line that touches `raw` is treating the API response
// as untrusted input. The bridge already caps the bytes that reach us; these
// bounds keep one hostile field from turning into a wall of text layout.
var MAX_TEXT = 200
var MAX_NAME = 40
var IN_BED_WINDOW_MS = 10 * 60 * 1000

var CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g
var LINE_BREAKS = /[\r\n\t\u2028\u2029]+/g

// One-line, plain, bounded. Angle brackets become ‹ › — same look, but nothing
// can parse them as a tag. Strings from here reach Qt components we do not own
// (the bar tooltip, notification bodies) where the text format is theirs to
// choose, and Qt's AutoText treats anything tag-shaped as rich text.
function trim(s, limit) {
  var out = String(s === undefined || s === null ? "" : s)
    .replace(CONTROL_CHARS, "")
    .replace(LINE_BREAKS, " ")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/^\s+|\s+$/g, "")
  var max = limit || MAX_TEXT
  if (out.length > max) out = out.slice(0, max - 1) + "…"
  return out
}

// Finite number or null. Numeric strings are accepted; nothing else is.
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : null
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    var parsed = parseFloat(v)
    return isFinite(parsed) ? parsed : null
  }
  return null
}

function clampLevel(level) {
  var n = num(level)
  if (n === null) return 0
  return Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.round(n)))
}

// Snap to the app's whole-step scale so ↑/↓ from an odd device level lands on
// a value the app would show.
function stepLevel(level, delta) {
  var base = Math.round(clampLevel(level) / LEVEL_STEP) * LEVEL_STEP
  return clampLevel(base + delta)
}

function interpolate(table, x) {
  if (x <= table[0][0]) return table[0][1]
  var last = table[table.length - 1]
  if (x >= last[0]) return last[1]
  for (var i = 1; i < table.length; i++) {
    var a = table[i - 1], b = table[i]
    if (x <= b[0]) {
      if (b[0] === a[0]) return b[1]
      return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
    }
  }
  return last[1]
}

// Raw level → whole degrees in "C" or "F".
function levelToTemp(level, unit) {
  var n = num(level)
  if (n === null) return null
  return Math.round(interpolate(unit === "F" ? LEVEL_TO_F : LEVEL_TO_C, n))
}

function formatTemp(level, unit) {
  var t = levelToTemp(level, unit)
  return t === null ? "" : t + " °" + (unit === "F" ? "F" : "C")
}

// Raw level → the app's scale: "+3", "−2", "0".
function formatLevel(level) {
  var n = num(level)
  if (n === null) return ""
  var app = Math.round(n / LEVEL_STEP)
  if (app === 0) return "0"
  return (app > 0 ? "+" : "−") + Math.abs(app)
}

function formatDuration(seconds) {
  var s = num(seconds)
  if (s === null || s < 0) return ""
  var m = Math.round(s / 60)
  var h = Math.floor(m / 60)
  m = m % 60
  if (h === 0) return m + "m"
  return h + "h " + (m < 10 ? "0" : "") + m + "m"
}

function pad2(n) { return (n < 10 ? "0" : "") + n }
function clock(date) { return pad2(date.getHours()) + ":" + pad2(date.getMinutes()) }

var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()) }
function dayDiff(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000) }
function shortDate(date) { return DAY_NAMES[date.getDay()] + " " + date.getDate() + " " + MONTH_NAMES[date.getMonth()] }

// ISO 8601 (the API sends "2026-08-28T21:14:00.000Z") or epoch seconds → Date|null.
function parseTime(value) {
  if (value === undefined || value === null || value === "") return null
  var n = num(value)
  if (n !== null) {
    if (n <= 0) return null
    var fromEpoch = new Date(n > 1e11 ? n : n * 1000)
    return isNaN(fromEpoch.getTime()) ? null : fromEpoch
  }
  var s = trim(value, 64)
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null
  var d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// "just now", "4m ago", "3h ago", "yesterday 14:02", "Mon 24 Aug"
function formatRelative(date, now) {
  if (!date) return ""
  now = now || new Date()
  var seconds = Math.round((now - date) / 1000)
  if (seconds < 45) return "just now"
  if (seconds < 3600) return Math.max(1, Math.round(seconds / 60)) + "m ago"
  if (seconds < 21600) return Math.round(seconds / 3600) + "h ago"
  var days = dayDiff(now, date)
  if (days === 0) return "today " + clock(date)
  if (days === 1) return "yesterday " + clock(date)
  return shortDate(date)
}

// "Last night", "Thu night", "Sun 24 Aug" for a session by its presence start.
function formatNightLabel(start, now) {
  if (!start) return ""
  now = now || new Date()
  // A session that began after 18:00 belongs to the following morning; one
  // whose morning is today is "last night", one still ahead is "tonight".
  var morning = new Date(start.getTime() + (start.getHours() >= 18 ? 86400000 : 0))
  var days = dayDiff(now, morning)
  if (days < 0) return "Tonight"
  if (days === 0) return "Last night"
  if (days < 7) return DAY_NAMES[start.getDay()] + " night"
  return shortDate(start)
}

function timeRange(start, end) {
  if (!start) return ""
  return end ? clock(start) + "–" + clock(end) : "since " + clock(start)
}

// ---- Bed side -----------------------------------------------------------------

// currentState.type is "off", "smart" or "smart:<phase>" while Autopilot runs
// its schedule. Returns "" when not on Autopilot.
var PHASE_LABELS = { bedtime: "bedtime", initial: "early night", final: "late night" }
function autopilotPhase(stateType) {
  var s = trim(stateType, 32).toLowerCase()
  if (s.indexOf("smart") !== 0) return ""
  var phase = s.indexOf(":") > 0 ? s.slice(s.indexOf(":") + 1) : ""
  return PHASE_LABELS[phase] || phase || "on"
}

// Solo beds report their state under the left keys.
function sideKey(side) {
  var s = trim(side, 16).toLowerCase()
  return s === "right" ? "right" : "left"
}

function sideLabel(side) {
  var s = trim(side, 16).toLowerCase()
  if (s === "left" || s === "right") return s.charAt(0).toUpperCase() + s.slice(1) + " side"
  return "Bed"
}

// device = client-api /devices/{id}.result (scalars only, by the bridge);
// temperature = app-api /users/{id}/temperature.
function normalizeBed(device, temperature, side, fetchedAt) {
  device = device && typeof device === "object" ? device : {}
  temperature = temperature && typeof temperature === "object" ? temperature : {}
  var key = sideKey(side)

  var stateType = ""
  if (temperature.currentState && typeof temperature.currentState === "object")
    stateType = trim(temperature.currentState.type, 32).toLowerCase()

  var target = num(temperature.currentLevel)
  if (target === null) target = num(device[key + "TargetHeatingLevel"])
  var current = num(temperature.currentDeviceLevel)
  if (current === null) current = num(device[key + "HeatingLevel"])
  var nowHeating = device[key + "NowHeating"] === true

  // Without a state type (older firmware), "the pump is running" is the best
  // signal we have that the side is on.
  var on = stateType ? stateType !== "off" : nowHeating
  var direction = "off"
  if (on) {
    if (nowHeating && target !== null && target > 0) direction = "heating"
    else if (nowHeating && target !== null && target < 0) direction = "cooling"
    else direction = "holding"
  }

  var smart = null
  if (temperature.smart && typeof temperature.smart === "object") {
    smart = {
      bedTime: num(temperature.smart.bedTimeLevel),
      initialSleep: num(temperature.smart.initialSleepLevel),
      finalSleep: num(temperature.smart.finalSleepLevel)
    }
  }

  var presenceEnd = parseTime(device[key + "PresenceEnd"])
  var presenceStart = parseTime(device[key + "PresenceStart"])

  return {
    side: key,
    label: sideLabel(side),
    model: trim(device.modelString, 32),
    on: on,
    stateType: stateType,
    autopilot: autopilotPhase(stateType),
    direction: direction,
    glyph: GLYPH[direction] || GLYPH.holding,
    targetLevel: target,
    deviceLevel: current,
    nowHeating: nowHeating,
    remainingSec: num(device[key + "HeatingDuration"]),
    // Older pods report presence per side: a start more recent than the end
    // means someone is on the mattress. Pod 5 omits these; parseResponse falls
    // back to a recent heart-rate sample, as pyEight does.
    inBed: !!presenceStart && (!presenceEnd || presenceStart.getTime() > presenceEnd.getTime()),
    hasPresence: !!presenceStart || !!presenceEnd,
    lastInBed: presenceEnd,
    online: device.online !== false,
    needsPriming: device.needsPriming === true,
    hasWater: device.hasWater !== false,
    priming: device.priming === true,
    lastHeard: parseTime(device.lastHeard),
    smart: smart
  }
}

// Problems worth the urgent colour and a notification: the bed can't do its job.
function bedAlerts(bed) {
  var out = []
  if (!bed) return out
  if (!bed.online) out.push({ code: "offline", glyph: GLYPH.offline, text: "Pod offline" })
  if (!bed.hasWater) out.push({ code: "water", glyph: GLYPH.water, text: "Water tank empty" })
  else if (bed.needsPriming) out.push({ code: "prime", glyph: GLYPH.alert, text: "Needs priming" })
  return out
}

// ---- Sleep session ------------------------------------------------------------

// Last sample of a timeseries: entries are [isoTime, value] pairs. The bridge
// trims each series to its last pair, but accept a full series too.
function lastSample(series) {
  if (!Array.isArray(series) || !series.length) return null
  var last = series[series.length - 1]
  if (!Array.isArray(last) || last.length < 2) return null
  var v = num(last[1])
  if (v === null) return null
  return { time: parseTime(last[0]), value: v }
}

function sampleValue(sample) { return sample ? sample.value : null }

function lastSession(day) {
  if (!day || !Array.isArray(day.sessions)) return null
  for (var i = day.sessions.length - 1; i >= 0; i--) {
    if (day.sessions[i] && typeof day.sessions[i] === "object") return day.sessions[i]
  }
  return null
}

function hasSleepData(day) {
  if (!day || typeof day !== "object") return false
  return num(day.score) !== null || !!parseTime(day.presenceStart) || !!lastSession(day)
}

// One trends "day" → the panel's night card. Returns null for a day with nothing in it.
function normalizeNight(day, fetchedAt) {
  if (!hasSleepData(day)) return null
  var session = lastSession(day)
  var ts = session && session.timeseries && typeof session.timeseries === "object" ? session.timeseries : {}
  var quality = day.sleepQualityScore && typeof day.sleepQualityScore === "object" ? day.sleepQualityScore : {}
  var routine = day.sleepRoutineScore && typeof day.sleepRoutineScore === "object" ? day.sleepRoutineScore : {}

  var sleepSec = num(day.sleepDuration)
  var presenceSec = num(day.presenceDuration)
  var awakeSec = sleepSec !== null && presenceSec !== null ? Math.max(0, presenceSec - sleepSec) : null

  var stage = ""
  if (session && Array.isArray(session.stages) && session.stages.length) {
    // The API appends an "awake" stage while a session is still processing.
    var idx = session.stages.length - 1
    if (day.processing === true && idx > 0) idx -= 1
    var st = session.stages[idx]
    stage = st && typeof st === "object" ? trim(st.stage, 16).toLowerCase() : ""
  }

  var heart = lastSample(ts.heartRate)
  var hrv = num(quality.hrv && quality.hrv.current)
  if (hrv === null) hrv = sampleValue(lastSample(ts.hrv))
  var resp = num(quality.respiratoryRate && quality.respiratoryRate.current)
  if (resp === null) resp = sampleValue(lastSample(ts.respiratoryRate))

  var start = parseTime(day.presenceStart)
  var end = parseTime(day.presenceEnd)
  var processing = day.processing === true || (!!start && !end)

  return {
    day: trim(day.day, 10),
    processing: processing,
    score: num(day.score),
    qualityScore: num(quality.total),
    routineScore: num(routine.total),
    sleepSec: sleepSec,
    presenceSec: presenceSec,
    stages: { light: num(day.lightDuration), deep: num(day.deepDuration), rem: num(day.remDuration), awake: awakeSec },
    tossTurns: num(day.tnt),
    start: start,
    end: end,
    currentStage: stage,
    heartRate: sampleValue(heart),
    heartRateAt: heart ? heart.time : null,
    hrv: hrv,
    respiratoryRate: resp,
    roomTempC: sampleValue(lastSample(ts.tempRoomC)),
    bedTempC: sampleValue(lastSample(ts.tempBedC))
  }
}

// Most recent day with any sleep data. Trends come oldest-first; don't trust it.
function pickNight(days, fetchedAt) {
  if (!Array.isArray(days)) return null
  var best = null
  for (var i = 0; i < days.length; i++) {
    var n = normalizeNight(days[i], fetchedAt)
    if (!n) continue
    if (!best || (n.day && n.day > best.day)) best = n
  }
  return best
}

// ---- Response -------------------------------------------------------------------

// bin/eightsleep-api output → view model. Never throws.
function parseResponse(raw) {
  var result = {
    ok: false, error: "", message: "", stale: false, cached: false,
    fetchedAt: 0, firstName: "", side: "left", bed: null, night: null, alerts: []
  }
  var data
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw
  } catch (e) {
    result.error = "bad-response"
    result.message = "Unreadable response from eightsleep-api."
    return result
  }
  if (!data || typeof data !== "object") {
    result.error = "bad-response"
    result.message = "Empty response from eightsleep-api."
    return result
  }
  result.error = trim(data.error, 40)
  result.message = trim(data.message, 300)
  result.stale = data.stale === true
  result.cached = data.cached === true
  result.fetchedAt = typeof data.fetchedAt === "number" ? data.fetchedAt * 1000 : 0
  if (data.ok !== true) return result

  var user = data.user && typeof data.user === "object" ? data.user : null
  // A success object without the device or temperature block is not a state
  // we can show; never let it read as "bed off".
  if (!user || !data.device || typeof data.device !== "object" || !data.temperature || typeof data.temperature !== "object") {
    result.error = "bad-response"
    result.message = "Response carried no bed state."
    return result
  }
  result.firstName = trim(user.firstName, MAX_NAME)
  result.side = sideKey(user.side)
  result.bed = normalizeBed(data.device, data.temperature, user.side, result.fetchedAt)
  result.night = pickNight(data.trends && data.trends.days, result.fetchedAt)
  // No presence sensors reported: a heart-rate sample in the last ten minutes
  // of a session still in progress means someone is in bed.
  if (!result.bed.hasPresence && result.night && result.night.processing && result.night.heartRateAt && result.fetchedAt) {
    result.bed.inBed = result.fetchedAt - result.night.heartRateAt.getTime() < IN_BED_WINDOW_MS
  }
  result.alerts = bedAlerts(result.bed)
  result.ok = true
  return result
}

// ---- Presentation ---------------------------------------------------------------

// Bar badge. `mode` chooses the number: level (app scale), temp, or score.
function badgeText(model, mode, unit) {
  if (!model || !model.bed) return BAR_GLYPH
  var bed = model.bed
  if (model.alerts && model.alerts.length) return model.alerts[0].glyph
  if (mode === "score") {
    if (model.night && model.night.score !== null && !model.night.processing) return GLYPH.sleep + " " + model.night.score
    return bed.on ? BAR_GLYPH + " " + formatLevel(bed.targetLevel) : BAR_GLYPH
  }
  if (!bed.on) return BAR_GLYPH
  if (mode === "temp") {
    var t = levelToTemp(bed.deviceLevel !== null ? bed.deviceLevel : bed.targetLevel, unit)
    return bed.glyph + (t === null ? "" : " " + t + "°")
  }
  return bed.glyph + " " + formatLevel(bed.targetLevel)
}

function badgeUrgent(model) {
  return !!model && !!model.alerts && model.alerts.length > 0
}

// Header line: "Left side · cooling to −3 (24 °C)", "Left side off", "Pod offline"
function summaryLine(model, unit) {
  if (!model || !model.bed) return "Not connected"
  if (model.alerts && model.alerts.length) return model.alerts[0].text
  var bed = model.bed
  if (!bed.on) return bed.label + " off"
  var level = formatLevel(bed.targetLevel)
  var temp = formatTemp(bed.targetLevel, unit)
  var verb = bed.direction === "heating" ? "warming to" : (bed.direction === "cooling" ? "cooling to" : "holding")
  return bed.label + " · " + verb + " " + level + (temp ? " (" + temp + ")" : "")
}

// "Score 87 · 7h 12m", "Sleeping · deep", "No sleep data yet"
function nightSummary(night) {
  if (!night) return "No sleep data yet"
  if (night.processing) {
    var stage = night.currentStage && night.currentStage !== "awake" ? " · " + night.currentStage : ""
    return "In progress" + stage + (night.sleepSec ? " · " + formatDuration(night.sleepSec) : "")
  }
  var parts = []
  if (night.score !== null) parts.push("Score " + night.score)
  if (night.sleepSec !== null) parts.push(formatDuration(night.sleepSec))
  return parts.length ? parts.join(" · ") : "Processing"
}

// Fraction of the night per stage, for the stacked bar. Sums to ≤ 1; a
// missing or negative duration counts as zero so no bar segment goes negative.
function stageFractions(night) {
  var out = { light: 0, deep: 0, rem: 0, awake: 0 }
  if (!night || !night.stages) return out
  var total = 0
  var clean = {}
  for (var k in out) {
    var v = num(night.stages[k])
    clean[k] = v !== null && v > 0 ? v : 0
    total += clean[k]
  }
  if (total <= 0) return out
  for (var j in out) out[j] = clean[j] / total
  return out
}

// ---- Notifications --------------------------------------------------------------

// Two consecutive fetches → desktop notifications. Fires when a night's score
// arrives (a new day, or the day stops processing) and when a bed alert appears.
function diffModels(previous, next) {
  var changes = []
  // First sight of anything is not a change: the phone already told you.
  if (!previous || !previous.ok || !next || !next.ok) return changes
  var prevNight = previous && previous.night
  var night = next.night
  if (night && night.score !== null && !night.processing) {
    var fresh = !prevNight || prevNight.day !== night.day || prevNight.processing || prevNight.score === null
    if (fresh) changes.push({ kind: "score", night: night })
  }
  var before = {}
  var prevAlerts = previous && previous.alerts ? previous.alerts : []
  for (var i = 0; i < prevAlerts.length; i++) before[prevAlerts[i].code] = true
  for (var j = 0; j < next.alerts.length; j++) {
    if (!before[next.alerts[j].code]) changes.push({ kind: "alert", alert: next.alerts[j] })
  }
  return changes
}

function notificationFor(change) {
  if (change.kind === "alert") {
    return { headline: change.alert.text, body: "Eight Sleep needs attention", glyph: change.alert.glyph, urgency: "normal" }
  }
  var n = change.night
  var bits = []
  if (n.sleepSec !== null) bits.push(formatDuration(n.sleepSec) + " asleep")
  if (n.hrv !== null) bits.push("HRV " + Math.round(n.hrv))
  if (n.respiratoryRate !== null) bits.push(Math.round(n.respiratoryRate * 10) / 10 + " breaths/min")
  return { headline: "Sleep score " + n.score, body: bits.join(" · ") || "Last night's sleep is in", glyph: GLYPH.sleep, urgency: "low" }
}

var SETUP_COMMANDS = [
  "secret-tool store --label='Eight Sleep email' service omarchy-eightsleep key email",
  "secret-tool store --label='Eight Sleep password' service omarchy-eightsleep key password"
]

if (typeof module !== "undefined") {
  module.exports = {
    BAR_GLYPH: BAR_GLYPH,
    GLYPH: GLYPH,
    LEVEL_MIN: LEVEL_MIN,
    LEVEL_MAX: LEVEL_MAX,
    LEVEL_STEP: LEVEL_STEP,
    MAX_TEXT: MAX_TEXT,
    SETUP_COMMANDS: SETUP_COMMANDS,
    trim: trim,
    num: num,
    clampLevel: clampLevel,
    stepLevel: stepLevel,
    levelToTemp: levelToTemp,
    formatTemp: formatTemp,
    formatLevel: formatLevel,
    formatDuration: formatDuration,
    formatRelative: formatRelative,
    formatNightLabel: formatNightLabel,
    timeRange: timeRange,
    parseTime: parseTime,
    sideKey: sideKey,
    autopilotPhase: autopilotPhase,
    normalizeBed: normalizeBed,
    bedAlerts: bedAlerts,
    normalizeNight: normalizeNight,
    pickNight: pickNight,
    parseResponse: parseResponse,
    badgeText: badgeText,
    badgeUrgent: badgeUrgent,
    summaryLine: summaryLine,
    nightSummary: nightSummary,
    stageFractions: stageFractions,
    diffModels: diffModels,
    notificationFor: notificationFor
  }
}
