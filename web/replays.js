// Replays: Watch recordings side by side on one clock (record the same seed with different prompts or settings to
// compare them). A faster run makes more decisions in the same time, so its ball moves faster.
import { fromRow, frameAt, indexAt, Court, COLORS } from "./draw.js";

const $ = (id) => document.getElementById(id);
const LANE_COLORS = ["#34d3a6", "#7aa2ff", "#f2b84b", "#c792ea"];
const MAX_LANES = 4;
const st = { lanes: [], t: 0, end: 0, playing: false, last: 0, list: [] };

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

const label = (rec) => {
  const s = rec.settings || {};
  return s.promptName || rec.model_name || rec.model;
};
const when = (rec) => String(rec.created || "").replace("T", " ").slice(0, 16);

function withTotals(ticks) {
  let decisions = 0, returns = 0, misses = 0;
  return ticks.map((s, i) => {
    const prev = ticks[i - 1];
    if (s.m >= 0) decisions += 1;
    returns += s.r || 0;
    if (prev && prev.g === s.g && s.s0 > prev.s0) misses += 1;
    return { ...s, n: decisions, rn: returns, mn: misses };
  });
}

function laneEl(i, chosen) {
  const el = document.createElement("div");
  el.className = "lane";
  el.style.setProperty("--lane", LANE_COLORS[i % LANE_COLORS.length]);
  el.innerHTML = `
    <div class="who"><b></b><span class="meta"></span><select aria-label="recording"></select></div>
    <canvas aria-label="replay"></canvas>
    <div class="nums">
      <div><b data-k="n">0</b><span>decisions</span></div>
      <div><b data-k="rn">0</b><span>returns</span></div>
      <div><b data-k="mn">0</b><span>misses</span></div>
    </div>`;
  const sel = el.querySelector("select");
  sel.append(new Option("(no recording)", ""));
  for (const rec of st.list) sel.append(new Option(`${label(rec)}, seed ${rec.seed}, ${rec.seconds} s, ${when(rec)}`, rec.name));
  sel.value = chosen || "";
  return el;
}

async function loadLane(lane, name) {
  lane.name = name;
  if (!name) { lane.ticks = null; lane.el.querySelector(".who b").textContent = "Empty lane"; lane.el.querySelector(".meta").textContent = ""; return; }
  const rec = await getJson(`/api/recordings/${encodeURIComponent(name)}`);
  const s = rec.summary || {}, set = rec.settings || {};
  lane.rec = rec;
  lane.ticks = withTotals(rec.snaps.map((r) => fromRow(r, rec.cols)));
  lane.el.querySelector(".who b").textContent = label(rec);
  lane.el.querySelector(".meta").textContent =
    `${s.dps} decisions/s, round trip p50 ${s.p50} ms (model ${s.model_p50 ?? "?"}), ${s.agree}% match the rule` +
    `${set.transport ? `, ${set.transport === "ws" ? "WebSocket" : "HTTP"}` : ""}${set.tol ? `, tolerance ${set.tol}` : ""}`;
}

function span() {
  st.end = Math.max(0, ...st.lanes.filter((l) => l.ticks).map((l) => l.ticks.at(-1).t));
}

async function savedGames() {
  let rows = [];
  try { rows = await getJson("/api/games"); } catch { rows = []; }
  const names = { play: "Play", bot: "Bot match", watch: "Watch" };
  $("gamesBody").replaceChildren(...(rows.length ? rows.slice(0, 40).map((g) => {
    const tr = document.createElement("tr");
    const score = g.score || (g.mode === "watch" ? `${g.returns ?? 0} returns, ${g.modelMisses ?? 0} misses` : "");
    for (const v of [String(g.created || "").replace("T", " ").slice(5, 16), names[g.mode] || g.mode, g.prompt || "",
      g.winner ? `${g.result}, ${g.winner === "model" ? "model won" : g.winner === "you" ? "you won" : "bot won"}` : g.result,
      score, g.decisions ?? "", g.match !== null && g.match !== undefined ? `${g.match}%` : "",
      g.p50 ? `${g.p50} ms` : "", g.model_p50 ? `${g.model_p50} ms` : ""]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    return tr;
  }) : [(() => { const tr = document.createElement("tr"); tr.innerHTML = '<td colspan="9" class="faint">No saved games yet: play one.</td>'; return tr; })()]));
}

export async function openReplays() {
  stop();
  savedGames();
  st.list = await getJson("/api/recordings");
  const box = $("lanes");
  box.replaceChildren();
  st.lanes = [];
  if (!st.list.length) {
    $("replayNote").textContent = "No recordings yet. In Watch, pick a prompt and press Record; record the same seed with another prompt to compare.";
    draw();
    return;
  }
  const latestSeed = st.list[0].seed;                      // default: the newest recordings of the newest seed
  const picks = st.list.filter((r) => r.seed === latestSeed).slice(0, MAX_LANES).map((r) => r.name);
  while (picks.length < Math.min(MAX_LANES, Math.max(2, picks.length))) picks.push("");
  picks.forEach((name, i) => {
    const lane = { el: laneEl(i, name), court: null, ticks: null };
    lane.court = new Court(lane.el.querySelector("canvas"), { compact: true });
    lane.el.querySelector("select").addEventListener("change", async (e) => { await loadLane(lane, e.target.value); span(); seek(0); });
    box.append(lane.el);
    st.lanes.push(lane);
  });
  await Promise.all(st.lanes.map((l) => loadLane(l, l.el.querySelector("select").value)));
  span();
  const seeds = new Set(st.lanes.filter((l) => l.rec).map((l) => l.rec.seed));
  $("replayNote").textContent = (seeds.size <= 1 ? "Every lane plays the same seed. " : "These lanes play different seeds, so their games differ. ") +
    "Each was recorded on its own and is replayed on one clock: a faster run makes more decisions, so its ball moves faster.";
  seek(0);
}

function draw() {
  $("replayClock").textContent = `${(st.t / 1000).toFixed(1)} s`;
  $("scrub").value = st.end ? Math.round((1000 * st.t) / st.end) : 0;
  st.lanes.forEach((lane, i) => {
    if (!lane.ticks) { lane.court.draw(null); return; }
    const f = frameAt(lane.ticks, st.t);
    const color = LANE_COLORS[i % LANE_COLORS.length];
    lane.court.draw(f && { ball: { x: f.bx, y: f.by }, left: { y: f.ly, h: 20, color: COLORS.wall },
      right: { y: f.ry, h: 20, color }, score: [f.s0, f.s1], target: null, effects: false, trail: false });
    const s = lane.ticks[Math.max(0, indexAt(lane.ticks, st.t))];
    for (const b of lane.el.querySelectorAll(".nums b")) b.textContent = s[b.dataset.k];
  });
}

function frame(now) {
  if (!st.playing) return;
  st.t = Math.min(st.end, st.t + (now - st.last));
  st.last = now;
  draw();
  if (st.t >= st.end) stop();
  else requestAnimationFrame(frame);
}

function play() {
  if (!st.end) return;
  if (st.t >= st.end) st.t = 0;
  st.playing = true;
  st.last = performance.now();
  $("replayPlay").textContent = "Pause";
  requestAnimationFrame(frame);
}

export function stop() {
  st.playing = false;
  $("replayPlay").textContent = st.t > 0 && st.t < st.end ? "Resume" : "Play";
}

function seek(t) {
  st.t = Math.max(0, Math.min(st.end, t));
  draw();
  if (!st.playing) stop();
}

export function wireReplays() {
  $("replayPlay").addEventListener("click", () => (st.playing ? stop() : play()));
  $("scrub").addEventListener("input", (e) => seek((Number(e.target.value) / 1000) * st.end));
  window.addEventListener("resize", () => { if (!$("viewReplays").hidden) draw(); });
}
