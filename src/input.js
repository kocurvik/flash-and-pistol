// Keyboard + mouse with pointer lock and rebindable controls. Edge-triggered
// actions are counted so a quick tap between two simulation ticks is never lost.
// Mouse buttons are bound as 'Mouse0' (left), 'Mouse1' (middle), 'Mouse2' (right).

export const ACTIONS = [
  { id: 'forward', label: 'Move forward', keys: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Move back', keys: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Move left', keys: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Move right', keys: ['KeyD', 'ArrowRight'] },
  { id: 'jump', label: 'Jump', keys: ['Space', null] },
  { id: 'crouch', label: 'Crouch', keys: ['ShiftLeft', 'KeyC'] },
  { id: 'attack', label: 'Attack', keys: ['Mouse0', null] },
  { id: 'special', label: 'Special (medkit, tower, bottle, steal)', keys: ['Mouse2', 'KeyE'] },
  { id: 'flash', label: 'Flashlight (Longman)', keys: ['KeyF', null] },
  { id: 'weapon1', label: 'Weapon 1', keys: ['Digit1', null] },
  { id: 'weapon2', label: 'Weapon 2', keys: ['Digit2', null] },
  { id: 'scores', label: 'Scoreboard', keys: ['Tab', null] },
];

// Keys that can't be bound: Escape releases the mouse and opens the menu
export const RESERVED = ['Escape'];

export function defaultBindings() {
  const b = {};
  for (const a of ACTIONS) b[a.id] = a.keys.slice();
  return b;
}

const NAMES = {
  Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Tab: 'Tab', Enter: 'Enter', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', CapsLock: 'Caps Lock',
};
const MOUSE_LONG = ['Left click', 'Middle click', 'Right click', 'Mouse 4', 'Mouse 5'];
const MOUSE_SHORT = ['LMB', 'MMB', 'RMB', 'M4', 'M5'];

export function keyName(code, short = false) {
  if (!code) return '';
  if (code.startsWith('Mouse')) {
    const n = +code.slice(5);
    return (short ? MOUSE_SHORT : MOUSE_LONG)[n] || code;
  }
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

export class Input {
  constructor(canvas, bindings) {
    this.canvas = canvas;
    this.bindings = { ...defaultBindings(), ...(bindings || {}) };
    this.down = new Set(); // pressed key codes and 'MouseN'
    this.dx = 0;
    this.dy = 0;
    this.counts = {};
    this.consumed = {};
    for (const a of ACTIONS) { this.counts[a.id] = 0; this.consumed[a.id] = 0; }
    this.slotRequest = 0;
    this.pickRequest = 0;
    this.capture = null; // when set, the next key or mouse button is passed here (rebinding)
    this.forceActive = false; // tests: accept input without pointer lock

    document.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        if (!e.repeat) this.finishCapture(e.code);
        return;
      }
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code) || (this.locked && this.isBound(e.code))) e.preventDefault();
      if (!e.repeat) {
        this.press(e.code);
        if (/^Digit[1-4]$/.test(e.code)) this.pickRequest = +e.code.slice(5);
      }
      this.down.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    document.addEventListener('mousedown', (e) => {
      if (this.capture) {
        e.preventDefault();
        this.finishCapture('Mouse' + e.button);
        return;
      }
      if (!this.locked) return;
      const code = 'Mouse' + e.button;
      this.down.add(code);
      this.press(code);
    });
    document.addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    document.addEventListener('contextmenu', (e) => {
      if (this.capture || this.locked || e.target === canvas) e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });
    canvas.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.slotRequest = e.deltaY > 0 ? 2 : 1;
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.down.clear();
    });
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  lock() {
    if (this.locked) return;
    const plain = () => {
      try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    };
    try {
      // Raw mouse input where supported, plain pointer lock otherwise
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(plain);
    } catch { plain(); }
  }

  unlock() { if (this.locked) document.exitPointerLock(); }

  // ---------- Bindings ----------

  isBound(code) { return Object.values(this.bindings).some((list) => list.includes(code)); }

  press(code) {
    for (const [id, list] of Object.entries(this.bindings)) {
      if (!list.includes(code)) continue;
      this.counts[id]++;
      if (id === 'weapon1') this.slotRequest = 1;
      if (id === 'weapon2') this.slotRequest = 2;
    }
  }

  action(id) { return (this.bindings[id] || []).some((c) => c && this.down.has(c)); }

  // First bound key of an action, for on-screen labels
  label(id, short = false) {
    const list = (this.bindings[id] || []).filter(Boolean);
    return list.length ? keyName(list[0], short) : '(unbound)';
  }

  // Starts listening for a new key for one binding slot. done(code|null) is
  // called with the new code, or null if cancelled with Escape.
  startCapture(done) {
    // Defer so the click that opened the capture isn't captured itself
    setTimeout(() => { this.capture = done; }, 0);
  }

  finishCapture(code) {
    const done = this.capture;
    this.capture = null;
    if (done) done(RESERVED.includes(code) ? null : code);
  }

  // Sets one binding slot; the key is removed from any other action first.
  bind(id, slot, code) {
    if (code) {
      for (const list of Object.values(this.bindings)) {
        for (let i = 0; i < list.length; i++) if (list[i] === code) list[i] = null;
      }
    }
    this.bindings[id][slot] = code;
  }

  resetBindings() { this.bindings = defaultBindings(); }

  // ---------- Per-tick sampling ----------

  takeLook() { const d = { dx: this.dx, dy: this.dy }; this.dx = 0; this.dy = 0; return d; }

  pressed(id) {
    const p = this.counts[id] !== this.consumed[id];
    this.consumed[id] = this.counts[id];
    return p;
  }

  // Movement + action state for one simulation tick
  sample(yaw, pitch) {
    const active = this.locked || this.forceActive;
    const inp = {
      fwd: 0, right: 0, jump: false, jumpPressed: false, crouch: false,
      yaw, pitch, attack: false, attackPressed: false, special: false, specialPressed: false, flashPressed: false, slot: 0,
    };
    const jp = this.pressed('jump'), sp = this.pressed('special'), fp = this.pressed('flash');
    const ap = this.pressed('attack');
    const slot = this.slotRequest; this.slotRequest = 0;
    if (!active) return inp;
    inp.fwd = (this.action('forward') ? 1 : 0) - (this.action('back') ? 1 : 0);
    inp.right = (this.action('right') ? 1 : 0) - (this.action('left') ? 1 : 0);
    inp.jump = this.action('jump');
    inp.jumpPressed = jp;
    inp.crouch = this.action('crouch');
    // A click shorter than one tick still counts as an attack
    inp.attack = this.action('attack') || ap;
    inp.attackPressed = ap;
    inp.special = this.action('special');
    inp.specialPressed = sp;
    inp.flashPressed = fp;
    inp.slot = slot;
    return inp;
  }
}
