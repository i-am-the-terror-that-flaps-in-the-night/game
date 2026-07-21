import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join } from 'path';
const ROOT = '/Users/sachingupta/Developer/game';
const MIME = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css'};
const srv = createServer((req,res)=>{
  let p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/')) p += 'index.html';
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':MIME[extname(p)]||'text/plain'});
  res.end(readFileSync(p));
});
await new Promise(r=>srv.listen(8123,r));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e))); page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await page.goto('http://localhost:8123/index.html');
await page.waitForFunction(()=>typeof game!=='undefined' && game.state);
const out = await page.evaluate(async ()=>{
  // start a level
  game.startCampaign ? game.startCampaign(0) : (game.startLevel && game.startLevel(0));
  await new Promise(r=>setTimeout(r,200));
  const R={};
  // --- spell armor test: spawn a heavy-armor shieldman, meteor it, check magic counter applied ---
  game.spells.mana = 999; game.spells.cd = {};
  const before = game.enemies.length;
  game.spawnEnemy ? game.spawnEnemy('shieldman', 900) : game.waves.spawnOne?.('shieldman',900);
  await new Promise(r=>setTimeout(r,60));
  const sh = game.enemies.find(e=>e.type==='shieldman');
  R.spawnedShieldman = !!sh;
  if (sh) {
    const hp0 = sh.hp;
    // meteor directly on it
    game.spells.active='meteor';
    game.spells.cast({clientX: game.camera.toScreen ? game.camera.toScreen(sh.x, sh.y).x : 640, clientY:300});
    await new Promise(r=>setTimeout(r,1200)); // meteor has a 48-frame delay
    R.shieldmanHpDrop = +(hp0 - sh.hp).toFixed(1);
    R.shieldmanArmor = sh.armor; R.shieldmanClass = sh.armorClass;
  }
  // --- chain-gun test: buy a gravel gun, confirm it exists & has new stats ---
  game.gold = 99999; game.iron=9999; game.crystal=9999;
  const boughtCat = game.buyUnit('catapult');
  const cat = game.units.find(u=>u.type==='catapult');
  R.gravelGun = cat ? {name:cat.name, cd:cat.cd, range:cat.range, speed:cat.speed, dmg:cat.dmg} : null;
  return R;
});
console.log(JSON.stringify(out,null,2));
console.log('PAGE ERRORS:', errs.length ? errs : 'none');
await browser.close(); srv.close();
