// Unangenehme Fragen: gemeinsame Helfer für die Webseite und das OBS-Overlay.

export const DEFAULT_STAGE = {
  question_id: null,
  text: '',
  author: '',
  state: 'hidden',
  punishment: null,
  punishments: [
    '10 Liegestütze – jetzt sofort',
    'Nächste Runde nur mit Pistolen',
    'Bis zum nächsten Kill nur mit Piepsstimme reden',
    'Den Refrain eines Liedes singen, das der Chat aussucht',
    'Der Chat sucht den nächsten Skin aus',
    'Nächste Runde ohne Heilung',
    '30 Sekunden Hampelmann',
    'Eine Minute lang jedem im Chat ein Kompliment machen',
    'Ein Glas Wasser auf ex',
    'Nächste Runde mit invertierter Maus/Kamera',
  ],
};

export const STATUS_LABEL = {
  pending: 'Wird geprüft',
  approved: 'Freigegeben',
  rejected: 'Abgelehnt',
  done: 'Im Stream',
};
export const OUTCOME_LABEL = {
  answered: '✅ Beantwortet',
  punished: '😈 Bestrafung',
  skipped: '⏭ Übersprungen',
};

// Füllt die Karte „Frage an Dave“ (Webseite: Vorschau, Overlay: im Stream).
// Erwartet .qcard-author, .qcard-text, .qcard-result darin.
export function paintQuestionCard(el, stage) {
  const state = stage?.state ?? 'hidden';
  el.dataset.state = state;
  el.querySelector('.qcard-author').textContent = stage?.author ? `Frage von ${stage.author}` : 'Frage aus dem Chat';
  el.querySelector('.qcard-text').textContent = stage?.text ?? '';
  const result = el.querySelector('.qcard-result');
  result.textContent = state === 'answered' ? '✅ Dave hat geantwortet!'
    : state === 'punished' ? `😈 Bestrafung: ${stage.punishment ?? ''}`
      : state === 'skipped' ? '⏭ Übersprungen'
        : '';
  result.hidden = !result.textContent;
}
