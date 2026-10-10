// Startseite: KI-Hilfe, Kontaktformular und Showcase („Diese Streamer nutzen StreamHelp“).
//   · KI-Hilfe: fragt die Edge Function help-chat (KI-Dienst nach Wahl, siehe dort). Ist keiner
//     eingerichtet oder hakt es, sucht die Seite selbst die passende Antwort in den FAQ – kostenlos.
//   · Kontaktformular: contact_send (Migration …_contact_showcase.sql), Nachrichten landen im Admin-Bereich.
//   · Showcase: showcase_list – nur Kanäle, deren Streamer zugestimmt haben.
import { currentLang, sourceOf, t } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
let api = null;
let started = false;
const history = [];

export function setupHelp(root, theApi) {
  if (started || !root) return;
  started = true;
  api = theApi;
  setupChat(root);
  setupForm(root);
  loadShowcase(root);
}

// ---------- KI-Hilfe ----------
function setupChat(root) {
  const log = $('#help-log', root);
  const form = $('#help-form', root);
  if (!log || !form) return;
  const say = (text, who, cls = '') => {
    const li = document.createElement('li');
    li.className = `nc-help-msg nc-help-msg--${who} ${cls}`.trim();
    li.textContent = text;
    log.append(li);
    log.scrollTop = log.scrollHeight;
    return li;
  };
  let busy = false;
  const ask = async (question) => {
    const q = question.replace(/\s+/g, ' ').trim();
    if (q.length < 3 || busy) return;
    busy = true;
    form.q.value = '';
    say(q, 'me');
    const wait = say(t('Ich schau nach'), 'bot', 'is-wait');
    let answer = '';
    try {
      const r = await api.helpAsk(q, currentLang(), history.slice(-4));
      if (r?.answer) answer = r.answer;
      else if (r?.error) answer = r.message ?? r.error;
    } catch (err) {
      if (/zu viele|rate|429/i.test(err?.message ?? '')) answer = t('Zu viele Fragen – bitte kurz warten.');
    }
    if (!answer) answer = faqAnswer(root, q);
    wait.classList.remove('is-wait');
    wait.textContent = answer;
    history.push({ role: 'user', content: q }, { role: 'assistant', content: answer });
    busy = false;
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); ask(form.q.value); });
  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-help-q]');
    if (chip) ask(chip.textContent);
  });
}

// Ohne KI-Dienst: die FAQ-Antwort mit den meisten gemeinsamen Wörtern (auch übersetzt)
const words = (s) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)));
const STOP = new Set(['und', 'oder', 'der', 'die', 'das', 'ich', 'wie', 'was', 'mit', 'ein', 'eine', 'auf', 'für', 'ist', 'the', 'and', 'how', 'what', 'can', 'does', 'mein', 'meine', 'streamhelp', 'gibt', 'kann', 'wird']);
export function faqAnswer(root, question) {
  const q = words(question);
  let best = null;
  let bestScore = 0;
  for (const d of root.querySelectorAll('#faq details')) {
    const title = $('summary', d)?.textContent ?? '';
    const body = $('p', d)?.textContent ?? '';
    // In der angezeigten Sprache und auf Deutsch suchen (wer auf Deutsch fragt, findet's auch auf der englischen Seite)
    const tw = new Set([...words(title), ...words(sourceOf(title))]);
    const bw = new Set([...words(body), ...words(sourceOf(body))]);
    let score = 0;
    for (const w of q) {
      if (tw.has(w)) score += 3;
      else if (bw.has(w)) score += 1;
      else if ([...tw, ...bw].some((x) => x.length > 4 && (x.startsWith(w) || w.startsWith(x)))) score += 0.5;
    }
    if (score > bestScore) { bestScore = score; best = body; }
  }
  return bestScore >= 1.5 && best
    ? best
    : t('Dazu weiß ich leider nichts Genaues. Schreib uns über das Formular daneben – wir helfen dir persönlich weiter.');
}

// ---------- Kontaktformular ----------
function setupForm(root) {
  const form = $('#contact-form', root);
  if (!form) return;
  const msg = $('.nc-form-msg', form);
  const shownAt = Date.now();
  const show = (text, ok) => {
    msg.textContent = text;
    msg.classList.toggle('is-ok', ok);
    msg.classList.toggle('is-error', !ok);
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = form.message.value.trim();
    const email = form.email.value.trim();
    if (message.length < 10) { show(t('Bitte schreib etwas mehr (mindestens 10 Zeichen).'), false); form.message.focus(); return; }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) { show(t('Diese E-Mail-Adresse ist ungültig.'), false); form.email.focus(); return; }
    // Bots füllen das versteckte Feld aus oder schicken sofort ab
    if (form.website.value || Date.now() - shownAt < 3000) { show(t('Danke! Deine Nachricht ist angekommen.'), true); form.reset(); return; }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await api.contactSend({
        name: form.name.value.trim(), email, topic: form.topic.value, message, lang: currentLang(), website: form.website.value,
      });
      form.reset();
      show(email ? t('Danke! Deine Nachricht ist angekommen – wir antworten an deine E-Mail.') : t('Danke! Deine Nachricht ist angekommen.'), true);
    } catch (err) {
      show(/could not find|PGRST202|contact_send/i.test(err?.message ?? '')
        ? t('Das Formular ist noch nicht eingerichtet. Bitte versuch es später noch einmal.')
        : t(err?.message ?? 'Hat nicht geklappt.'), false);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Showcase ----------
async function loadShowcase(root) {
  const box = $('#lp-showcase', root);
  const list = $('#lp-showcase-list', root);
  if (!box || !list || !api.showcaseList) return;
  let rows = [];
  try { rows = await api.showcaseList(); } catch { return; }
  if (!rows?.length) return;
  list.replaceChildren(...rows.map((c) => {
    const a = document.createElement('a');
    a.href = `https://www.twitch.tv/${encodeURIComponent(c.login)}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const ava = document.createElement('span');
    ava.className = 'nc-channel-ava';
    ava.setAttribute('aria-hidden', 'true');
    if (/^https:\/\//.test(c.avatar_url ?? '')) {
      const img = new Image();
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.src = c.avatar_url;
      ava.append(img);
    } else {
      ava.textContent = (c.display_name || c.login).slice(0, 1).toUpperCase();
    }
    const name = document.createElement('b');
    name.textContent = c.display_name || c.login;
    a.append(ava, name);
    if (c.live) {
      const live = document.createElement('span');
      live.className = 'nc-showcase-live';
      live.textContent = 'LIVE';
      a.append(live);
      if (c.category) {
        const cat = document.createElement('small');
        cat.textContent = c.category;
        a.append(cat);
      }
    }
    const li = document.createElement('li');
    li.append(a);
    return li;
  }));
  box.hidden = false;
  const section = box.closest('section');
  if (section) section.hidden = false;
}
