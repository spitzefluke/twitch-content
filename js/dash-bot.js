// Dashboard → Bot & Chat: Bot-Auswahl und Bot-Protokoll (Migration …_bot_stats.sql).
//   · StreamHelp hat zwei Plattform-Bots. Der Streamer wählt, welcher in seinem Chat schreibt; ist der
//     gewählte nicht verbunden, springt der andere ein (twitch_status: bots, bot_slot, bot_name).
//   · Protokoll: jede Nachricht mit Status (gesendet / blockiert + Grund / nicht gesendet) und eine
//     Testnachricht. Streamer und freigegebene Mods.
// ctx: { api, toast, germanError, refreshTwitch }
import { h } from './extras-core.js';
import { botHint } from './bot-reasons.js';

const STATUS = {
  sent: ['✓', 'gesendet'],
  dropped: ['✕', 'von Twitch blockiert'],
  error: ['⚠️', 'Fehler'],
  no_bot: ['⚠️', 'kein Bot verbunden'],
  off: ['⏸', 'Chat-Bot plattformweit aus'],
};
const SOURCE = { chat: 'Antwort', outbox: 'Ansage', test: 'Test', mod: 'Moderation', system: 'Automatisch' };
const timeOf = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Auswahl Bot 1 / Bot 2 (nur zu sehen, wenn es die Migration gibt und mindestens ein Bot verbunden ist)
export function renderBotPick(t, ctx) {
  const box = document.getElementById('bot-pick');
  if (!box) return;
  const bots = t.bots ?? [];
  box.hidden = !bots.length;
  if (!bots.length) return;
  const list = document.getElementById('bot-pick-list');
  const chosen = t.bot_slot === 2 ? 2 : 1;
  const canChoose = !!t.can_choose_bot;
  const slots = [1, 2].map((slot) => {
    const bot = bots.find((b) => b.slot === slot);
    const input = h('input', { type: 'radio', name: 'bot-slot', value: String(slot), checked: slot === chosen ? '' : null, disabled: !canChoose || !bot ? '' : null });
    input.addEventListener('change', async () => {
      if (!input.checked) return;
      list.querySelectorAll('input').forEach((i) => { i.disabled = true; });
      try {
        const r = await ctx.api.botSelect(slot);
        const name = r?.bot ?? `Bot ${slot}`;
        // Der neue Bot hat sich gleich im Chat gemeldet – oder Twitch hat es geblockt (mit Grund und Lösung)
        const hint = r?.said ? null : botHint(r?.reason, r?.bot_login ?? name);
        if (r?.said) ctx.toast(`${name} schreibt jetzt in deinem Chat und hat sich dort gerade gemeldet.`, 'ok');
        else ctx.toast(`${name} ist gewählt, konnte sich aber nicht im Chat melden: ${hint ? `${hint.why} → ${hint.fix}` : r?.reason ?? 'unbekannt'}`, 'error');
        await ctx.refreshTwitch();
        renderBotLog(ctx);
      } catch (err) {
        ctx.toast(ctx.germanError(err), 'error');
        await ctx.refreshTwitch();
      }
    });
    return h('label', { class: `bot-pick-opt${slot === chosen ? ' is-on' : ''}${bot ? '' : ' is-off'}` },
      input,
      h('span', {}, h('b', {}, bot ? bot.name : `Bot ${slot}`), h('small', {}, bot ? `Bot ${slot} · @${bot.login}` : `Bot ${slot} · gerade nicht verbunden`)));
  });
  list.replaceChildren(...slots);
  const active = t.bot_connected ? t.bot_name : null;
  const fallback = active && bots.find((b) => b.slot === chosen)?.name !== active;
  document.getElementById('bot-pick-hint').textContent = !canChoose
    ? `Gerade schreibt ${active ?? 'kein Bot'}. Den Bot wählt der Streamer selbst.`
    : fallback
      ? `Bot ${chosen} ist gerade nicht verbunden – solange schreibt ${active}.`
      : `StreamHelp hat zwei Bots. Ist deiner gerade nicht verbunden, springt der andere ein. Tipp: Mach ihn im Twitch-Chat zum Mod (/mod ${bots.find((b) => b.slot === chosen)?.login ?? 'BotName'}) – sonst blocken Nur-Follower-, Abo- oder langsamer Modus seine Nachrichten.`;
}

let wired = false;
export function setupBotLog(ctx) {
  if (wired) return;
  wired = true;
  const msg = document.getElementById('botlog-msg');
  document.getElementById('botlog-reload')?.addEventListener('click', () => renderBotLog(ctx));
  document.getElementById('botlog-test')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    msg.className = 'form-msg';
    msg.textContent = 'Sende …';
    try {
      const r = await ctx.api.botTest();
      msg.classList.add(r?.ok ? 'is-ok' : 'is-error');
      const hint = r?.ok ? null : botHint(r?.reason, r?.bot_login ?? r?.bot);
      msg.textContent = r?.ok
        ? `✓ ${r.bot ?? 'Der Bot'} hat geschrieben – Twitch hat in ${r.ms} ms angenommen. Schau im Chat nach.`
        : `✕ Nicht angekommen: ${hint ? `${hint.why} → ${hint.fix}` : r?.reason ?? 'unbekannt'}`;
    } catch (err) {
      msg.classList.add('is-error');
      msg.textContent = ctx.germanError(err);
    } finally {
      btn.disabled = false;
      renderBotLog(ctx);
    }
  });
}

export async function renderBotLog(ctx) {
  const list = document.getElementById('botlog-list');
  const status = document.getElementById('botlog-status');
  if (!list) return;
  let data;
  try {
    data = await ctx.api.botLog(50);
  } catch (err) {
    list.replaceChildren();
    status.textContent = /bot_log_list|could not find/i.test(err?.message ?? '')
      ? 'Dafür fehlt die Migration supabase/migrations/20261116000000_bot_stats.sql.'
      : `Nicht geladen: ${ctx.germanError(err)}`;
    return;
  }
  const day = data.day ?? {};
  status.textContent = `Letzte 24 Stunden: ${day.sent ?? 0} gesendet${day.failed ? `, ${day.failed} nicht angekommen` : ', keine Probleme'}${day.avg_ms ? ` · Twitch antwortet im Schnitt in ${day.avg_ms} ms` : ''}`;
  const items = data.items ?? [];
  if (!items.length) {
    list.replaceChildren(h('li', { class: 'botlog-empty' }, 'Noch keine Nachrichten protokolliert – schick eine Testnachricht.'));
    return;
  }
  list.replaceChildren(...items.map((it) => {
    const [ico, label] = STATUS[it.status] ?? ['?', it.status];
    const hint = it.status === 'sent' ? null : botHint(it.reason, it.bot);
    return h('li', { class: `botlog-item is-${it.status}` },
      h('span', { class: 'botlog-ico', title: label, 'aria-label': label }, ico),
      h('div', { class: 'botlog-main' },
        h('span', { class: 'botlog-text' }, it.text || '—'),
        h('small', {},
          `${timeOf(it.created_at)} · ${SOURCE[it.source] ?? it.source}${it.bot ? ` · @${it.bot}` : ''}${it.ms != null ? ` · ${it.ms} ms` : ''}`,
          it.status !== 'sent' ? h('b', { class: 'botlog-reason' }, ` · ${label}${it.reason ? `: ${it.reason}` : ''}`) : null),
        hint ? h('span', { class: 'botlog-fix' }, `${hint.why} → ${hint.fix}`) : null));
  }));
}
