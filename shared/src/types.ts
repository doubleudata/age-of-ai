// Tipos de dados compartilhados entre servidor e cliente.
// Convenções:
//  - Posições de unidades são floats em unidades de tile (centro da unidade).
//  - Prédios são ancorados no tile superior-esquerdo e ocupam size x size tiles.
//  - Ids de unidades, prédios e nós de recurso vêm de um contador único
//    (um id nunca se repete entre categorias — comandos usam targetId genérico).

export type ResourceType = 'food' | 'wood' | 'gold' | 'stone';
/** Anything a cost can be paid in: the gatherable resources plus FAVOR (Age of
 *  Mythology's divine resource — earned per civilization, never gathered). */
export type CostKey = ResourceType | 'favor';
export type UnitType =
  | 'villager' | 'swordsman' | 'archer' | 'knight'
  // Navais (andam SÓ na água; treinadas no Porto):
  | 'fishing_boat' // pesca bancos de peixe e entrega no Porto
  | 'war_galley'   // barco de guerra (ataque à distância)
  | 'transport'    // leva unidades terrestres pelo rio (embarcar/desembarcar)
  // ---- Age of Mythology layer (see shared/src/mythology.ts) ----
  | 'hero'         // civ hero (Greek Hero / Egyptian Priest / Norse Hersir): x3 vs myth units
  // myth units, unlocked by the minor god picked at each age-up
  | 'minotaur' | 'centaur' | 'manticore' | 'hydra' | 'colossus' | 'chimera'          // Greek
  | 'sphinx' | 'anubite' | 'scorpion_man' | 'mummy' | 'avenger' | 'phoenix'          // Egyptian
  | 'valkyrie' | 'einherjar' | 'frost_giant' | 'mountain_giant' | 'fire_giant' | 'fenris_wolf' // Norse
  // summoned by god powers only (never trained)
  | 'shade' | 'serpent';
export type BuildingType =
  | 'town_center'
  | 'house'
  | 'barracks'
  | 'farm'
  | 'archery_range'
  | 'stable'
  | 'blacksmith'
  | 'market'
  | 'wall'
  | 'watch_tower'
  | 'mill'          // depósito de comida
  | 'lumber_camp'   // depósito de madeira
  | 'mining_camp'   // depósito de ouro e pedra
  | 'dock'          // Porto: NA água (costa); deposita peixe e treina barcos
  | 'temple';       // AoM: trains myth units + hero; Greek villagers worship here for favor
export type NodeType = 'tree' | 'berry_bush' | 'gold_mine' | 'stone_mine' | 'fish';

export type Resources = Record<CostKey, number>;

export type UnitState =
  | 'idle'
  | 'moving'
  | 'movingToGather'
  | 'gathering'
  | 'returning'      // levando recursos ao depósito
  | 'movingToBuild'
  | 'building'
  | 'movingToGarrison' // indo entrar numa torre/Centro (guarnição)
  | 'movingToAttack'
  | 'attacking';

export interface UnitSnap {
  id: number;
  owner: number; // playerId
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  state: UnitState;
  carryType?: ResourceType;
  carryAmount?: number;
  targetId?: number;
  /** Barco de transporte: quantas unidades estão embarcadas. */
  garrison?: number;
}

// progress 0..1 — apenas o primeiro item da fila avança
export interface TrainQueueItem {
  unit: UnitType;
  progress: number;
}

export interface BuildingSnap {
  id: number;
  owner: number;
  type: BuildingType;
  tileX: number; // canto superior-esquerdo
  tileY: number;
  hp: number;
  progress: number; // 0..1 de construção; 1 = concluído
  queue: TrainQueueItem[];
  rallyX?: number;
  rallyY?: number;
  foodLeft?: number; // apenas fazendas concluídas
  /** Pesquisa de tecnologia em andamento neste prédio (id + progresso 0..1). */
  research?: { id: string; progress: number };
  /** Alvo atual (torres de vigia atirando — o cliente desenha a flecha). */
  targetId?: number;
  /** Quantas unidades estão GUARNECIDAS dentro (torre/Centro) — o cliente mostra
   *  a contagem e desenha flechas extras. */
  garrison?: number;
}

export interface NodeSnap {
  id: number;
  type: NodeType;
  tileX: number;
  tileY: number;
  amount: number; // recurso restante
}

/** Ovelha (estilo AoE): comida do início de jogo, branca quando selvagem
 *  (owner = -1), tingida da cor do dono quando um jogador a converte
 *  chegando perto. Posição em coordenadas de tile (centro), como as unidades. */
export interface SheepSnap {
  id: number;
  owner: number; // -1 = selvagem (branca)
  x: number;
  y: number;
  food: number; // comida restante
}

/** A god power currently showing on the map (visual + client-side reveal). */
export interface PowerFxSnap {
  id: number;
  power: string;   // PowerId
  owner: number;
  x: number;
  y: number;
  radius: number;
  /** 0..1 of the effect's (or flash's) lifetime remaining. */
  left: number;
}

export interface PlayerSnap {
  id: number;
  /** AUSENTE pra quem está só ASSISTINDO: o espectador vê a ação, não a
   *  economia. Não é enfeite de tela — o dado não sai do servidor, então nem
   *  um cliente modificado consegue ler o ouro de quem está jogando. */
  resources?: Resources;
  pop: number;
  popCap: number;
  defeated: boolean;
  /** Era atual (1..MAX_AGE). */
  age: number;
  /** Progresso 0..1 da pesquisa da próxima era (ausente se não pesquisando,
   *  e sempre ausente pro espectador). */
  ageProgress?: number;
  /** Ids das tecnologias já pesquisadas. Ausente pro espectador. */
  techs?: string[];
  /** AoM: minor gods picked so far (age 2..4) and god powers already used. */
  minorGods?: string[];
  powersUsed?: string[];
  /** Minor god being researched with the current age-up. */
  ageGod?: string;
}

export interface PlayerInfo {
  id: number;
  name: string;
  color: string;
  team?: number; // 0/ausente = sozinho; 1..3 = time (aliados)
  /** AoM: major god (decides the civilization). */
  god?: string;
  civ?: string;
}

export interface MapData {
  size: number;
  // row-major: tiles[y * size + x]; valores TILE_GRASS | TILE_WATER (constants.ts)
  tiles: number[];
}
