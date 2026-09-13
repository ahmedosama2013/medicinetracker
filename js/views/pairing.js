/* Helper: enter the household's share code. No account, no sign-in — the code
 * itself is validated by loading the routine it unlocks, then stored on this
 * device the same way the local `role` always has been.
 *
 * Painted in the helper's palette (#E5E9F0 canvas, navy primary) before a role
 * exists, so the helper lands in their own product from the first tap rather
 * than arriving in the elder's warm one and being recoloured a screen later.
 *
 * Four states, each a tinted panel with a glyph, a heading and an explanation:
 * invalid code, connection failed, connecting, connected. The two failures are
 * deliberately different — a wrong code is the helper's to fix by asking; a
 * dropped connection is not their fault and must not be reported as if it
 * were.
 */

import * as store from '../store.js';
import * as supporter from '../supporter.js';
import * as router from '../router.js';
import { S } from '../strings.js';
import { el, mount, screen, field, progressBar, toast } from '../ui.js';

const CODE_LENGTH = 6;
const CODE_FORMAT = /^[A-Z0-9]{6}$/;

export async function pairView({ app }) {
  supporter.preload();

  let code = '';
  let state = 'idle';                 // 'idle' | 'loading' | 'invalid' | 'failed' | 'done'
  let householdName = '';

  /* Fills the field, never submits it. The code the clipboard holds is
   * whatever the elder read out or the household sent, and a mistyped digit
   * copied along with it is exactly the kind of thing a person wants one more
   * look at before connecting -- so this is a shortcut past typing, not past
   * reviewing. */
  async function pasteCode() {
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast(S.pairPasteReadError);
      return;
    }
    const value = (text || '').trim().toUpperCase();
    if (!CODE_FORMAT.test(value)) {
      toast(S.pairPasteFormatError);
      return;
    }
    code = value;
    draw();
    document.getElementById('pair-code')?.focus();
  }

  async function connect() {
    const value = code.trim().toUpperCase();
    if (!value) { state = 'invalid'; draw(); return; }

    state = 'loading';
    draw();
    try {
      const routine = await supporter.loadRoutine(value);
      householdName = routine.household?.displayName || '';
      await store.saveSettings({
        role: 'supporter',
        supporterCode: value,
        supporterHouseholdName: householdName,
      });
      state = 'done';
      draw();
    } catch (err) {
      /* app.household_by_code raises exactly this message for a code that
       * doesn't match any household (see supabase/migrations/0001_init.sql).
       * Anything else -- a dropped connection, a module that failed to load --
       * is not the code's fault and gets the amber panel, not the red one. */
      state = /that code is not valid/i.test(err?.message || '') ? 'invalid' : 'failed';
      draw();
    }
  }

  function finish() {
    /* A full reload, not a hash change: boot decides the mode, wires the
     * supporter's poll and hydrates the cache before the first render. */
    window.location.replace(router.HOME.supporter);
    window.location.reload();
  }

  function statePanel() {
    if (state === 'invalid') {
      return el('div.notice.notice-bad', { role: 'alert' }, [
        el('span.notice-glyph', { 'aria-hidden': 'true', text: '✕' }),
        el('span.notice-main', [
          el('span.notice-title', { text: S.pairInvalidTitle }),
          el('span.notice-body', { text: S.pairInvalidBody }),
        ]),
      ]);
    }

    if (state === 'failed') {
      return el('div.notice.notice-warn', { role: 'alert' }, [
        el('span.notice-glyph', { 'aria-hidden': 'true', text: '!' }),
        el('span.notice-main', [
          el('span.notice-title', { text: S.pairFailedTitle }),
          el('span.notice-body', { text: S.pairFailedBody }),
          el('button.btn-s.btn-primary', {
            type: 'button', text: S.pairRetry, style: 'align-self: flex-start', onclick: connect,
          }),
        ]),
      ]);
    }

    if (state === 'loading') {
      return el('div.notice', { role: 'status', 'aria-busy': 'true', style: 'flex-direction: column; gap: 10px' }, [
        el('span.notice-title', { text: S.pairConnecting }),
        progressBar(),
      ]);
    }

    if (state === 'done') {
      return el('div.notice.notice-good', { role: 'status' }, [
        el('span.notice-title', { text: `✓ ${S.pairDoneTitle(householdName)}` }),
        el('span.notice-body', { text: S.pairDoneBody }),
      ]);
    }

    return null;
  }

  function draw() {
    const input = el('input.pair-code-input', {
      type: 'text',
      id: 'pair-code',
      value: code,
      inputmode: 'text',
      autocomplete: 'one-time-code',
      autocapitalize: 'characters',
      autocorrect: 'off',
      spellcheck: false,
      maxlength: String(CODE_LENGTH),
      placeholder: S.pairCodePlaceholder,
      'aria-invalid': state === 'invalid' ? 'true' : null,
      class: state === 'invalid' ? 'is-invalid' : '',
      disabled: state === 'loading' || state === 'done',
      oninput: e => {
        // Upper case in place: the codes are printed upper case on the other
        // phone, and a lower-case copy is the commonest way to mistype one.
        const next = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        e.target.value = next;
        code = next;
      },
      onkeydown: e => { if (e.key === 'Enter' && code.trim()) connect(); },
    });

    mount(app, screen({
      supporter: true,
      head: el('div.pair-bar', [el('a.back-btn', { href: '#/welcome', text: S.back })]),
      scroll: el('div.pair-body', [
        el('div', { style: 'display: flex; flex-direction: column; gap: 8px' }, [
          el('span.kicker', { text: S.pairKicker }),
          el('h1.pair-title', { text: S.pairTitle }),
          el('p.pair-intro', { text: S.pairIntro }),
        ]),
        field({
          id: 'pair-code',
          label: S.pairCodeLabel,
          control: el('div.pair-code-row', [
            input,
            el('button.btn-s.btn-nav-outline.pair-paste-btn', {
              type: 'button', text: S.pairPasteButton, onclick: pasteCode,
            }),
          ]),
        }),
        statePanel(),
      ]),
      foot: el('div.pair-foot', [
        state === 'done'
          ? el('button.btn.btn-primary', { type: 'button', text: S.pairGoToToday, onclick: finish })
          : el('button.btn.btn-primary', {
            type: 'button',
            text: state === 'loading' ? S.pairConnecting : S.pairConnect,
            disabled: state === 'loading',
            onclick: connect,
          }),
      ]),
    }));
  }

  draw();
}
