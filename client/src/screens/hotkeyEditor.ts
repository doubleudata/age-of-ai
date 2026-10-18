// Hotkey editor (opened from Options): pick a preset, then click any binding
// and press the new key. Backspace clears a slot, Esc cancels. A chord bound
// elsewhere moves here (setBinding removes it from the other action).

import { el } from '../ui';
import { t } from '../i18n';
import {
  applyPreset, chordLabel, chordOf, currentPreset, HOTKEY_ACTIONS, hotkeys, onHotkeysChanged, setBinding,
  type HotkeyAction, type PresetId,
} from '../hotkeys';

let capturing = false;
/** True while the editor waits for a key — the game must not react to it. */
export function isCapturingHotkey(): boolean {
  return capturing;
}

const GROUPS: { title: string; actions: HotkeyAction[] }[] = [
  { title: 'hk.g_camera', actions: ['panUp', 'panDown', 'panLeft', 'panRight', 'home'] },
  { title: 'hk.g_commands', actions: ['idleVillager', 'stop', 'delete', 'unload', 'cancel'] },
  { title: 'hk.g_interface', actions: ['techTree', 'chat', 'pause', 'mute', 'music'] },
  { title: 'hk.g_powers', actions: ['power1', 'power2', 'power3', 'power4'] },
  { title: 'hk.g_grid', actions: HOTKEY_ACTIONS.filter((a) => a.startsWith('grid')) },
];

export class HotkeyEditor {
  readonly el = el('div', 'overlay hk-overlay hidden');
  private list = el('div', 'hk-list');
  private presetBtns: { id: PresetId; btn: HTMLButtonElement }[] = [];
  private pending: { action: HotkeyAction; slot: 0 | 1; btn: HTMLButtonElement } | null = null;

  constructor() {
    const card = el('div', 'panel card hk-card');
    card.appendChild(el('h2', '', t('hk.title')));
    const presets = el('div', 'hk-presets');
    for (const id of ['classic', 'aom'] as PresetId[]) {
      const b = el('button', 'btn scale-btn', t(`hk.preset_${id}`));
      b.title = t(`hk.preset_${id}_desc`);
      b.addEventListener('click', () => applyPreset(id));
      this.presetBtns.push({ id, btn: b });
      presets.appendChild(b);
    }
    card.appendChild(presets);
    card.appendChild(el('p', 'opt-hint', t('hk.help')));
    card.appendChild(this.list);
    card.appendChild(el('p', 'opt-hint', t('hk.groups_note')));
    const close = el('button', 'btn primary', t('opt.close'));
    close.addEventListener('click', () => this.hide());
    card.appendChild(close);
    this.el.appendChild(card);
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.hide(); });
    window.addEventListener('keydown', this.onKey, true);
    onHotkeysChanged(() => this.render());
    this.render();
  }

  show(): void { this.el.classList.remove('hidden'); this.render(); }
  hide(): void { this.cancel(); this.el.classList.add('hidden'); }

  private cancel(): void {
    this.pending = null;
    capturing = false;
    this.render();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.pending) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { this.cancel(); return; }
    const { action, slot } = this.pending;
    if (e.code === 'Backspace') {
      this.pending = null; capturing = false;
      setBinding(action, slot, null);
      return;
    }
    const chord = chordOf(e);
    if (!chord) return; // a lone modifier — keep waiting
    this.pending = null; capturing = false;
    setBinding(action, slot, chord);
  };

  private render(): void {
    for (const { id, btn } of this.presetBtns) btn.classList.toggle('active', id === currentPreset());
    this.list.innerHTML = '';
    const b = hotkeys();
    for (const g of GROUPS) {
      this.list.appendChild(el('div', 'hk-group', t(g.title)));
      for (const a of g.actions) {
        const row = el('div', 'hk-row');
        row.appendChild(el('span', 'hk-name', a.startsWith('grid') ? t('hk.grid', { n: a.slice(4) }) : t(`hk.${a}`)));
        for (const slot of [0, 1] as const) {
          const waiting = this.pending?.action === a && this.pending.slot === slot;
          const btn = el('button', `btn hk-key${waiting ? ' waiting' : ''}`, waiting ? t('hk.press') : chordLabel(b[a][slot]));
          btn.addEventListener('click', () => {
            this.pending = { action: a, slot, btn };
            capturing = true;
            this.render();
          });
          row.appendChild(btn);
        }
        this.list.appendChild(row);
      }
    }
  }
}
