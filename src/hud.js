// DOM heads-up display: hearts, loadout, score, timer, kill feed, hints, scoreboard.
import { CHARACTERS, WEAPONS, GAME, TEAM_NAMES } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tcls = (team) => (team === 'yellow' ? 'ty' : 'tt');

export const CHAR_ICONS = { longman: '🔦', builder: '🔧', doctor: '🧪', spy: '🕶️' };
const SPECIAL_NAMES = { medkit: 'Medkit', tower: 'Tower', bottle: 'Healing bottle', steal: 'Steal weapon' };

export class HUD {
  constructor(input) {
    this.input = input; // for showing the player's own key bindings
    this.root = $('hud');
    this.msgT = 0;
    this.hintT = 0;
    this.hintOverride = '';
    this.cache = {};
  }

  key(id) { return esc(this.input ? this.input.label(id, true) : id); }

  show(on) { this.root.classList.toggle('hidden', !on); }

  set(id, html) {
    if (this.cache[id] === html) return;
    this.cache[id] = html;
    $(id).innerHTML = html;
  }

  message(text, sub = '', time = 2.5) {
    this.set('center-msg', esc(text));
    this.set('sub-msg', sub);
    this.msgT = time;
  }

  flashHint(text, time = 2) {
    this.hintOverride = text;
    this.hintT = time;
  }

  hitmarker(heal = false) {
    const h = $('hitmarker');
    h.classList.toggle('heal', heal);
    h.classList.add('on');
    clearTimeout(this.hmTimer);
    this.hmTimer = setTimeout(() => h.classList.remove('on'), 60);
  }

  hurt() {
    const v = $('vignette');
    v.classList.add('on');
    clearTimeout(this.vgTimer);
    this.vgTimer = setTimeout(() => v.classList.remove('on'), 80);
    const h = $('hearts');
    h.classList.remove('pulse');
    void h.offsetWidth;
    h.classList.add('pulse');
  }

  feed(html, mine = false) {
    const el = document.createElement('div');
    el.className = 'k' + (mine ? ' mine' : '');
    el.innerHTML = html;
    const kf = $('killfeed');
    kf.appendChild(el);
    while (kf.children.length > 6) kf.removeChild(kf.firstChild);
    setTimeout(() => el.remove(), 7000);
  }

  name(e) { return e ? `<span class="${tcls(e.team)}">${esc(e.name)}</span>` : '?'; }

  update(view, me, ctx, dt) {
    // Center message timeout
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) { this.set('center-msg', ''); this.set('sub-msg', ''); }
    }

    // Score + timer
    this.set('score-y', String(view.score.yellow));
    this.set('score-t', String(view.score.teal));
    let timer = '';
    if (view.phase === 'play') {
      const t = Math.max(0, Math.ceil(view.phaseT));
      timer = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    } else if (view.phase === 'countdown') timer = String(Math.ceil(view.phaseT));
    else if (view.phase === 'roundEnd') timer = '—';
    this.set('timer', timer);
    $('timer').classList.toggle('low', view.phase === 'play' && view.phaseT < 30);
    this.set('round-label', view.round ? `Round ${view.round} · first to ${GAME.roundsToWin}` : '');

    // Alive pips
    let alive = '';
    for (const team of ['yellow', 'teal']) {
      const pips = view.entities.filter((e) => e.team === team)
        .map((e) => `<div class="pip" style="background:${e.alive ? (team === 'yellow' ? 'var(--yellow)' : 'var(--teal)') : 'rgba(0,0,0,.35)'}"></div>`).join('');
      alive += `<div class="pips">${pips}</div>`;
    }
    this.set('alive', alive);

    // Status: hearts + character
    const alivePlayer = me && me.alive;
    $('status').classList.toggle('hidden', !alivePlayer);
    $('loadout').classList.toggle('hidden', !alivePlayer);
    $('crosshair').classList.toggle('hidden', !alivePlayer);
    $('invis').classList.toggle('hidden', !(alivePlayer && me.char === 'spy'));
    if (alivePlayer) {
      const def = CHARACTERS[me.char];
      this.set('charname', `${CHAR_ICONS[me.char]} ${def.name}`);
      let h = '';
      for (let i = 0; i < me.maxHearts; i++) h += `<span class="${i < me.hearts ? 'on' : 'off'}">♥</span>`;
      this.set('hearts', h);
      this.set('loadout', this.loadoutHtml(me, def));
      const bb = $('buildbar');
      bb.classList.toggle('hidden', !(me.buildT > 0));
      if (me.buildT > 0) bb.firstElementChild.style.width = `${Math.min(100, (me.buildT / def.buildTime) * 100)}%`;
    } else {
      $('buildbar').classList.add('hidden');
    }

    // Spectating label
    this.set('spectate', ctx.spectating ? `Spectating ${this.name(ctx.spectating)} · click to switch` : (me && !me.alive && view.phase === 'play' ? 'You are out until the next round' : ''));

    // Hints
    if (this.hintT > 0) {
      this.hintT -= dt;
      this.set('hint', esc(this.hintOverride));
      $('hint').classList.add('alert');
    } else {
      this.set('hint', ctx.hint || '');
      $('hint').classList.remove('alert');
    }

    // Scoreboard
    const sb = $('scoreboard');
    sb.classList.toggle('hidden', !ctx.showScores);
    if (ctx.showScores) this.set('scoreboard', this.scoreboardHtml(view, me));
  }

  loadoutHtml(me, def) {
    if (me.weapon === 'nailgun') {
      const b = CHARACTERS.builder;
      return `<div class="slot active"><span class="k">${this.key('attack')}</span>Nail gun · hits ${b.nailMinRange}–${b.nailMaxRange} m from the tower</div>` +
        `<div class="slot active"><span class="k">${this.key('crouch')}+${this.key('jump')}</span>Collapse tower</div>`;
    }
    const slots = [];
    if (def.special === 'steal') {
      slots.push({ k: 1, w: def.primary, ok: true });
      if (me.stolen) slots.push({ k: 2, w: me.stolen, ok: true, stolen: true });
    } else {
      slots.push({ k: 1, w: def.primary, ok: me.hasPrimary });
      slots.push({ k: 2, w: def.backup, ok: true });
    }
    let html = '';
    for (const s of slots) {
      const name = s.ok ? WEAPONS[s.w].name : `<s>${WEAPONS[s.w].name}</s> stolen!`;
      html += `<div class="slot${me.weapon === s.w && s.ok ? ' active' : ''}${s.stolen ? ' stolen' : ''}"><span class="k">${this.key(s.k === 1 ? 'weapon1' : 'weapon2')}</span>${name}</div>`;
    }
    const ready = me.specialCd <= 0;
    let label = SPECIAL_NAMES[def.special];
    let pct = ready ? 100 : 100 * (1 - me.specialCd / (me.specialMax || 1));
    let state = ready ? 'ready' : `${Math.ceil(me.specialCd)}s`;
    if (def.special === 'tower') {
      if (!me.hasPrimary) { state = 'needs wrench'; pct = 0; }
      else if (me.towerId !== null && me.towerId !== undefined) { state = 'built'; pct = 100; }
    }
    html += `<div class="special"><div style="display:flex;gap:12px"><span><span class="k">${this.key('special')}</span>${label}</span><span style="margin-left:auto">${state}</span></div><div class="bar"><div style="width:${pct}%"></div></div></div>`;
    if (me.char === 'longman') html += `<div class="slot${me.flashlight ? ' active' : ''}"><span class="k">${this.key('flash')}</span>Flashlight ${me.flashlight ? 'ON' : 'off'}</div>`;
    return html;
  }

  scoreboardHtml(view, me) {
    const col = (team) => {
      const rows = view.entities.filter((e) => e.team === team)
        .sort((a, b) => b.kills - a.kills)
        .map((e) => {
          const ch = e.char && e.alive !== undefined ? `${CHAR_ICONS[e.char] || ''} ${CHARACTERS[e.char] ? CHARACTERS[e.char].name : ''}` : '';
          return `<tr class="${e.alive ? '' : 'dead'} ${me && e.id === me.id ? 'me' : ''}"><td>${esc(e.name)}</td><td>${ch}</td><td>${e.kills}</td><td>${e.deaths}</td><td>${e.heals || 0}</td></tr>`;
        }).join('');
      return `<table><tr><th class="${tcls(team)}" colspan="2">${TEAM_NAMES[team]} · ${view.score[team]}</th><th>K</th><th>D</th><th>Heal</th></tr>${rows}</table>`;
    };
    return `<div class="cols">${col('yellow')}${col('teal')}</div>`;
  }
}
