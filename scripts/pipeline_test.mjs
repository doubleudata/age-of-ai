// End-to-end asset pipeline test on a SYNTHETIC "extracted game" folder
// (original fixtures only): proto + techtree XML, an icon PNG and an animated
// GLB laid out like a CryBar export. Needs Chromium (playwright-core); set
// AOM_CHROMIUM=/path/to/chrome if it isn't installed via `npx playwright install`.
// Roda: node scripts/pipeline_test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeModelFixture } from '../tools/aom-pipeline/fixtures/make-model-fixture.mjs';
import { ingest } from '../tools/aom-pipeline/ingest.mjs';
import { decodeTga } from '../tools/aom-pipeline/lib/tga.mjs';

let pass = 0;
let fail = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); ok ? pass++ : fail++; };

const base = path.join(process.env.PIPELINE_TMP ?? tmpdir(), `aom-pipeline-test-${process.pid}`);
const ex = path.join(base, 'extract');
const out = path.join(base, 'pack');
rmSync(base, { recursive: true, force: true });
for (const d of ['game/data/gameplay', 'game/art/greek/units/infantry', 'game/art/ui/icons/units']) mkdirSync(path.join(ex, d), { recursive: true });

writeFileSync(path.join(ex, 'game/data/gameplay/proto.xml'), `<proto>
  <unit id="1" name="Hoplite"><maxhitpoints>120</maxhitpoints><icon>art\\ui\\icons\\units\\hoplite_icon</icon><unittype>Infantry</unittype></unit>
  <unit id="2" name="VillagerGreek"><maxhitpoints>75</maxhitpoints><icon>art\\ui\\icons\\units\\villager_greek_icon</icon></unit>
  <unit id="3" name="Minotaur"><maxhitpoints>400</maxhitpoints><icon>art\\ui\\icons\\units\\minotaur_icon</icon></unit>
</proto>`);
writeFileSync(path.join(ex, 'game/data/gameplay/techtree.xml'), `<techtree>
  <tech name="ClassicalAgeAthena" type="Normal"><cost resourcetype="Food">400</cost><researchpoints>60</researchpoints><prereqs><specificage>ArchaicAge</specificage></prereqs><effects><effect/></effects></tech>
  <tech name="CopperWeapons" type="Normal"><cost resourcetype="Food">100</cost><cost resourcetype="Gold">50</cost><researchpoints>20</researchpoints><prereqs><techstatus status="active">ClassicalAgeAthena</techstatus></prereqs></tech>
</techtree>`);
// a tiny original placeholder icon (1x1 PNG)
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
writeFileSync(path.join(ex, 'game/art/ui/icons/units/hoplite_icon.png'), PNG1);
// CryBar `bar export --convert` writes DDT as TGA: Minotaur icon as a 2x2 RLE TGA
// (bottom-left origin, BGRA): bottom row red,red ; top row green,blue
const tga = (type, body) => Buffer.concat([Buffer.from([0, 0, type, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 32, 8]), Buffer.from(body)]);
const RLE = tga(10, [0x81, 0, 0, 255, 255, /* raw */ 0x01, 0, 255, 0, 255, 255, 0, 0, 255]);
writeFileSync(path.join(ex, 'game/art/ui/icons/units/minotaur_icon.tga'), RLE);
await makeModelFixture(path.join(ex, 'game/art/greek/units/infantry/hoplite.glb'));
// explicit mapping: reuse the same model for the Greek villager
writeFileSync(path.join(base, 'models.json'), JSON.stringify({ 'villager:greek': 'game/art/greek/units/infantry/hoplite.glb' }));

{
  const d = decodeTga(RLE);
  const at = (x, y) => [...d.data.subarray((y * 2 + x) * 4, (y * 2 + x) * 4 + 4)].join(',');
  check('TGA decoder: RLE + bottom-left origin flipped to top-down RGBA', at(0, 0) === '0,255,0,255' && at(1, 0) === '0,0,255,255' && at(0, 1) === '255,0,0,255');
  const raw = decodeTga(tga(2, [0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255]));
  check('TGA decoder: uncompressed', raw.data.join(',') === d.data.join(','));
}
const { manifest, report } = await ingest({ extract: ex, out, models: path.join(base, 'models.json'), data: false });
check('TGA icon converted to PNG', readFileSync(path.join(out, 'icons/minotaur.png')).subarray(1, 4).toString() === 'PNG');
check('manifest written with version 1', manifest.version === 1 && existsSync(path.join(out, 'manifest.json')));
check('unit icons matched through proto <icon> paths', manifest.icons.unit.swordsman?.greek === 'icons/swordsman_greek.png' && manifest.icons.unit.minotaur?.['*'] === 'icons/minotaur.png');
check('missing icons are reported (Greek villager has no PNG)', report.missingIcons.some((m) => m.startsWith('villager:greek')));
check('Hoplite model auto-matched by proto name and baked', manifest.sprites.swordsman?.greek === 'sprites/swordsman_greek.json');
check('models.json mapping honored (Greek villager)', manifest.sprites.villager?.greek === 'sprites/villager_greek.json');
const meta = JSON.parse(readFileSync(path.join(out, 'sprites/swordsman_greek.json'), 'utf8'));
check('sheet has idle/walk/attack/death in 8 directions', meta.dirs === 8 && ['idle', 'walk', 'attack', 'death'].every((a) => meta.anims[a]?.frames > 0));
check('player-color mask produced', !!meta.mask && existsSync(path.join(out, 'sprites', meta.mask)));
check('bake reported no warnings', report.sprites.every((s) => s.warnings.length === 0));
check('units without models are listed', report.missingModels.includes('hydra') && report.missingModels.includes('archer:norse'));
const tt = JSON.parse(readFileSync(path.join(out, 'techtree.json'), 'utf8'));
check('original tech tree exported as reference (2 techs, cost/time/prereq)', tt.techs.length === 2 && tt.techs[1].cost.gold === 50 && tt.techs[1].prereqs[0] === 'ClassicalAgeAthena' && tt.techs[0].age === 'ArchaicAge');

// optional: install the synthetic pack into the dev client for a visual check
if (process.env.INSTALL_PACK) {
  const dest = path.resolve('client/public/aom');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.join(dest, 'sprites'), { recursive: true });
  mkdirSync(path.join(dest, 'icons'), { recursive: true });
  for (const f of ['manifest.json', 'techtree.json']) copyFileSync(path.join(out, f), path.join(dest, f));
  for (const f of ['swordsman_greek.json', 'swordsman_greek.png', 'swordsman_greek_mask.png', 'villager_greek.json', 'villager_greek.png', 'villager_greek_mask.png']) copyFileSync(path.join(out, 'sprites', f), path.join(dest, 'sprites', f));
  for (const f of ['swordsman_greek.png', 'minotaur.png']) copyFileSync(path.join(out, 'icons', f), path.join(dest, 'icons', f));
  console.log(`installed synthetic pack into ${dest}`);
}
rmSync(base, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
