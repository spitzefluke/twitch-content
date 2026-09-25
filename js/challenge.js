// Win-Challenge: gemeinsame Helfer für die Webseite und das OBS-Overlay.
// Eine Leiter aus Stufen (Games, Runden, Fights gegen Mods), die Dave der Reihe
// nach gewinnen muss. Optional mit Leben: jede Niederlage kostet eins.

export const KINDS = {
  game: { icon: '🎮', name: 'Game', add: '+ Game' },
  round: { icon: '🔁', name: 'Runden', add: '+ Runden' },
  fight: { icon: '⚔️', name: 'Fight gegen Mod', add: '+ Fight gegen Mod' },
};

export const DEFAULT_CHALLENGE = {
  title: 'Win-Challenge',
  lives: 3,
  lives_left: 3,
  stages: [
    { id: 's1', kind: 'game', title: 'Gewinne ein Solo-Game', opponent: '', target: 1, wins: 0, losses: 0 },
    { id: 's2', kind: 'round', title: 'Gewinne 3 Zone-Wars-Runden', opponent: '', target: 3, wins: 0, losses: 0 },
    { id: 's3', kind: 'fight', title: '1v1 Box-Fight', opponent: 'Mod', target: 2, wins: 0, losses: 0 },
    { id: 's4', kind: 'game', title: 'Gewinne ein Duo-Game', opponent: '', target: 1, wins: 0, losses: 0 },
    { id: 's5', kind: 'fight', title: '1v1 Build-Fight – Endgegner', opponent: 'Mod', target: 3, wins: 0, losses: 0 },
  ],
  current: 0,
  status: 'ready',
  admins_can_edit: false,
  last_event: {},
  history: [],
};

export const stageDone = (s) => s.wins >= s.target;
export const doneCount = (ch) => ch.stages.filter(stageDone).length;
export const currentStage = (ch) => ch.stages[Math.min(ch.current, ch.stages.length - 1)];
export const stageLabel = (s) => (s.kind === 'fight' && s.opponent ? `${s.title} vs ${s.opponent}` : s.title);

// Kurzer Stand, z. B. für die Kachel
export function challengeSummary(ch) {
  if (!ch) return '🏆 Win-Challenge';
  if (ch.status === 'won') return '🏆 Geschafft!';
  if (ch.status === 'failed') return '💀 Gescheitert';
  const lives = ch.lives ? ` · ${'❤️'.repeat(ch.lives_left)}${'🖤'.repeat(Math.max(0, ch.lives - ch.lives_left))}` : '';
  if (ch.status === 'ready') return `🎯 ${ch.stages.length} Stufen warten${lives}`;
  return `🔥 Stufe ${Math.min(ch.current + 1, ch.stages.length)}/${ch.stages.length}${lives}`;
}

// Leben als Herzen
export function heartsHtml(ch) {
  if (!ch.lives) return '';
  return Array.from({ length: ch.lives }, (_, i) => `<span class="ch-heart${i < ch.lives_left ? '' : ' is-lost'}" aria-hidden="true">❤</span>`).join('');
}

// Siege als Punkte (●●○), bei großen Zielen als Zahl
export function pipsHtml(stage) {
  if (stage.target > 10) return `<span class="ch-count">${stage.wins}/${stage.target}</span>`;
  return Array.from({ length: stage.target }, (_, i) => `<span class="ch-pip${i < stage.wins ? ' is-on' : ''}"></span>`).join('');
}

// ---------- Regeln (für den Demo-Modus; die Datenbank macht dasselbe) ----------
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const snapshot = (ch) => [
  { stages: ch.stages, current: ch.current, lives_left: ch.lives_left, status: ch.status, started_at: ch.started_at ?? null, finished_at: ch.finished_at ?? null },
  ...(ch.history ?? []),
].slice(0, 20);
const event = (ch, type, stage, by) => ({ n: (ch.last_event?.n ?? 0) + 1, type, stage, title: ch.stages[stage]?.title ?? '', by, at: new Date().toISOString() });
const firstOpen = (stages) => {
  const i = stages.findIndex((s) => !stageDone(s));
  return i === -1 ? stages.length : i;
};

export function cleanStages(list, old = []) {
  return (Array.isArray(list) ? list : []).filter((e) => e && typeof e === 'object').slice(0, 30).map((e, n) => {
    const kind = KINDS[e.kind] ? e.kind : 'game';
    const target = clamp(Math.round(Number(e.target)) || 1, 1, 99);
    const id = /^[a-z0-9]{1,12}$/.test(e.id ?? '') ? e.id : Math.random().toString(36).slice(2, 10) + n;
    const prev = old.find((o) => o.id === id);
    return {
      id,
      kind,
      title: String(e.title ?? '').trim().slice(0, 60) || { game: 'Game gewinnen', round: 'Runde gewinnen', fight: 'Fight gegen einen Mod' }[kind],
      opponent: kind === 'fight' ? String(e.opponent ?? '').trim().slice(0, 30) : '',
      target,
      wins: clamp(prev?.wins ?? 0, 0, target),
      losses: Math.max(0, prev?.losses ?? 0),
    };
  });
}

export function saveChallenge(ch, { title, lives, stages }, by) {
  const next = cleanStages(stages, ch.stages);
  if (!next.length) throw new Error('Die Challenge braucht mindestens eine Stufe.');
  const l = clamp(Math.round(Number(lives)) || 0, 0, 10);
  const open = firstOpen(next);
  const current = Math.min(open, next.length - 1);
  return {
    ...ch,
    title: String(title ?? '').trim().slice(0, 60) || 'Win-Challenge',
    lives: l,
    lives_left: ch.status === 'ready' || ch.lives === 0 ? l : clamp(ch.lives_left + l - ch.lives, 0, l),
    stages: next,
    current,
    status: ch.status === 'ready' || ch.status === 'failed' ? ch.status : open >= next.length ? 'won' : 'running',
    last_event: event({ ...ch, stages: next }, 'edit', current, by),
  };
}

export function applyResult(ch, win, by) {
  if (ch.status === 'won' || ch.status === 'failed') throw new Error('Die Challenge ist vorbei – starte sie neu, um weiterzuspielen.');
  const now = new Date().toISOString();
  const next = { ...ch, history: snapshot(ch), stages: ch.stages.map((s) => ({ ...s })) };
  if (next.status === 'ready') Object.assign(next, { status: 'running', started_at: now });
  const stage = next.stages[next.current];
  let type;
  if (win) {
    stage.wins += 1;
    type = 'win';
    if (stage.wins >= stage.target) {
      if (next.current >= next.stages.length - 1) {
        Object.assign(next, { status: 'won', finished_at: now });
        type = 'won';
      } else {
        type = 'stage';
      }
    }
  } else {
    stage.losses += 1;
    type = 'loss';
    if (next.lives > 0) {
      next.lives_left = Math.max(0, next.lives_left - 1);
      if (next.lives_left === 0) {
        Object.assign(next, { status: 'failed', finished_at: now });
        type = 'failed';
      }
    }
  }
  next.last_event = event(ch, type, ch.current, by);
  if (type === 'stage') next.current += 1;
  return next;
}

export function undoChallenge(ch, by) {
  const [snap, ...rest] = ch.history ?? [];
  if (!snap) throw new Error('Es gibt nichts zum Rückgängigmachen.');
  const current = Math.min(snap.current, ch.stages.length - 1);
  return {
    ...ch,
    stages: cleanStages(ch.stages, snap.stages),
    current,
    lives_left: Math.min(ch.lives, snap.lives_left),
    status: snap.status,
    started_at: snap.started_at,
    finished_at: snap.finished_at,
    history: rest,
    last_event: event(ch, 'undo', current, by),
  };
}

export function gotoStage(ch, index, by) {
  const to = clamp(Math.round(Number(index)) || 0, 0, ch.stages.length - 1);
  return {
    ...ch,
    current: to,
    status: ch.status === 'ready' ? 'ready' : 'running',
    finished_at: null,
    history: snapshot(ch),
    last_event: event(ch, 'goto', to, by),
  };
}

export function resetChallenge(ch, by) {
  return {
    ...ch,
    stages: ch.stages.map((s) => ({ ...s, wins: 0, losses: 0 })),
    current: 0,
    lives_left: ch.lives,
    status: 'ready',
    started_at: null,
    finished_at: null,
    history: [],
    last_event: event(ch, 'reset', 0, by),
  };
}

// ---------- Effekte bei Sieg, Niederlage, Stufe, Ende ----------
// host = Ebene über allem (Dialog oder Overlay); sfx = Sfx aus prank-fx.js
const BURSTS = {
  win: { cls: 'is-win', text: 'SIEG!', sound: (s) => s.hit('bling') },
  loss: { cls: 'is-loss', text: 'NIEDERLAGE', sound: (s) => s.play('buzzer') },
  stage: { cls: 'is-stage', text: 'STUFE GESCHAFFT!', sound: (s) => { s.hit('bling'); s.play('gong'); } },
  won: { cls: 'is-won', text: 'CHALLENGE GESCHAFFT!', sound: (s) => { s.play('applause'); s.play('gong'); } },
  failed: { cls: 'is-failed', text: 'GESCHEITERT', sound: (s) => { s.play('buzzer'); s.hit('boom'); } },
};

export function challengeBurst(host, ev, ch, { sfx = null } = {}) {
  const b = BURSTS[ev?.type];
  if (!b || !host) return null;
  host.querySelectorAll('.ch-burst').forEach((x) => x.remove());
  const fx = document.createElement('div');
  fx.className = `ch-burst ${b.cls}`;
  const big = ['stage', 'won', 'failed'].includes(ev.type);
  const stage = ch.stages[ev.stage];
  const next = ch.stages[ch.current];
  let sub = '';
  if (ev.type === 'win' && stage) sub = `${stage.wins}/${stage.target} · ${stageLabel(stage)}`;
  if (ev.type === 'loss') sub = ch.lives ? `Noch ${ch.lives_left} Leben` : stage ? stageLabel(stage) : '';
  if (ev.type === 'stage' && next) sub = `Weiter: ${KINDS[next.kind].icon} ${stageLabel(next)}`;
  if (ev.type === 'won') sub = `${ch.title} – alle ${ch.stages.length} Stufen!`;
  if (ev.type === 'failed') sub = `Keine Leben mehr – bei Stufe ${ev.stage + 1}: ${stage ? stageLabel(stage) : ''}`;
  fx.innerHTML = `${big ? '<div class="ch-burst-rays"></div>' : ''}<div class="ch-burst-icon"></div><div class="ch-burst-text"></div><p class="ch-burst-sub"></p>${ev.type === 'won' ? '<div class="vs-confetti"></div>' : ''}`;
  fx.querySelector('.ch-burst-icon').textContent = { win: '✅', loss: ch.lives ? '💔' : '❌', stage: '⭐', won: '🏆', failed: '💀' }[ev.type];
  fx.querySelector('.ch-burst-text').textContent = b.text;
  fx.querySelector('.ch-burst-sub').textContent = sub;
  if (ev.type === 'won') {
    const confetti = fx.querySelector('.vs-confetti');
    const colors = ['#ffd36b', '#ffffff', '#ff5c5c', '#4fb6ff', '#7bd02f', '#c46cff'];
    for (let i = 0; i < 80; i++) {
      const c = document.createElement('i');
      c.style.setProperty('--x', `${Math.random() * 100}%`);
      c.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
      c.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
      c.style.setProperty('--d', `${Math.random() * 0.9}s`);
      c.style.setProperty('--t', `${2.2 + Math.random() * 1.6}s`);
      c.style.background = colors[i % colors.length];
      confetti.append(c);
    }
  }
  host.append(fx);
  if (sfx) b.sound(sfx);
  const ms = { win: 1600, loss: 1800, stage: 2800, won: 6500, failed: 4500 }[ev.type];
  const end = () => {
    if (!fx.isConnected) return;
    fx.classList.add('is-out');
    setTimeout(() => fx.remove(), 400);
  };
  fx.addEventListener('click', end);
  setTimeout(end, ms);
  return fx;
}
