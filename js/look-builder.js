// Look-Baukasten (Design-Bibliothek → „＋ Eigener Look“): einen Komplett-Look aus Teilen zusammenstellen –
// Farbe (auch aus dem Logo), Karten-Design, Kamera-Rahmen, Alerts, Chat, Laufband, Bingo und bewegte Szenen.
// Gespeichert wird als Overlay-Vorlage mit look=1 (Migration …_overlay_presets.sql, keine eigene Tabelle):
//   look=1&otheme=…&accent=rrggbb&cfstyle=…&alook=…&chstyle=…&tstyle=…&bstyle=…&scmove=…
//   &apreset=<Alert-Design>&acolor=1 (Alerts in der Farbe)&pacc=1 (Farbe fürs öffentliche Profil)
// Rechts eine Live-Vorschau (overlay.html im iframe, wie in der Bibliothek).
import { ALERT_PRESETS } from './alerts.js';
import { h, makeDialog } from './extras-core.js';
import { OVERLAY_THEMES, SCENE_MOTIONS } from './overlay-stage.js';
import { OVERLAY_DEFAULTS } from './theme-packs.js';
import { extractColors, inkOn } from './brand-colors.js';

export const LOOK_KEYS = ['otheme', 'accent', 'cfstyle', 'alook', 'chstyle', 'tstyle', 'bstyle', 'scmove'];
const CHOICES = {
  cfstyle: [['glow', 'Leuchten'], ['clean', 'Schlicht'], ['corners', 'Nur Ecken'], ['neon', 'Neon']],
  chstyle: [['card', 'Karte'], ['bubble', 'Sprechblasen'], ['clean', 'Schlicht']],
  tstyle: [['bar', 'Laufband'], ['neon', 'Neon'], ['board', 'LED-Anzeige']],
  bstyle: [['classic', 'Bunt'], ['neon', 'Neon'], ['paper', 'Papier']],
};
const SCENES = [['game', 'Gameplay'], ['start', 'Gleich live'], ['brb', 'Pause']];
const SHOWCASE = {
  game: 'next=tl&alerts=tc&goal=tr&labels=bl&camframe=1&cam=70,55,28,33&chat=76,22&edit=1',
  start: 'scene=start&labels=bl',
  brb: 'scene=brb&labels=bl',
};

// Gespeicherte Vorlage → Look (oder null, wenn es eine normale OBS-Vorlage ist)
export function parseLook(preset) {
  const p = new URLSearchParams(preset?.params ?? '');
  if (p.get('look') !== '1') return null;
  const overlay = {};
  for (const k of LOOK_KEYS) if (p.get(k)) overlay[k] = p.get(k);
  return {
    id: preset.id, name: preset.name, overlay,
    apreset: ALERT_PRESETS.some((x) => x.id === p.get('apreset')) ? p.get('apreset') : '',
    acolor: p.get('acolor') === '1', pacc: p.get('pacc') === '1',
  };
}
export const isLookPreset = (preset) => new URLSearchParams(preset?.params ?? '').get('look') === '1';

let dlg = null;
let ctx = null;   // { api, toast, germanError, presets: () => [...], onSaved(look, apply) }
let state = null;
let previewTimer = 0;

export function openLookBuilder(deps, look = null) {
  ctx = deps;
  dlg ??= build();
  const base = look ?? {
    name: '', overlay: { otheme: 'neon', accent: '9146ff', cfstyle: 'glow', alook: 'neon', chstyle: 'bubble', tstyle: 'neon', bstyle: 'neon', scmove: 'lights' },
    apreset: 'neon', acolor: true, pacc: false,
  };
  state = { id: look?.id ?? null, name: base.name, overlay: { ...OVERLAY_DEFAULTS, ...base.overlay }, apreset: base.apreset, acolor: base.acolor, pacc: base.pacc, scene: 'game' };
  state.overlay.accent ??= '9146ff';
  state.overlay.scmove ??= '';
  fill();
  if (!dlg.open) dlg.showModal();
  preview(true);
}

function build() {
  const d = makeDialog({
    id: 'lb-builder', cls: 'lb-builder', eyebrow: 'Design-Bibliothek', title: 'Eigener Look',
    body: `
    <form class="lbb" novalidate>
      <div class="lbb-form">
        <label class="field"><span>Name</span><input name="name" maxlength="40" required placeholder="z. B. Mein Neon-Abend" autocomplete="off"></label>
        <fieldset class="lbb-box">
          <legend>🎨 Farbe</legend>
          <div class="lbb-color">
            <input type="color" name="accent" aria-label="Akzentfarbe">
            <label class="btn btn--outline btn--sm lbb-logo"><input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" class="sr-only">Farbe aus dem Logo</label>
          </div>
          <div class="lbb-swatches" data-swatches role="group" aria-label="Farben aus dem Logo"></div>
          <p class="form-hint">Das Logo bleibt auf deinem Rechner – StreamHelp liest nur die Farben heraus.</p>
          <label class="toggle"><input type="checkbox" name="acolor"><span class="toggle-ui" aria-hidden="true"></span>Alerts in dieser Farbe</label>
          <label class="toggle"><input type="checkbox" name="pacc"><span class="toggle-ui" aria-hidden="true"></span>Auch für mein öffentliches Profil</label>
        </fieldset>
        <fieldset class="lbb-box">
          <legend>🧩 Teile</legend>
          <div class="lbb-grid">
            <label class="field"><span>Karten-Design</span><select name="otheme"></select></label>
            <label class="field"><span>Kamera-Rahmen</span><select name="cfstyle"></select></label>
            <label class="field"><span>Alerts</span><select name="apreset"></select></label>
            <label class="field"><span>Chat</span><select name="chstyle"></select></label>
            <label class="field"><span>Laufband</span><select name="tstyle"></select></label>
            <label class="field"><span>Bingo-Karte</span><select name="bstyle"></select></label>
            <label class="field lbb-wide"><span>Szenen-Bewegung (Gleich live, Pause, Ende)</span><select name="scmove"></select></label>
          </div>
        </fieldset>
        <div class="dash-actions">
          <button class="btn btn--primary btn--sm" type="submit" data-apply>Speichern &amp; übernehmen</button>
          <button class="btn btn--ghost btn--sm" type="button" data-save>Nur speichern</button>
        </div>
        <p class="form-hint">Übernehmen ändert Design, Farben, Kamera-Rahmen, Chat, Laufband, Bingo und Alerts. Welche Ebenen an sind und wo sie stehen, bleibt.</p>
      </div>
      <div class="lbb-side">
        <div class="lbb-scenes" role="tablist" aria-label="Szene" data-scenes></div>
        <div class="lbb-screen" data-screen></div>
        <p class="form-hint" data-summary></p>
      </div>
    </form>`,
  });
  const f = d.querySelector('form');
  const opts = (sel, list) => f.elements[sel].replaceChildren(...list.map(([v, n]) => h('option', { value: v }, n)));
  opts('otheme', OVERLAY_THEMES.map((t) => [t.id, t.name]));
  opts('apreset', [['', 'Alerts so lassen'], ...ALERT_PRESETS.map((p) => [p.id, p.name])]);
  for (const k of Object.keys(CHOICES)) opts(k, CHOICES[k]);
  opts('scmove', SCENE_MOTIONS.map((m) => [m.id, m.id ? m.name : 'Ohne Bewegung']));
  d.querySelector('[data-scenes]').replaceChildren(...SCENES.map(([id, name]) => h('button', {
    type: 'button', class: 'lb-scene', role: 'tab', 'data-scene': id,
    onclick: () => { state.scene = id; paintScenes(); preview(true); },
  }, name)));
  f.addEventListener('input', (e) => { if (e.target.name !== 'logo') read(); });
  f.addEventListener('change', (e) => {
    if (e.target.name === 'logo') { if (e.target.files[0]) logo(e.target.files[0]); e.target.value = ''; return; }
    read();
  });
  f.addEventListener('submit', (e) => { e.preventDefault(); save(true); });
  d.querySelector('[data-save]').addEventListener('click', () => save(false));
  // Wird erst beim Öffnen angelegt – Schließen hier selbst verdrahten (sonst macht es app.js für alle Dialoge)
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === d) d.close(); });
  d.addEventListener('close', () => { d.querySelector('[data-screen]').replaceChildren(); });
  new ResizeObserver(fit).observe(d.querySelector('[data-screen]'));
  return d;
}

function fill() {
  const f = dlg.querySelector('form');
  dlg.querySelector('h2').textContent = state.id ? `Look „${state.name}“ bearbeiten` : 'Eigener Look';
  f.elements.name.value = state.name;
  f.elements.accent.value = `#${state.overlay.accent}`;
  for (const k of ['otheme', 'cfstyle', 'chstyle', 'tstyle', 'bstyle', 'scmove']) f.elements[k].value = state.overlay[k] ?? '';
  f.elements.apreset.value = state.apreset;
  f.elements.acolor.checked = state.acolor;
  f.elements.pacc.checked = state.pacc;
  dlg.querySelector('[data-swatches]').replaceChildren();
  paintScenes();
  summary();
}

function read() {
  const f = dlg.querySelector('form');
  state.name = f.elements.name.value;
  state.overlay.accent = f.elements.accent.value.replace('#', '');
  for (const k of ['otheme', 'cfstyle', 'chstyle', 'tstyle', 'bstyle', 'scmove']) state.overlay[k] = f.elements[k].value;
  state.apreset = f.elements.apreset.value;
  // Alerts: Grund-Design (alook) kommt aus dem gewählten Alert-Design
  const p = ALERT_PRESETS.find((x) => x.id === state.apreset);
  if (p) state.overlay.alook = p.design.look || OVERLAY_DEFAULTS.alook;
  state.acolor = f.elements.acolor.checked;
  state.pacc = f.elements.pacc.checked;
  summary();
  preview();
}

function summary() {
  const p = ALERT_PRESETS.find((x) => x.id === state.apreset);
  dlg.querySelector('[data-summary]').textContent = [
    `Karten: ${OVERLAY_THEMES.find((t) => t.id === state.overlay.otheme)?.name}`,
    `Alerts: ${p ? `${p.name}${state.acolor ? ' in deiner Farbe' : ''}` : 'bleiben'}`,
    state.overlay.scmove ? `Szenen: ${SCENE_MOTIONS.find((m) => m.id === state.overlay.scmove)?.name}` : '',
    state.pacc ? 'Profil in deiner Farbe' : '',
  ].filter(Boolean).join(' · ');
}

function paintScenes() {
  dlg.querySelectorAll('[data-scene]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.scene === state.scene)));
}

async function logo(file) {
  const box = dlg.querySelector('[data-swatches]');
  try {
    const colors = await extractColors(file);
    box.replaceChildren(...colors.map((c) => h('button', {
      type: 'button', class: 'obs-brand-swatch', style: { background: c, color: inkOn(c) }, title: `${c} übernehmen`,
      onclick: (e) => {
        dlg.querySelector('form').elements.accent.value = c;
        box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === e.currentTarget)));
        read();
      },
    }, c)));
    // Die kräftigste Farbe gleich nehmen
    if (colors[0]) { dlg.querySelector('form').elements.accent.value = colors[0]; box.firstChild?.setAttribute('aria-pressed', 'true'); read(); }
  } catch (err) {
    ctx.toast(ctx.germanError(err), 'error');
  }
}

export function lookParams(look) {
  const p = new URLSearchParams({ look: '1' });
  for (const k of LOOK_KEYS) if (look.overlay[k]) p.set(k, look.overlay[k]);
  if (look.apreset) p.set('apreset', look.apreset);
  if (look.acolor) p.set('acolor', '1');
  if (look.pacc) p.set('pacc', '1');
  return p.toString();
}

function previewUrl() {
  const url = new URL('overlay.html', location.href);
  const p = url.searchParams;
  for (const [k, v] of new URLSearchParams(SHOWCASE[state.scene])) p.set(k, v);
  for (const k of LOOK_KEYS) if (state.overlay[k] && state.overlay[k] !== OVERLAY_DEFAULTS[k]) p.set(k, state.overlay[k]);
  if (state.scene !== 'game') {
    const at = new Date(Date.now() + 12 * 60_000);
    p.set('sctime', `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`);
  }
  p.set('test', '1');
  p.set('vol', '0');
  return url.href;
}

function preview(now = false) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const screen = dlg.querySelector('[data-screen]');
    const src = previewUrl();
    if (screen.querySelector('iframe')?.dataset.src === src) return;
    const frame = h('iframe', { title: 'Vorschau deines Looks', tabindex: '-1', width: '1920', height: '1080' });
    frame.src = frame.dataset.src = src;
    screen.replaceChildren(frame);
    fit();
  }, now ? 0 : 350);
}

function fit() {
  const screen = dlg?.querySelector('[data-screen]');
  const frame = screen?.querySelector('iframe');
  if (frame && screen.clientWidth) frame.style.transform = `scale(${screen.clientWidth / 1920})`;
}

async function save(apply) {
  read();
  const name = state.name.trim();
  if (!name) { ctx.toast('Bitte gib deinem Look einen Namen.', 'error'); dlg.querySelector('[name=name]').focus(); return; }
  const presets = ctx.presets() ?? [];
  const clash = presets.find((p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== state.id);
  if (clash && !isLookPreset(clash)) { ctx.toast(`„${name}“ ist schon der Name einer OBS-Vorlage – bitte einen anderen Namen.`, 'error'); return; }
  if (clash && !confirm(`Es gibt schon einen Look „${name}“. Überschreiben?`)) return;
  const btns = dlg.querySelectorAll('[data-apply], [data-save]');
  btns.forEach((b) => { b.disabled = true; });
  try {
    // Umbenannt: alten Eintrag löschen, sonst gäbe es ihn doppelt
    const old = state.id ? presets.find((p) => p.id === state.id) : null;
    await ctx.api.saveOverlayPreset(name, lookParams(state));
    if (old && old.name.toLowerCase() !== name.toLowerCase()) await ctx.api.deleteOverlayPreset(old.id).catch(() => {});
    dlg.close();
    await ctx.onSaved(name, apply);
  } catch (err) {
    ctx.toast(`Nicht gespeichert: ${ctx.germanError(err)}`, 'error');
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}
