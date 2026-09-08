/* First run: which of the two people is holding this phone.
 *
 * Asked as a plain question with two plain answers. The roles are never named
 * on screen - "elder" reads badly to the person being called it - and the
 * choice is reversible from Settings, so nobody is trapped by a wrong tap.
 */

import { S } from '../strings.js';
import { el, clear, icon, openSheet } from '../ui.js';

/* Compact explanatory diagrams, each showing one part of the shared flow. */
const HOW_ART = {
  role: '<svg viewBox="0 0 320 176" aria-hidden="true"><path class="how-line" d="M160 64v22M160 86C160 108 91 96 91 126M160 86c0 22 69 10 69 40"/><g class="how-node how-node-main"><circle cx="160" cy="43" r="31"/><path d="m146 31 28 28M139 38l14-14a10 10 0 0 1 14 0l17 17a10 10 0 0 1 0 14l-14 14a10 10 0 0 1-14 0l-17-17a10 10 0 0 1 0-14Z"/></g><g class="how-node how-node-blue"><circle cx="91" cy="137" r="29"/><path d="m77 137 9 9 19-20"/></g><g class="how-node how-node-teal"><circle cx="229" cy="137" r="29"/><circle cx="220" cy="137" r="10"/><circle cx="238" cy="137" r="10"/></g></svg>',
  setup: '<svg viewBox="0 0 320 176" aria-hidden="true"><g class="how-photo"><rect x="28" y="31" width="106" height="106" rx="24"/><path d="m65 78 34 34M55 88l18-18a12 12 0 0 1 17 0l18 18a12 12 0 0 1 0 17l-18 18a12 12 0 0 1-17 0l-18-18a12 12 0 0 1 0-17Z"/><circle cx="116" cy="49" r="13"/><path d="m110 49 4 4 8-9"/></g><path class="how-arrow" d="M150 84h34m-10-10 10 10-10 10"/><g class="how-schedule"><circle cx="235" cy="84" r="48"/><circle cx="235" cy="84" r="22"/><path d="M235 69v16l11 8"/><path class="how-ray" d="M235 21v8M235 139v8M172 84h8M290 84h8"/></g></svg>',
  today: '<svg viewBox="0 0 320 176" aria-hidden="true"><path class="how-line" d="M103 88h44M173 88h42"/><g class="how-pill-photo"><circle cx="66" cy="88" r="42"/><path d="m50 72 32 32M43 79l15-15a11 11 0 0 1 16 0l16 16a11 11 0 0 1 0 16l-15 15a11 11 0 0 1-16 0L43 95a11 11 0 0 1 0-16Z"/></g><g class="how-done"><circle cx="160" cy="88" r="28"/><path d="m147 88 9 9 18-21"/></g><g class="how-bell"><circle cx="254" cy="88" r="42"/><path d="M238 98h32l-5-7V79c0-8-5-14-11-14s-11 6-11 14v12l-5 7Zm11 7h10"/><path class="how-ray" d="M224 69l-7-6M284 69l7-6M254 42v-9"/></g></svg>',
  box: '<svg viewBox="0 0 320 176" aria-hidden="true"><g class="how-packet"><rect x="18" y="48" width="55" height="78" rx="9"/><path d="M18 68h55M30 86h30M30 98h21"/><path d="m35 111 20-20"/></g><path class="how-arrow" d="M86 87h31m-10-10 10 10-10 10"/><g class="how-tray"><rect x="129" y="25" width="166" height="126" rx="20"/><path d="M153 49h50v34h-50zM203 49h50v34h-50zM253 49h18v34h-18zM153 83h50v44h-50zM203 83h50v44h-50zM253 83h18v44h-18z"/><circle cx="178" cy="66" r="8"/><path d="m221 58 14 14M216 63l6-6a5 5 0 0 1 7 0l7 7a5 5 0 0 1 0 7l-6 6a5 5 0 0 1-7 0l-7-7a5 5 0 0 1 0-7Z"/><circle cx="178" cy="105" r="8"/><circle cx="228" cy="105" r="8"/></g><g class="how-check"><circle cx="279" cy="32" r="18"/><path d="m270 32 6 6 12-14"/></g></svg>',
};

function howArtwork(name) {
  return el('div.how-art.how-art-' + name, {
    html: HOW_ART[name], 'aria-hidden': 'true',
  });
}

function openHowItWorks() {
  const steps = [
    { art: 'role', title: S.howRoleTitle, body: S.howRoleBody },
    { art: 'setup', title: S.howSetupTitle, body: S.howSetupBody },
    { art: 'today', title: S.howTodayTitle, body: S.howTodayBody },
    { art: 'box', title: S.howBoxTitle, body: S.howBoxBody },
  ];
  let current = 0;
  const stage = el('div.how-stage');
  const nav = el('div.how-nav');
  const content = el('div.how-flow', [stage, nav]);
  const sheet = openSheet({
    title: S.howTitle,
    content,
    panelClassName: 'how-sheet',
    layerClassName: 'how-sheet-layer',
  });

  function draw() {
    const step = steps[current];
    clear(stage);
    stage.appendChild(el('div.how-slide', [
      el('p.how-kicker', { text: S.howStep(current + 1, steps.length) }),
      howArtwork(step.art),
      el('h3.how-step-title', { text: step.title }),
      el('p.how-step-body', { text: step.body }),
    ]));

    clear(nav);
    const dots = el('div.how-dots', { role: 'group', 'aria-label': S.howTitle },
      steps.map((item, index) => el(
        'button.how-dot' + (index === current ? '.is-current' : ''),
        {
          type: 'button',
          'aria-label': S.howStep(index + 1, steps.length),
          'aria-current': index === current ? 'step' : null,
          onclick: () => { current = index; draw(); },
        },
      )));
    const actions = el('div.how-actions', [
      current > 0 ? el('button.btn.btn-quiet', {
        type: 'button', text: S.howBack,
        onclick: () => { current -= 1; draw(); },
      }) : el('span'),
      el('button.btn.btn-primary', {
        type: 'button',
        text: current === steps.length - 1 ? S.howDone : S.howNext,
        onclick: () => {
          if (current === steps.length - 1) sheet.close();
          else { current += 1; draw(); }
        },
      }),
    ]);
    nav.appendChild(dots);
    nav.appendChild(actions);
  }

  draw();
}

export async function welcomeView({ app }) {
  clear(app);

  app.appendChild(el('div.welcome', [
    el('div.welcome-logo', icon('pill')),
    el('h1.welcome-title', { text: S.welcomeTitle }),
    el('p.welcome-intro', { text: S.welcomeIntro }),

    el('button.welcome-how', { type: 'button', onclick: openHowItWorks }, [
      el('span.welcome-how-mark', icon('pill')),
      el('span', { text: S.howItWorks }),
      el('span.welcome-how-arrow', { 'aria-hidden': 'true', text: '›' }),
    ]),

    el('a.role-btn', { href: '#/signin' }, [
      el('span.role-icon', icon('today')),
      el('span.role-text', [
        el('span.role-name', { text: S.roleSimple }),
        el('span.role-hint', { text: S.roleSimpleHint }),
      ]),
      el('span.role-chevron', { 'aria-hidden': 'true', text: '›' }),
    ]),

    el('a.role-btn', { href: '#/pair' }, [
      el('span.role-icon.role-icon-accent', icon('pill')),
      el('span.role-text', [
        el('span.role-name', { text: S.roleSupporter }),
        el('span.role-hint', { text: S.roleSupporterHint }),
      ]),
      el('span.role-chevron', { 'aria-hidden': 'true', text: '›' }),
    ]),

    el('p.welcome-foot', { text: S.roleChangeLater }),
  ]));
}
