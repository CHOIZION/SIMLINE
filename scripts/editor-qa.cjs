const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
let pw;try{pw=require('playwright-core');}catch{pw=require(path.resolve(path.dirname(process.execPath),'../node_modules/playwright-core'));}
const root=path.resolve(__dirname,'..'),data=path.join(root,'.test-data','source-editor-'+Date.now());
const artifacts=path.join(root,'test-results','source-editor');
fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
  const packaged=process.env.SIMLINE_EXE;
  const launch=()=>pw._electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:[root],env:{...process.env,INYEON_DATA:data}});
  let app=await launch();
  let page=await app.firstWindow();page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  try{
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1090,800));
    await page.waitForFunction(()=>document.querySelectorAll('[data-port]').length===3);
    await page.locator('.visible-fit').click();
    const people=await page.evaluate(()=>project.people.map(p=>p.id));
    const [a,b,c]=people, numbers=()=>page.evaluate(()=>[project.people.length,project.relations.length,project.families.length]);
    const point=async locator=>{const box=await locator.boundingBox();assert(box);return {x:box.x+box.width/2,y:box.y+box.height/2};};
    const port=id=>page.locator(`[data-port="${id}"] .port-face`).first();
    const card=id=>page.locator(`.node[data-person="${id}"] .card-bg`).first();
    const joint=()=>page.locator('[data-junction] circle[stroke]').last();
    async function wire(source,target,escape=false){
      const start=await point(source),end=await point(target);
      await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:10});
      await page.waitForSelector('#link-preview',{state:'attached'});
      if(escape)await page.keyboard.press('Escape');
      await page.mouse.up();
    }
    await page.screenshot({path:path.join(artifacts,'01-source-window.png')});
    await wire(port(a),card(b),true);assert.deepEqual(await numbers(),[3,0,0]);assert(!(await page.locator('#modal').isVisible()));
    await wire(port(a),card(b));assert(await page.getByRole('heading',{name:'관계 선택'}).isVisible());
    await page.screenshot({path:path.join(artifacts,'02-relationship.png')});
    await page.locator('[data-choice="spouse"]').click();await page.waitForSelector('[data-junction]');
    assert.deepEqual(await numbers(),[3,1,1]);
    await wire(joint(),card(c));assert(await page.getByRole('heading',{name:'자녀 연결'}).isVisible());
    await page.locator('[data-action="save-family-drop"]').click();assert.deepEqual(await numbers(),[3,3,1]);
    assert.deepEqual(await page.evaluate(()=>project.families[0].births[0].children),[c]);
    await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='● 저장됨');
    await page.locator('#undo').click();await page.waitForFunction(()=>project.relations.length===1);
    await page.locator('#redo').click();await page.waitForFunction(()=>project.relations.length===3);
    await page.locator('.visible-fit').click();
    await wire(port(c),card(a));await page.locator('[data-choice="friend"]').click();assert.deepEqual(await numbers(),[3,4,1]);
    await page.locator('.main-add').click();assert(!(await page.locator('#person-notes').isVisible()));
    await page.locator('#person-name').fill('새 인물 4');await page.locator('[data-action="save-another"]').click();
    assert.equal(await page.locator('#person-name').inputValue(),'');
    await page.locator('#person-name').fill('새 인물 5');await page.locator('[data-action="save-person"]').click();assert.deepEqual(await numbers(),[5,4,1]);
    await page.locator('.visible-fit').click();
    const original=await page.evaluate(()=>({...project.views.unified.positions[project.people[2].id]}));
    const mid=await point(card(c));await page.mouse.move(mid.x,mid.y);await page.mouse.down();await page.mouse.move(mid.x+22,mid.y+10,{steps:8});await page.mouse.up();
    const moved=await page.evaluate(()=>({...project.views.unified.positions[project.people[2].id]}));assert(moved.pinned);assert.notDeepEqual(moved,original);
    await port(a).click();await card(b).click();assert(await page.locator('[data-choice="spouse"]').isDisabled());await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='● 저장됨');
    if(packaged){
      assert(!(await page.locator('#qa-reload').isVisible()));
      await app.evaluate(({app})=>app.exit(0));
      if(app.process().exitCode===null)await new Promise(resolve=>app.process().once('exit',resolve));
      app=await launch();page=await app.firstWindow();
      await page.waitForFunction(()=>document.querySelectorAll('[data-port]').length===5);
    }else{
      const oldOrigin=await page.evaluate(()=>performance.timeOrigin);await page.locator('#qa-reload').click();await page.waitForFunction(t=>performance.timeOrigin!==t&&document.querySelectorAll('[data-port]').length===5,oldOrigin);
    }
    assert.deepEqual(await numbers(),[5,4,1]);assert.deepEqual(errors,[]);
    console.log((packaged?'Packaged EXE':'Source')+' QA passed: real pointer drags, cancel, directed family child, multiple relations, undo/redo, repeated creation, move, duplicate handling and reload.');
  }catch(e){await page.screenshot({path:path.join(artifacts,'failure.png')});throw e;}
  finally{await app.evaluate(({app})=>app.exit(0));}
})().catch(e=>{console.error(e);process.exit(1);});
