import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';
const ROOT=process.cwd();
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=createServer(async(req,res)=>{try{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';const buf=await readFile(join(ROOT,p));res.writeHead(200,{'content-type':MIME[extname(p)]||'application/octet-stream'});res.end(buf);}catch{res.writeHead(404);res.end('nf');}});
await new Promise(r=>server.listen(8170,r));
const NET=/Failed to load resource|favicon|fonts\.googleapis/i;
const errs=[];const b=await chromium.launch({executablePath:process.env.PW_CHROMIUM,args:['--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const pg=await b.newPage(); await pg.setViewportSize({width:1200,height:760});
pg.on('console',m=>{if(m.type()==='error'&&!NET.test(m.text()))errs.push('C:'+m.text());});
pg.on('pageerror',e=>{if(!NET.test(e.message))errs.push('P:'+e.message);});
const P=(js,to=9000)=>pg.waitForFunction(js,{timeout:to});
let pass=0,fail=0;const ok=(c,m)=>{if(c){pass++;console.log('  ✓ '+m);}else{fail++;console.log('  ✗ '+m);}};
try{
  await pg.goto('http://localhost:8170/index.html',{waitUntil:'load'});
  await P(`window.game && game.state==='menu'`);

  console.log('[unlimited upgrades: buy past level 5]');
  await pg.evaluate(()=>{game.meta.renown=1e9; game.meta.treasury=1e9; game.meta.heroUpgrades={}; game.meta.castleUpgrades={}; game.meta.save();});
  // Buy hero power 10x and castle might 10x (past the old 5 cap)
  await pg.evaluate(()=>{for(let i=0;i<10;i++){game.meta.buyHeroUpgrade('power','renown'); game.meta.buyCastleUpgrade('might','renown');}});
  const lv=await pg.evaluate(()=>({hp:game.meta.heroUpgradeLevel('power'),cm:game.meta.castleUpgradeLevel('might')}));
  ok(lv.hp===10&&lv.cm===10,'bought 10 levels each (no cap): hero power '+lv.hp+', castle might '+lv.cm);
  // cost climbs
  const costs=await pg.evaluate(()=>{const {upgradeCost,HERO_UPGRADES}=window.__meta; return [0,5,10].map(l=>upgradeCost(HERO_UPGRADES.power.goldBase,l));}).catch(()=>null);
  // expose meta module for cost check
  await pg.evaluate(async()=>{window.__meta=await import('/js/systems/meta.js');});
  const c=await pg.evaluate(()=>{const {upgradeCost,HERO_UPGRADES}=window.__meta; const b=HERO_UPGRADES.power.goldBase; return {l0:upgradeCost(b,0),l5:upgradeCost(b,5),l10:upgradeCost(b,10)};});
  ok(c.l10>c.l5&&c.l5>c.l0,'cost climbs geometrically (L0='+c.l0+' L5='+c.l5+' L10='+c.l10+')');

  console.log('[render: no RangeError at high levels]');
  await pg.evaluate(()=>{game.meta.heroUpgrades.power=20; game.meta.castleUpgrades.might=15;});
  await pg.evaluate(()=>{game.openWarCouncil();});
  const grids=await pg.evaluate(()=>({hero:!!document.getElementById('heroUpgradeGrid').querySelector('.upg-track'), castle:!!document.getElementById('castleUpgradeGrid').querySelector('.upg-track')}));
  ok(grids.hero&&grids.castle,'hero + castle upgrade grids render at Lv20+ (no RangeError crash)');
  await pg.evaluate(()=>document.getElementById('warCouncilOverlay').classList.add('hidden'));

  console.log('[castle upgrades apply at spawn]');
  await pg.evaluate(()=>{game.meta.castleUpgrades={might:5,bastion:3,rapid:2,reach:4}; game.meta.save();});
  await pg.evaluate(()=>game.startCampaignWithDiff(1.0));
  await P(`game.state==='playing'`);
  const castle=await pg.evaluate(()=>{const c=game.buildings.find(b=>b.type==='castle'); return {dmg:c.dmg, cooldown:c.cooldown, range:c.range, maxHp:c.maxHp};});
  // base dmg 8*(1+0*.6)=8, +might 14*5=70 -> 78 ; cooldown 7 - rapid 1*2 = 5 ; range 160 + reach 30*4=120 -> 280 ; hp 2000 + bastion 400*3=1200 -> 3200
  ok(castle.dmg===78,'castle Might applied: dmg -> '+castle.dmg+' (expected 78)');
  ok(castle.cooldown===5,'castle Rapid Fire applied: cooldown -> '+castle.cooldown+' (expected 5)');
  ok(castle.range===280,'castle Reach applied: range -> '+castle.range+' (expected 280)');
  ok(castle.maxHp===3200,'castle Bastion applied: maxHp -> '+castle.maxHp+' (expected 3200)');

  console.log('[castle machine-gun BEAM: rapid fire + raycast damage + no crash]');
  await pg.evaluate(()=>{game.setSpeed(2); for(let i=0;i<5;i++)game.spawnEnemy('rabble', game.buildings.find(b=>b.type==='castle').x+120+i*15, game.hero.y);});
  await P(`game.enemies.length>=3 && game.enemies.every(e=>Number.isFinite(e.x))`);
  const hpB=await pg.evaluate(()=>game.enemies.reduce((a,e)=>a+e.hp,0));
  // watch beamT toggle (proof it fires as a beam) + damage accrues
  const beamFired=await pg.evaluate(async()=>{let saw=false;const c=game.buildings.find(b=>b.type==='castle');for(let i=0;i<200;i++){if(c.beamT>0)saw=true;await new Promise(r=>requestAnimationFrame(r));}return saw;});
  ok(beamFired,'castle beam fires (beamT>0 observed)');
  const hpA=await pg.evaluate(()=>game.enemies.filter(e=>e.active).reduce((a,e)=>a+e.hp,0));
  ok(hpA<hpB,'beam raycast damaged enemies (hp '+Math.round(hpB)+'->'+Math.round(hpA)+')');
  const parts=await pg.evaluate(()=>game.particles.p.length);
  ok(parts>0,'cosmetic smoke/fire particles spawned ('+parts+' alive)');

  console.log('[smooth scroll: camera pans WHILE PAUSED]');
  await pg.evaluate(()=>{game.setSpeed(0);}); // pause
  const camBefore=await pg.evaluate(()=>game.camera.x);
  // simulate held-right key
  await pg.evaluate(()=>{game.keysDown.right=true;});
  await new Promise(r=>setTimeout(r,600));
  const camAfter=await pg.evaluate(()=>{game.keysDown.right=false; return game.camera.x;});
  ok(camAfter>camBefore,'camera scrolls while PAUSED (x '+Math.round(camBefore)+'->'+Math.round(camAfter)+')');

  console.log('[gradient cache correctness: units still render]');
  await pg.evaluate(()=>{game.setSpeed(1); game.gold=99999; game.maxPop=200; for(let i=0;i<10;i++)game.buyUnit('militia');});
  await new Promise(r=>setTimeout(r,300));
  ok(await pg.evaluate(()=>game.units.filter(u=>u.type==='militia').length>=5),'units spawn + render with cached gradients (no crash)');

  console.log('[hero upgrades still work]');
  await pg.evaluate(()=>{game.meta.heroUpgrades={power:2,vitality:1}; game.returnToMenu();});
  await P(`game.state==='menu'`);
  await pg.evaluate(()=>game.startEndless()); await P(`game.state==='playing'`);
  ok(await pg.evaluate(()=>game.hero.dmg===34+12&&game.hero.maxHp===520+80),'hero upgrades still apply (dmg '+await pg.evaluate(()=>game.hero.dmg)+')');
}catch(e){console.log('EXCEPTION: '+e.message);fail++;}
console.log('\n[errors]'); ok(errs.length===0,'no console/page errors'+(errs.length?': '+errs.slice(0,3).join(' | '):''));
console.log(`\n${fail?'FAIL':'PASS'} — ${pass} passed, ${fail} failed`);
await b.close();server.close();process.exit(fail?1:0);
