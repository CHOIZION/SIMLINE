const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const K=require('../core.js'),F=require('../families.js');
let pw;try{pw=require('playwright-core');}catch{pw=require(path.resolve(path.dirname(process.execPath),'../node_modules/playwright-core'));}
const root=path.resolve(__dirname,'..'),exe=path.join(root,'dist/SIMLINE-2.1-win32-x64/SIMLINE.exe');
const data=path.join(root,'.test-data/unified-'+Date.now()),output=path.join(root,'test-results/unified');
fs.mkdirSync(output,{recursive:true});
async function launch(){const app=await pw._electron.launch({executablePath:exe,args:[],env:{...process.env,INYEON_DATA:data}});return [app,await app.firstWindow()];}
async function stop(app){await app.evaluate(({app})=>app.exit(0));if(app.process().exitCode===null)await new Promise(r=>app.process().once('exit',r));}
(async()=>{
 let [app,page]=await launch();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
   await page.waitForFunction(()=>document.querySelectorAll('.node').length===10&&document.querySelectorAll('[data-junction]').length===7);
   assert.equal(await page.locator('.node[data-person="P1"]').count(),1);
   await page.screenshot({path:path.join(output,'일곱-가족.png')});
   await page.locator('[data-mode="family"]').click();assert.equal(await page.locator('.node[data-person="P1"]').count(),7);
   await page.locator('[data-mode="unified"]').click();assert.equal(await page.locator('.node[data-person="P1"]').count(),1);
   const p=F.fixture(K);p.name='세 인물의 통합 가계도';p.description='P1과 P2의 자녀 P3 · P1과 P3의 배우자 관계';p.people=p.people.slice(0,3);p.families=p.families.slice(0,2);p.families[1].births=[];p.relations=p.families.flatMap(F.facts);p.mode='unified';K.validate(p);
   const backup=path.join(output,'세-인물.simline');fs.writeFileSync(backup,JSON.stringify({format:'inyeon',version:2,project:p,assets:{}}));
   await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},backup);
   await page.locator('[data-action="projects"]').first().click();await page.locator('#modal [data-action="import-project"]').click();
   await page.waitForFunction(()=>document.querySelectorAll('.node').length===3&&document.querySelector('#modal').open===false);
   await page.locator('[data-action="fit"]').first().click();
   await page.waitForFunction(()=>!document.querySelector('#toast').classList.contains('show'));
   await page.screenshot({path:path.join(output,'세-인물-실행화면.png')});
   await page.locator('#canvas-wrap').screenshot({path:path.join(output,'통합-가계도.png')});
   async function clickWire(kind,family){
     const xy=await page.locator(`[data-link-kind="${kind}"][data-link-family="${family}"] [data-routed]`).first().evaluate(path=>{
       const p=path.getPointAtLength(path.getTotalLength()*.42).matrixTransform(path.getScreenCTM());return {x:p.x,y:p.y};
     });
     await page.mouse.click(xy.x,xy.y);
     assert(await page.locator('#path-panel').isVisible());
   }
   await clickWire('spouse','F2');assert((await page.locator('#path-panel').innerText()).includes('배우자'));
   await page.locator('[data-action="close-proof"]').click();await clickWire('parent','F1');assert((await page.locator('#path-panel').innerText()).includes('자녀'));
   await page.locator('[data-action="close-proof"]').click();
   const rect=await page.locator('.node[data-person="P3"]').boundingBox();
   await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+32,rect.y+rect.height/2+12,{steps:4});await page.mouse.up();
   await page.waitForFunction(()=>project.views.unified.positions.P3.pinned&&document.querySelector('#save-status').textContent==='● 저장됨');
   const expected=await page.evaluate(()=>JSON.stringify(project.views.unified));
   await stop(app);[app,page]=await launch();await page.waitForFunction(()=>document.querySelectorAll('.node').length===3);
   assert.equal(await page.evaluate(()=>JSON.stringify(project.views.unified)),expected);
   assert.deepEqual(errors,[]);console.log('PASS: 10 unique people, 7 unions, legacy view toggle, sketch topology, both wire selections, persisted drag and mode');
 }finally{await stop(app);}
})().catch(e=>{console.error(e);process.exit(1);});
