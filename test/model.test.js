// Run with: node --test test/
const test = require("node:test")
const assert = require("node:assert/strict")
const Model = require("../Model.js")

const NOW = new Date(2026, 7, 29, 8, 30) // Sat 29 Aug 2026 08:30 local
const FETCHED = Math.floor(NOW.getTime() / 1000)

// A bridge response shaped like bin/eightsleep-api prints it. Fixture values
// are invented; field names follow the API as pyEight documents it.
function response(overrides) {
  const base = {
    ok: true, fetchedAt: FETCHED, cached: false, stale: false,
    user: { userId: "u1", firstName: "Sam", side: "left" },
    device: {
      deviceId: "d1", online: true, needsPriming: false, hasWater: true, priming: false,
      lastHeard: "2026-08-29T08:29:10.000Z",
      leftHeatingLevel: -28, leftTargetHeatingLevel: -30, leftNowHeating: true, leftHeatingDuration: 3600,
      leftPresenceStart: 1787000000, leftPresenceEnd: 1787001000,
      rightHeatingLevel: 0, rightTargetHeatingLevel: 10, rightNowHeating: false
    },
    temperature: {
      currentLevel: -30, currentDeviceLevel: -28,
      currentState: { type: "smart" },
      smart: { bedTimeLevel: 10, initialSleepLevel: -20, finalSleepLevel: -30 }
    },
    trends: { days: [
      { day: "2026-08-28", score: 79, processing: false, sleepDuration: 25200, presenceDuration: 27000,
        lightDuration: 12000, deepDuration: 7200, remDuration: 6000, tnt: 12,
        presenceStart: "2026-08-27T13:30:00.000Z", presenceEnd: "2026-08-27T21:00:00.000Z",
        sleepQualityScore: { total: 80, hrv: { current: 41 }, respiratoryRate: { current: 14.6 } },
        sleepRoutineScore: { total: 78 },
        sessions: [{ stages: [{ stage: "rem", duration: 600 }, { stage: "awake", duration: 300 }],
          timeseries: { heartRate: [["2026-08-27T20:58:00.000Z", 52]], tempRoomC: [["2026-08-27T20:58:00.000Z", 21.5]] } }] },
      { day: "2026-08-29", score: 87, processing: false, sleepDuration: 26100, presenceDuration: 28800,
        lightDuration: 13000, deepDuration: 7100, remDuration: 6000, tnt: 9,
        presenceStart: "2026-08-28T13:10:00.000Z", presenceEnd: "2026-08-28T21:10:00.000Z",
        sleepQualityScore: { total: 88, hrv: { current: 46 }, respiratoryRate: { current: 15.1 } },
        sleepRoutineScore: { total: 84 },
        sessions: [{ stages: [{ stage: "deep", duration: 600 }, { stage: "awake", duration: 300 }],
          timeseries: { heartRate: [["2026-08-28T21:05:00.000Z", 49]], tempRoomC: [["2026-08-28T21:05:00.000Z", 20.8]], tempBedC: [["2026-08-28T21:05:00.000Z", 27.2]] } }] }
    ] }
  }
  return JSON.stringify(Object.assign(base, overrides || {}))
}

function withDeep(o, path, value) {
  const copy = JSON.parse(JSON.stringify(o))
  let cur = copy
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]]
  cur[path[path.length - 1]] = value
  return copy
}

test("level ↔ temperature mapping", () => {
  assert.equal(Model.levelToTemp(0, "C"), 27)
  assert.equal(Model.levelToTemp(-100, "C"), 13)
  assert.equal(Model.levelToTemp(100, "C"), 44)
  assert.equal(Model.levelToTemp(-30, "C"), 23, "interpolated between -33→23 and -25→24, rounded")
  assert.equal(Model.levelToTemp(0, "F"), 81)
  assert.equal(Model.levelToTemp(-100, "F"), 55)
  assert.equal(Model.levelToTemp(250, "C"), 44, "clamped above")
  assert.equal(Model.levelToTemp("abc", "C"), null)
  assert.equal(Model.formatTemp(-30, "C"), "23 °C")
  assert.equal(Model.formatTemp(null, "C"), "")
})

test("formatLevel uses the app's −10..+10 scale", () => {
  assert.equal(Model.formatLevel(-30), "−3")
  assert.equal(Model.formatLevel(25), "+3", "rounds to the nearest app step")
  assert.equal(Model.formatLevel(0), "0")
  assert.equal(Model.formatLevel(-4), "0")
  assert.equal(Model.formatLevel(undefined), "")
})

test("stepLevel snaps to whole steps and clamps", () => {
  assert.equal(Model.stepLevel(-28, 10), -20, "snaps -28 to -30 first, then steps")
  assert.equal(Model.stepLevel(-100, -10), -100)
  assert.equal(Model.stepLevel(95, 10), 100)
  assert.equal(Model.stepLevel("garbage", 10), 10)
  assert.equal(Model.clampLevel(-500), -100)
})

test("formatDuration and time helpers", () => {
  assert.equal(Model.formatDuration(25200), "7h 00m")
  assert.equal(Model.formatDuration(26100), "7h 15m")
  assert.equal(Model.formatDuration(2700), "45m")
  assert.equal(Model.formatDuration(-1), "")
  assert.equal(Model.formatDuration(null), "")
  assert.equal(Model.parseTime("2026-08-28T21:10:00.000Z").getTime(), Date.UTC(2026, 7, 28, 21, 10))
  assert.equal(Model.parseTime(1787000000).getTime(), 1787000000 * 1000, "epoch seconds")
  assert.equal(Model.parseTime(1787000000000).getTime(), 1787000000000, "epoch milliseconds")
  assert.equal(Model.parseTime("not a date"), null)
  assert.equal(Model.parseTime(0), null)
  assert.equal(Model.formatRelative(new Date(NOW - 4 * 60 * 1000), NOW), "4m ago")
  assert.equal(Model.formatRelative(new Date(2026, 7, 28, 14, 2), NOW), "yesterday 14:02")
  assert.equal(Model.formatNightLabel(new Date(2026, 7, 28, 23, 10), NOW), "Last night")
  assert.equal(Model.formatNightLabel(new Date(2026, 7, 29, 1, 40), NOW), "Last night", "a post-midnight start is still last night")
  assert.equal(Model.formatNightLabel(new Date(2026, 7, 29, 22, 0), new Date(2026, 7, 29, 23, 30)), "Tonight")
  assert.equal(Model.formatNightLabel(new Date(2026, 7, 26, 22, 0), NOW), "Wed night")
  assert.equal(Model.formatNightLabel(new Date(2026, 7, 10, 22, 0), NOW), "Mon 10 Aug")
  assert.equal(Model.timeRange(new Date(2026, 7, 28, 23, 10), new Date(2026, 7, 29, 7, 10)), "23:10–07:10")
  assert.equal(Model.timeRange(new Date(2026, 7, 28, 23, 10), null), "since 23:10")
})

test("parseResponse builds the bed and picks the newest night", () => {
  const m = Model.parseResponse(response())
  assert.equal(m.ok, true)
  assert.equal(m.firstName, "Sam")
  assert.equal(m.side, "left")
  assert.equal(m.fetchedAt, FETCHED * 1000)
  const bed = m.bed
  assert.equal(bed.on, true)
  assert.equal(bed.direction, "cooling")
  assert.equal(bed.targetLevel, -30)
  assert.equal(bed.deviceLevel, -28)
  assert.equal(bed.remainingSec, 3600)
  assert.equal(bed.inBed, false, "presence end is after presence start")
  assert.equal(bed.online, true)
  assert.deepEqual(bed.smart, { bedTime: 10, initialSleep: -20, finalSleep: -30 })
  assert.deepEqual(m.alerts, [])

  const night = m.night
  assert.equal(night.day, "2026-08-29", "newest day wins regardless of order")
  assert.equal(night.score, 87)
  assert.equal(night.processing, false)
  assert.equal(night.sleepSec, 26100)
  assert.equal(night.stages.awake, 2700)
  assert.equal(night.heartRate, 49)
  assert.equal(night.hrv, 46)
  assert.equal(night.respiratoryRate, 15.1)
  assert.equal(night.roomTempC, 20.8)
  assert.equal(night.bedTempC, 27.2)
  assert.equal(night.currentStage, "awake")
  assert.equal(night.tossTurns, 9)
})

test("autopilot phases and Pod 5 shapes", () => {
  assert.equal(Model.autopilotPhase("smart"), "on")
  assert.equal(Model.autopilotPhase("smart:final"), "late night")
  assert.equal(Model.autopilotPhase("smart:bedtime"), "bedtime")
  assert.equal(Model.autopilotPhase("smart:initial"), "early night")
  assert.equal(Model.autopilotPhase("smart:whatever"), "whatever")
  assert.equal(Model.autopilotPhase("off"), "")
  assert.equal(Model.autopilotPhase(undefined), "")
  // Pod 5: state "smart:final", level -4 (app shows 0), no presence fields, modelString.
  const raw = JSON.parse(response())
  raw.device = { deviceId: "d1", online: true, hasWater: true, needsPriming: false, modelString: "Pod 5",
    leftHeatingLevel: -4, leftTargetHeatingLevel: -4, leftNowHeating: true, leftHeatingDuration: 9630 }
  raw.temperature = { currentLevel: -4, currentDeviceLevel: -4, currentState: { type: "smart:final" },
    smart: { bedTimeLevel: -7, initialSleepLevel: -21, finalSleepLevel: -4 } }
  const m = Model.parseResponse(JSON.stringify(raw))
  assert.equal(m.bed.on, true)
  assert.equal(m.bed.autopilot, "late night")
  assert.equal(m.bed.model, "Pod 5")
  assert.equal(m.bed.hasPresence, false)
  assert.equal(m.bed.inBed, false, "finished night: not in bed even without presence sensors")
  assert.equal(Model.formatLevel(m.bed.targetLevel), "0")
  assert.equal(m.bed.direction, "cooling", "pump running below zero is cooling")
  assert.equal(Model.summaryLine(m, "C"), "Left side · cooling to 0 (27 °C)")
  // In-progress session with a fresh heart-rate sample → in bed via the fallback.
  raw.trends.days.push({ day: "2026-08-30", processing: true, presenceStart: "2026-08-29T12:50:00.000Z",
    sessions: [{ stages: [{ stage: "deep", duration: 600 }, { stage: "awake", duration: 60 }],
      timeseries: { heartRate: [[new Date(NOW.getTime() - 4 * 60 * 1000).toISOString(), 55]] } }] })
  const live = Model.parseResponse(JSON.stringify(raw))
  assert.equal(live.bed.inBed, true)
  raw.trends.days[raw.trends.days.length - 1].sessions[0].timeseries.heartRate = [[new Date(NOW.getTime() - 40 * 60 * 1000).toISOString(), 55]]
  assert.equal(Model.parseResponse(JSON.stringify(raw)).bed.inBed, false, "a 40-minute-old sample is not presence")
})

test("solo and right sides read the right keys", () => {
  const right = Model.parseResponse(response({ user: { userId: "u2", firstName: "Jo", side: "right" } }))
  assert.equal(right.bed.side, "right")
  assert.equal(right.bed.label, "Right side")
  assert.equal(right.bed.nowHeating, false)
  assert.equal(right.bed.direction, "holding", "state is smart but the pump is idle")
  const solo = Model.parseResponse(response({ user: { userId: "u1", firstName: "Sam", side: "solo" } }))
  assert.equal(solo.bed.side, "left", "solo beds report under the left keys")
  assert.equal(solo.bed.label, "Bed")
})

test("off state, missing temperature block, and fallbacks", () => {
  const off = Model.parseResponse(response({ temperature: { currentLevel: -30, currentState: { type: "off" } } }))
  assert.equal(off.bed.on, false)
  assert.equal(off.bed.direction, "off")
  assert.equal(off.bed.deviceLevel, -28, "falls back to the device's heating level")
  assert.equal(Model.summaryLine(off, "C"), "Left side off")
  assert.equal(Model.badgeText(off, "level", "C"), Model.BAR_GLYPH)

  const noState = Model.parseResponse(response({ temperature: {} }))
  assert.equal(noState.bed.on, true, "no state type: a running pump means on")
  assert.equal(noState.bed.targetLevel, -30, "target falls back to the device")

  const partial = Model.parseResponse(JSON.stringify({ ok: true, fetchedAt: FETCHED, user: { side: "left" }, device: {} }))
  assert.equal(partial.ok, false)
  assert.equal(partial.error, "bad-response")
  assert.equal(partial.bed, null)
})

test("in-progress session and in-bed detection", () => {
  const raw = JSON.parse(response())
  raw.trends.days.push({ day: "2026-08-30", processing: true, presenceStart: "2026-08-29T12:50:00.000Z", sleepDuration: 5400,
    sessions: [{ stages: [{ stage: "light", duration: 600 }, { stage: "awake", duration: 60 }],
      timeseries: { heartRate: [["2026-08-29T14:20:00.000Z", 55]] } }] })
  raw.device.leftPresenceStart = 1787003000
  raw.device.leftPresenceEnd = 1787001000
  const m = Model.parseResponse(JSON.stringify(raw))
  assert.equal(m.night.day, "2026-08-30")
  assert.equal(m.night.processing, true)
  assert.equal(m.night.currentStage, "light", "skips the trailing awake stage while processing")
  assert.equal(m.night.score, null)
  assert.equal(Model.nightSummary(m.night), "In progress · light · 1h 30m")
  assert.equal(m.bed.inBed, true)
  assert.equal(Model.badgeText(m, "score", "C"), Model.GLYPH.bed + " −3", "score badge falls back to level while processing")
})

test("badge, summary and night summary", () => {
  const m = Model.parseResponse(response())
  assert.equal(Model.badgeText(m, "level", "C"), Model.GLYPH.cooling + " −3")
  assert.equal(Model.badgeText(m, "temp", "C"), Model.GLYPH.cooling + " 24°", "device level -28 → 24 °C")
  assert.equal(Model.badgeText(m, "temp", "F"), Model.GLYPH.cooling + " 75°")
  assert.equal(Model.badgeText(m, "score", "C"), Model.GLYPH.sleep + " 87")
  assert.equal(Model.badgeUrgent(m), false)
  assert.equal(Model.summaryLine(m, "C"), "Left side · cooling to −3 (23 °C)")
  assert.equal(Model.summaryLine(m, "F"), "Left side · cooling to −3 (74 °F)")
  assert.equal(Model.nightSummary(m.night), "Score 87 · 7h 15m")
  assert.equal(Model.nightSummary(null), "No sleep data yet")
  assert.equal(Model.summaryLine(Model.parseResponse("{}"), "C"), "Not connected")
  const f = Model.stageFractions(m.night)
  assert.ok(Math.abs(f.light + f.deep + f.rem + f.awake - 1) < 1e-9)
  assert.ok(f.deep > 0.2 && f.deep < 0.3)
  assert.deepEqual(Model.stageFractions(null), { light: 0, deep: 0, rem: 0, awake: 0 })
})

test("alerts drive the badge and the summary", () => {
  const offline = Model.parseResponse(response({ device: { deviceId: "d1", online: false, hasWater: true } }))
  assert.deepEqual(offline.alerts.map(a => a.code), ["offline"])
  assert.equal(Model.badgeUrgent(offline), true)
  assert.equal(Model.badgeText(offline, "level", "C"), Model.GLYPH.offline)
  assert.equal(Model.summaryLine(offline, "C"), "Pod offline")
  const dry = Model.parseResponse(response({ device: { deviceId: "d1", online: true, hasWater: false, needsPriming: true } }))
  assert.deepEqual(dry.alerts.map(a => a.code), ["water"], "an empty tank implies priming; report the cause once")
  const prime = Model.parseResponse(response({ device: { deviceId: "d1", online: true, hasWater: true, needsPriming: true } }))
  assert.deepEqual(prime.alerts.map(a => a.code), ["prime"])
})

test("stale and error wrappers", () => {
  const stale = Model.parseResponse(response({ stale: true, error: "network", message: "offline" }))
  assert.equal(stale.ok, true); assert.equal(stale.stale, true); assert.equal(stale.error, "network")
  assert.equal(Model.parseResponse("").ok, false)
  assert.equal(Model.parseResponse("{not json").error, "bad-response")
  const noKey = Model.parseResponse('{"ok":false,"error":"no-credentials","message":"m"}')
  assert.equal(noKey.ok, false); assert.equal(noKey.error, "no-credentials"); assert.equal(noKey.bed, null)
})

test("diffModels notifies a new score once and new alerts once", () => {
  const before = Model.parseResponse(response())
  assert.deepEqual(Model.diffModels(null, before), [], "first fetch never notifies")
  assert.deepEqual(Model.diffModels(before, before), [], "same night, same alerts: quiet")

  // Score for a new day lands.
  const raw = JSON.parse(response())
  raw.trends.days.push({ day: "2026-08-30", score: 91, processing: false, sleepDuration: 27000, presenceDuration: 28000,
    presenceStart: "2026-08-29T13:00:00.000Z", presenceEnd: "2026-08-29T21:00:00.000Z",
    sleepQualityScore: { hrv: { current: 50.4 }, respiratoryRate: { current: 14.25 } }, sessions: [] })
  const after = Model.parseResponse(JSON.stringify(raw))
  const changes = Model.diffModels(before, after)
  assert.equal(changes.length, 1)
  const n = Model.notificationFor(changes[0])
  assert.equal(n.headline, "Sleep score 91")
  assert.equal(n.body, "7h 30m asleep · HRV 50 · 14.3 breaths/min")
  assert.equal(n.urgency, "low")

  // Processing → done for the same day also counts.
  const processing = Model.parseResponse(JSON.stringify(withDeep(JSON.parse(response()), ["trends", "days", 1, "processing"], true)))
  assert.equal(processing.night.score, 87)
  assert.equal(Model.diffModels(processing, before).length, 1)

  // Alerts.
  const offline = Model.parseResponse(response({ device: { deviceId: "d1", online: false } }))
  const alerts = Model.diffModels(before, offline)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].kind, "alert")
  assert.equal(Model.notificationFor(alerts[0]).headline, "Pod offline")
  assert.deepEqual(Model.diffModels(offline, offline), [])
  assert.deepEqual(Model.diffModels(before, Model.parseResponse('{"ok":false,"error":"network"}')), [], "a failed fetch never notifies")
})

// ---- Hostile input -----------------------------------------------------------
// Everything the API returns is treated as untrusted. These cover the half of
// that defence that lives here; the other half is textFormat: Text.PlainText on
// every Text in Panel.qml and the byte caps in bin/eightsleep-api.

test("markup in remote strings never survives into the view model", () => {
  const evil = '<img src="http://tracker.example/pixel.png">Sam'
  const m = Model.parseResponse(response({ user: { userId: "u1", firstName: evil, side: "<b>left</b>" } }))
  assert.ok(!/[<>]/.test(m.firstName), "angle brackets survived: " + m.firstName)
  assert.equal(m.firstName, '‹img src="http://tracker.example/pixel.…', "and bounded to MAX_NAME")
  assert.equal(m.side, "left", "an unrecognised side falls back to left")
  const stage = Model.parseResponse(JSON.stringify(withDeep(JSON.parse(response()), ["trends", "days", 1, "sessions", 0, "stages", 1, "stage"], "<script>")))
  assert.ok(!/[<>]/.test(stage.night.currentStage))
})

test("numbers must be numbers", () => {
  const m = Model.parseResponse(response({ temperature: { currentLevel: "-30", currentDeviceLevel: { evil: true }, currentState: { type: "smart" } } }))
  assert.equal(m.bed.targetLevel, -30, "numeric strings are accepted")
  assert.equal(m.bed.deviceLevel, -28, "an object is ignored in favour of the device value")
  assert.equal(Model.num("1e999"), null)
  assert.equal(Model.num(Infinity), null)
  assert.equal(Model.num("12abc"), null)
  assert.equal(Model.num("9".repeat(400)), null, "a numeric string that overflows to Infinity is rejected")
  assert.equal(Model.parseTime(1e300), null, "an epoch outside Date's range is null, not an invalid Date")
  assert.equal(Model.parseTime("2026-13-45T00:00:00Z"), null)
  const negative = Model.stageFractions({ stages: { light: -500, deep: 3600, rem: 1800, awake: null } })
  assert.equal(negative.light, 0, "negative durations count as zero")
  assert.ok(Math.abs(negative.deep - 2 / 3) < 1e-9)
  assert.deepEqual(Model.stageFractions({ stages: { light: -1, deep: -1, rem: 0, awake: 0 } }), { light: 0, deep: 0, rem: 0, awake: 0 })
})

test("control characters go, ordinary text is left alone", () => {
  assert.equal(Model.trim("Ben & Jerry"), "Ben & Jerry")
  assert.equal(Model.trim("Café — 3 items"), "Café — 3 items")
  assert.equal(Model.trim("bell and null  "), "bell and null")
  assert.equal(Model.trim("line one\nline two"), "line one line two")
  assert.equal(Model.trim("A".repeat(500)).length, Model.MAX_TEXT)
})
