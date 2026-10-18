// Interactive technology tree (Age of Mythology style): one row per building,
// one column per age. Every unit, technology, age-up and minor-god choice your
// civilization can reach, with live status:
//   done (researched / picked) · ready (click to do it now) · costly (can't
//   afford yet) · locked (age, prerequisite or missing building) · other path
//   (the minor god you didn't pick).
// Clicking a ready card researches/trains it at your first suitable building,
// or advances the age worshipping that minor god. Prerequisite chains are drawn
// as arrows.

import type { BuildingType, CostKey, MinorGodId, TechDef, UnitType } from '@age/shared';
import {
  AGE_COSTS, BUILDING_DEFS, buildingsToAdvance, countsForAgeUp, MAJOR_GODS, MAX_AGE, MINOR_GODS,
  minorGodOptions, POWERS, TECH_DEFS, techCostFor, UNIT_AGE_REQ,
} from '@age/shared';
import { AGE_NAMES, BUILDING_ICONS, BUILDING_NAMES, costText, t, techName, UNIT_ICONS, UNIT_NAMES } from '../i18n';
import type { GameState } from '../state';
import { el } from '../ui';
import { aomIcon } from './aomAssets';

export interface TechTreeDeps {
  onResearch: (buildingId: number, techId: string) => void;
  onTrain: (buildingId: number, unit: UnitType) => void;
  onAdvanceAge: (minorGod?: string) => void;
}

type Status = 'done' | 'progress' | 'ready' | 'costly' | 'locked' | 'other';

interface Card {
  key: string;            // stable id for arrows
  age: number;
  icon: string;
  iconUrl?: string;
  label: string;
  sub: string;            // cost / note
  tip: string;
  status: Status;
  prereq?: string;        // key of the card this one depends on
  act?: () => void;
}

const ROW_ORDER: BuildingType[] = [
  'town_center', 'temple', 'barracks', 'archery_range', 'stable', 'blacksmith', 'market',
  'mill', 'lumber_camp', 'mining_camp', 'dock', 'watch_tower', 'house', 'farm', 'wall',
];

export class TechTreeOverlay {
  readonly el = el('div', 'tt-overlay hidden');
  private body = el('div', 'tt-body');
  private svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private timer = 0;
  private sig = '';

  constructor(private gs: GameState, private deps: TechTreeDeps) {
    const panel = el('div', 'panel tt-panel');
    const head = el('div', 'tt-head');
    const title = el('h2', 'tt-title', t('tt.title'));
    head.appendChild(title);
    const legend = el('div', 'tt-legend');
    for (const s of ['done', 'progress', 'ready', 'costly', 'locked', 'other'] as Status[]) {
      const chip = el('span', `tt-chip ${s}`, t(`tt.s_${s}`));
      legend.appendChild(chip);
    }
    head.appendChild(legend);
    const close = el('button', 'btn tt-close', '✕');
    close.title = t('tt.close');
    close.addEventListener('click', () => this.hide());
    head.appendChild(close);
    panel.appendChild(head);
    const scroll = el('div', 'tt-scroll');
    this.svg.classList.add('tt-arrows');
    scroll.appendChild(this.svg);
    scroll.appendChild(this.body);
    panel.appendChild(scroll);
    this.el.appendChild(panel);
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.hide(); });
  }

  get isOpen(): boolean { return !this.el.classList.contains('hidden'); }

  toggle(): void { this.isOpen ? this.hide() : this.show(); }

  show(): void {
    this.el.classList.remove('hidden');
    this.sig = '';
    this.refresh();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.refresh(), 400);
  }

  /** Returns true if it was open. */
  hide(): boolean {
    const was = this.isOpen;
    this.el.classList.add('hidden');
    window.clearInterval(this.timer);
    return was;
  }

  private refresh(): void {
    const rows = this.build();
    const sig = JSON.stringify(rows.map(([b, cs]) => [b, cs.map((c) => `${c.key}:${c.status}:${c.sub}`)]));
    if (sig === this.sig) return;
    this.sig = sig;
    this.render(rows);
  }

  // ------------------------------------------------------------ model

  private build(): [BuildingType, Card[]][] {
    const gs = this.gs;
    const me = gs.me();
    const myAge = me?.age ?? 1;
    const civ = gs.civOf(gs.you);
    const god = gs.godOf(gs.you);
    const techs = new Set(me?.techs ?? []);
    const minors = (me?.minorGods ?? []) as MinorGodId[];
    const done = new Set<BuildingType>();
    for (const b of gs.buildings.values()) if (b.owner === gs.you && b.progress >= 1) done.add(b.type);
    const afford = (cost: Partial<Record<CostKey, number>>): boolean =>
      Object.entries(cost).every(([k, v]) => (me?.resources?.[k as CostKey] ?? 0) >= (v ?? 0));
    const firstOwn = (type: BuildingType, idle: (id: number) => boolean): number | undefined => {
      for (const b of gs.buildings.values()) if (b.owner === gs.you && b.type === type && b.progress >= 1 && idle(b.id)) return b.id;
      return undefined;
    };

    const rows: [BuildingType, Card[]][] = [];
    for (const btype of ROW_ORDER) {
      const def = BUILDING_DEFS[btype];
      if (!def) continue;
      if (btype === 'temple' && !civ) continue;
      const cards: Card[] = [];
      // the building itself
      const reqOk = !def.requires || done.has(def.requires);
      cards.push({
        key: `b:${btype}`, age: def.ageReq, icon: BUILDING_ICONS[btype], iconUrl: aomIcon('building', btype),
        label: BUILDING_NAMES[btype], sub: costText(def.cost),
        tip: `${BUILDING_NAMES[btype]} — ${costText(def.cost)}${def.requires ? ` · ${t('tt.requires', { what: BUILDING_NAMES[def.requires] })}` : ''}`,
        status: done.has(btype) ? 'done' : myAge < def.ageReq || !reqOk ? 'locked' : afford(def.cost) ? 'ready' : 'costly',
        prereq: def.requires ? `b:${def.requires}` : undefined,
      });
      // units it trains
      const trains = btype === 'temple' ? this.templeUnits() : def.trains.map((u) => ({ unit: u, via: undefined as MinorGodId | undefined }));
      for (const { unit, via } of trains) {
        const st = gs.statsFor(unit, gs.you);
        const age = Math.max(def.ageReq, UNIT_AGE_REQ[unit] ?? 1, via ? MINOR_GODS[via].age : 0);
        const unlocked = !via || minors.includes(via);
        const otherPath = !!via && !unlocked && minors.some((m) => MINOR_GODS[m].age === MINOR_GODS[via].age);
        const bid = firstOwn(btype, () => true);
        const status: Status = otherPath ? 'other' : !unlocked || myAge < age || bid === undefined ? 'locked' : afford(st.cost) ? 'ready' : 'costly';
        const name = civ ? st.name : UNIT_NAMES[unit];
        cards.push({
          key: `u:${unit}`, age, icon: st.icon ?? UNIT_ICONS[unit], iconUrl: aomIcon('unit', unit, civ),
          label: name, sub: costText(st.cost),
          tip: `${name} — ${costText(st.cost)} · ${st.trainTime}s${via ? ` · ${t('tt.via_god', { god: MINOR_GODS[via].name })}` : ''}`,
          status,
          act: status === 'ready' && bid !== undefined ? () => this.deps.onTrain(bid, unit) : undefined,
        });
      }
      // technologies researched here
      for (const tech of TECH_DEFS.filter((x) => x.building === btype)) {
        cards.push(this.techCard(tech, myAge, techs, god, afford, firstOwn(btype, (id) => !gs.buildings.get(id)?.research)));
      }
      // age-ups + minor god choices live on the Town Center row
      if (btype === 'town_center') cards.push(...this.ageCards(myAge, civ, minors, afford, done));
      rows.push([btype, cards]);
    }
    return rows;
  }

  private techCard(
    tech: TechDef, myAge: number, techs: Set<string>, god: ReturnType<GameState['godOf']>,
    afford: (c: Partial<Record<CostKey, number>>) => boolean, bid: number | undefined,
  ): Card {
    const cost = techCostFor(tech, god);
    const isDone = techs.has(tech.id);
    const prereqOk = !tech.prereq || techs.has(tech.prereq);
    let running: number | undefined;
    for (const b of this.gs.buildings.values()) {
      if (b.owner === this.gs.you && b.research?.id === tech.id) running = b.research.progress;
    }
    const status: Status = isDone ? 'done' : running !== undefined ? 'progress'
      : myAge < tech.ageReq || !prereqOk || bid === undefined ? 'locked' : afford(cost) ? 'ready' : 'costly';
    return {
      key: `t:${tech.id}`, age: tech.ageReq, icon: tech.icon, iconUrl: aomIcon('tech', tech.id),
      label: techName(tech.id), sub: running !== undefined ? `${Math.round(running * 100)}%` : costText(cost),
      tip: `${techName(tech.id)} — ${costText(cost)} · ${tech.time}s${tech.prereq ? ` · ${t('tt.requires', { what: techName(tech.prereq) })}` : ''}`,
      status, prereq: tech.prereq ? `t:${tech.prereq}` : undefined,
      act: status === 'ready' && bid !== undefined ? () => this.deps.onResearch(bid, tech.id) : undefined,
    };
  }

  /** Hero + every myth unit of my civ (each tagged with the god granting it). */
  private templeUnits(): { unit: UnitType; via?: MinorGodId }[] {
    const civ = this.gs.civOf(this.gs.you);
    if (!civ) return [];
    const out: { unit: UnitType; via?: MinorGodId }[] = [{ unit: 'hero' }];
    for (const g of Object.values(MINOR_GODS)) if (g.civ === civ) out.push({ unit: g.myth, via: g.id });
    return out;
  }

  private ageCards(
    myAge: number, civ: ReturnType<GameState['civOf']>, minors: MinorGodId[],
    afford: (c: Partial<Record<CostKey, number>>) => boolean, done: Set<BuildingType>,
  ): Card[] {
    const me = this.gs.me();
    const cards: Card[] = [];
    for (let age = 2; age <= MAX_AGE; age++) {
      const cost = AGE_COSTS[age] ?? {};
      const need = buildingsToAdvance(age - 1);
      const have = new Set([...done].filter((b) => countsForAgeUp(b, age - 1))).size;
      const researching = me?.ageProgress !== undefined;
      const canNow = myAge === age - 1 && !researching && have >= need;
      const opts = civ ? minorGodOptions(civ, age) : [];
      if (!opts.length) {
        cards.push({
          key: `a:${age}`, age, icon: '🏛', label: AGE_NAMES[age], sub: costText(cost), tip: AGE_NAMES[age],
          status: myAge >= age ? 'done' : canNow ? (afford(cost) ? 'ready' : 'costly') : 'locked',
          act: canNow && afford(cost) ? () => this.deps.onAdvanceAge() : undefined,
        });
        continue;
      }
      for (const g of opts) {
        const picked = minors.includes(g.id) || me?.ageGod === g.id;
        const otherPicked = !picked && (minors.some((m) => MINOR_GODS[m].age === age) || (me?.ageGod && MINOR_GODS[me.ageGod as MinorGodId]?.age === age));
        const status: Status = picked ? 'done' : otherPicked ? 'other' : canNow ? (afford(cost) ? 'ready' : 'costly') : 'locked';
        cards.push({
          key: `g:${g.id}`, age, icon: g.icon, label: `${g.name}`, sub: `${AGE_NAMES[age]} · ${costText(cost)}`,
          tip: `${t('myth.choose_god', { age: AGE_NAMES[age], god: g.name })} — ${UNIT_NAMES[g.myth]} + ${POWERS[g.power].icon} ${POWERS[g.power].name}`,
          status,
          act: status === 'ready' ? () => this.deps.onAdvanceAge(g.id) : undefined,
        });
      }
    }
    return cards;
  }

  // ------------------------------------------------------------ view

  private render(rows: [BuildingType, Card[]][]): void {
    this.body.innerHTML = '';
    const civ = this.gs.civOf(this.gs.you);
    const god = this.gs.godOf(this.gs.you);
    const grid = el('div', 'tt-grid');
    grid.appendChild(el('div', 'tt-corner', god ? `${MAJOR_GODS[god].icon} ${MAJOR_GODS[god].name}${civ ? ` · ${t(`myth.civ_${civ}`)}` : ''}` : ''));
    const myAge = this.gs.me()?.age ?? 1;
    for (let a = 1; a <= MAX_AGE; a++) {
      const h = el('div', `tt-agehead${a === myAge ? ' current' : ''}`, `${['', 'I', 'II', 'III', 'IV'][a]} · ${AGE_NAMES[a]}`);
      grid.appendChild(h);
    }
    const cardEls = new Map<string, HTMLElement>();
    for (const [btype, cards] of rows) {
      grid.appendChild(el('div', 'tt-rowhead', `${BUILDING_ICONS[btype]} ${BUILDING_NAMES[btype]}`));
      for (let a = 1; a <= MAX_AGE; a++) {
        const cell = el('div', 'tt-cell');
        for (const c of cards.filter((x) => x.age === a)) {
          const node = el(c.act ? 'button' : 'div', `tt-card ${c.status}`);
          if (c.iconUrl) {
            const img = el('img', 'tt-ico-img');
            img.src = c.iconUrl;
            img.alt = '';
            node.appendChild(img);
          } else {
            node.appendChild(el('span', 'tt-ico', c.icon));
          }
          const txt = el('span', 'tt-txt');
          txt.appendChild(el('span', 'tt-name', c.label));
          if (c.sub) txt.appendChild(el('span', 'tt-sub', c.sub));
          node.appendChild(txt);
          node.title = c.tip + (c.act ? `\n${t('tt.click')}` : '');
          if (c.act) node.addEventListener('click', () => { c.act!(); this.sig = ''; });
          cell.appendChild(node);
          cardEls.set(c.key, node);
        }
        grid.appendChild(cell);
      }
    }
    this.body.appendChild(grid);
    // prerequisite arrows (after layout)
    requestAnimationFrame(() => this.drawArrows(rows, cardEls));
  }

  private drawArrows(rows: [BuildingType, Card[]][], cardEls: Map<string, HTMLElement>): void {
    const host = this.body.getBoundingClientRect();
    this.svg.setAttribute('width', String(this.body.scrollWidth));
    this.svg.setAttribute('height', String(this.body.scrollHeight));
    this.svg.innerHTML = '<defs><marker id="tt-ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#d8b25a"/></marker></defs>';
    for (const [, cards] of rows) {
      for (const c of cards) {
        if (!c.prereq) continue;
        const from = cardEls.get(c.prereq);
        const to = cardEls.get(c.key);
        if (!from || !to) continue;
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const x1 = a.right - host.left;
        const y1 = a.top + a.height / 2 - host.top;
        const x2 = b.left - host.left;
        const y2 = b.top + b.height / 2 - host.top;
        if (x2 <= x1 + 4) continue; // same column: the order already shows it
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const mx = (x1 + x2) / 2;
        path.setAttribute('d', `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2 - 2} ${y2}`);
        path.setAttribute('class', 'tt-arrow');
        path.setAttribute('marker-end', 'url(#tt-ah)');
        this.svg.appendChild(path);
      }
    }
  }
}
