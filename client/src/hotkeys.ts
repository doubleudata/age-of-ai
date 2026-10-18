// Customizable RTS hotkeys. Bindings use KeyboardEvent.code (the PHYSICAL key),
// so the AoM-style command grid (Q W E R T / A S D F G / Z X C V B) stays a grid
// on any keyboard layout. Saved in localStorage; the Options menu edits them.
//
// Control groups (1-9 select, Ctrl+1-9 save) are fixed and not rebindable.

export type HotkeyAction =
  | 'panUp' | 'panDown' | 'panLeft' | 'panRight'
  | 'chat' | 'pause' | 'cancel' | 'home' | 'idleVillager' | 'stop' | 'delete' | 'unload'
  | 'techTree' | 'mute' | 'music'
  | 'power1' | 'power2' | 'power3' | 'power4'
  | 'grid1' | 'grid2' | 'grid3' | 'grid4' | 'grid5'
  | 'grid6' | 'grid7' | 'grid8' | 'grid9' | 'grid10'
  | 'grid11' | 'grid12' | 'grid13' | 'grid14' | 'grid15';

/** A key chord: physical key code + modifiers. */
export interface Chord {
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type Bindings = Record<HotkeyAction, Chord[]>;

export const HOTKEY_ACTIONS: HotkeyAction[] = [
  'panUp', 'panDown', 'panLeft', 'panRight',
  'home', 'idleVillager', 'stop', 'delete', 'unload', 'cancel',
  'techTree', 'chat', 'pause', 'mute', 'music',
  'power1', 'power2', 'power3', 'power4',
  'grid1', 'grid2', 'grid3', 'grid4', 'grid5',
  'grid6', 'grid7', 'grid8', 'grid9', 'grid10',
  'grid11', 'grid12', 'grid13', 'grid14', 'grid15',
];

const k = (code: string, mods: Omit<Chord, 'code'> = {}): Chord => ({ code, ...mods });
const GRID_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'];

const COMMON: Partial<Bindings> = {
  chat: [k('Enter')],
  cancel: [k('Escape')],
  home: [k('KeyH')],
  idleVillager: [k('Period')],
  delete: [k('Delete')],
  power1: [k('F5')], power2: [k('F6')], power3: [k('F7')], power4: [k('F8')],
};

export type PresetId = 'classic' | 'aom';

/** 'classic' = the original Age of AI keys (WASD camera, no command grid).
 *  'aom' = Age of Mythology style: arrow-key camera + Q…B command grid. */
export const PRESETS: Record<PresetId, Bindings> = {
  classic: {
    ...emptyBindings(),
    ...COMMON,
    panUp: [k('KeyW'), k('ArrowUp')], panDown: [k('KeyS'), k('ArrowDown')],
    panLeft: [k('KeyA'), k('ArrowLeft')], panRight: [k('KeyD'), k('ArrowRight')],
    stop: [k('KeyX')], unload: [k('KeyU')], pause: [k('KeyP')],
    techTree: [k('KeyT')], mute: [k('KeyM')], music: [k('KeyN')],
  } as Bindings,
  aom: {
    ...emptyBindings(),
    ...COMMON,
    panUp: [k('ArrowUp')], panDown: [k('ArrowDown')], panLeft: [k('ArrowLeft')], panRight: [k('ArrowRight')],
    stop: [k('KeyX', { ctrl: true })], unload: [k('KeyU', { ctrl: true })], pause: [k('F3'), k('Pause')],
    techTree: [k('F2')], mute: [k('KeyM', { ctrl: true })], music: [k('KeyN', { ctrl: true })],
    ...Object.fromEntries(GRID_CODES.map((c, i) => [`grid${i + 1}`, [k(c)]])),
  } as Bindings,
};

function emptyBindings(): Bindings {
  return Object.fromEntries(HOTKEY_ACTIONS.map((a) => [a, []])) as unknown as Bindings;
}

const STORE = 'ageofai:hotkeys';

interface Stored { preset: PresetId; bindings: Bindings }

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Stored>;
      const preset: PresetId = p.preset === 'aom' ? 'aom' : 'classic';
      const base = structuredClone(PRESETS[preset]);
      for (const a of HOTKEY_ACTIONS) {
        const v = p.bindings?.[a];
        if (Array.isArray(v)) base[a] = v.filter((c) => c && typeof c.code === 'string').slice(0, 2);
      }
      return { preset, bindings: base };
    }
  } catch { /* corrupt / unavailable: defaults */ }
  return { preset: 'classic', bindings: structuredClone(PRESETS.classic) };
}

const state: Stored = load();
const listeners = new Set<() => void>();

export function hotkeys(): Readonly<Bindings> { return state.bindings; }
export function currentPreset(): PresetId { return state.preset; }

function save(): void {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* not persisted */ }
  for (const l of listeners) l();
}

export function onHotkeysChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyPreset(id: PresetId): void {
  state.preset = id;
  state.bindings = structuredClone(PRESETS[id]);
  save();
}

/** Bind `action` slot (0 = primary, 1 = secondary). `null` clears the slot.
 *  The same chord is removed from any other action (no silent conflicts). */
export function setBinding(action: HotkeyAction, slot: 0 | 1, chord: Chord | null): void {
  if (chord) {
    for (const a of HOTKEY_ACTIONS) state.bindings[a] = state.bindings[a].filter((c) => !sameChord(c, chord));
  }
  const list = [...state.bindings[action]];
  if (chord) list[slot] = chord;
  else list.splice(slot, 1);
  state.bindings[action] = list.filter(Boolean).slice(0, 2);
  save();
}

export function sameChord(a: Chord, b: Chord): boolean {
  return a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt;
}

/** Chord from a key event (modifier keys alone are not chords). */
export function chordOf(e: KeyboardEvent): Chord | null {
  if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return null;
  const c: Chord = { code: e.code };
  if (e.ctrlKey || e.metaKey) c.ctrl = true;
  if (e.shiftKey) c.shift = true;
  if (e.altKey) c.alt = true;
  return c;
}

/** Does the event trigger this action? Pan keys ignore modifiers (so you can
 *  pan while holding Shift); everything else matches modifiers exactly. */
export function matches(e: KeyboardEvent, action: HotkeyAction): boolean {
  const chord = chordOf(e);
  if (!chord) return false;
  const loose = action.startsWith('pan');
  return state.bindings[action].some((b) => b.code === chord.code && (loose || sameChord(b, chord)));
}

/** First action bound to this event, if any. */
export function actionFor(e: KeyboardEvent): HotkeyAction | null {
  for (const a of HOTKEY_ACTIONS) if (matches(e, a)) return a;
  return null;
}

/** Codes currently bound to camera panning (held-key handling). */
export function panVector(code: string): [number, number] | null {
  const b = state.bindings;
  if (b.panUp.some((c) => c.code === code)) return [0, -1];
  if (b.panDown.some((c) => c.code === code)) return [0, 1];
  if (b.panLeft.some((c) => c.code === code)) return [-1, 0];
  if (b.panRight.some((c) => c.code === code)) return [1, 0];
  return null;
}

/** Human-readable label, e.g. "Ctrl+X", "F2", ".", "↑". */
export function chordLabel(c: Chord | undefined): string {
  if (!c) return '—';
  const names: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Period: '.', Comma: ',',
    Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`',
    Minus: '-', Equal: '=', Backslash: '\\', Space: 'Space', Escape: 'Esc', Delete: 'Del',
  };
  let key = names[c.code] ?? c.code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
  if (c.alt) key = `Alt+${key}`;
  if (c.shift) key = `Shift+${key}`;
  if (c.ctrl) key = `Ctrl+${key}`;
  return key;
}

/** Grid slot (1..15) for an event, or 0. */
export function gridSlot(e: KeyboardEvent): number {
  for (let i = 1; i <= 15; i++) if (matches(e, `grid${i}` as HotkeyAction)) return i;
  return 0;
}
