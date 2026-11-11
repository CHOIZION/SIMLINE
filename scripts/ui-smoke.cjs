const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
let automation;try{automation=require('playwright-core');}catch{automation=require(path.resolve(path.dirname(process.execPath),'../node_modules/playwright-core'));}const {_electron:electron}=automation;
(async()=>{
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});const data=path.join(__dirname,'../.test-data/ui-'+Date.now());
  const app=await electron.launch({executablePath:process.env.INYEON_EXE||require('electron'),args:process.env.INYEON_EXE?[]:[path.join(__dirname,'..')],env:{...process.env,INYEON_DATA:data},timeout:40000});
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('RENDERER',m.text());});
  try{
    await page.waitForFunction(()=>typeof project!=='undefined' && project?.id);await page.evaluate(async()=>applyLoad(await api('create','달빛 아래의 사람들',true)));
    await page.locator('#canvas-title').filter({hasText:'달빛 아래의 사람들'}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.node').length===8);await page.waitForTimeout(900);
    await page.screenshot({path:path.join(__dirname,'../test-results/01-network.png')});
    const initial=await page.evaluate(async()=>(await window.desktop.call('bootstrap')).project.views.network.positions);
    const card=page.locator('.node[data-person="a"]'),box=await card.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+45,box.y+box.height/2+18,{steps:8});await page.mouse.up();await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='● 저장됨');
    const moved=await page.evaluate(async()=>(await window.desktop.call('bootstrap')).project.views.network.positions);assert(moved.a.pinned);assert.notEqual(moved.a.x,initial.a.x);assert.deepEqual(moved.b,initial.b);
    await page.locator('#person-list [data-action="select-person"][data-id="b"]').click();await page.locator('[data-action="set-focus"]').click();await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='● 저장됨');const refChanged=await page.evaluate(async()=>(await window.desktop.call('bootstrap')).project.views.network.positions);assert.deepEqual(refChanged,moved);
    await page.locator('[data-action="add-person"]').first().click();await page.locator('#person-name').fill('테스트 인물');await page.locator('#person-subtitle').fill('검증을 위한 캐릭터');await page.locator('#person-notes').fill('저장과 복원 확인');await page.locator('[data-action="save-person"]').click();await page.waitForFunction(()=>document.querySelectorAll('.node').length===9);
    await page.locator('[data-action="add-relation"]').click();await page.locator('#rel-type').selectOption('spouse');await page.locator('#rel-target').selectOption('d');await page.locator('[data-action="save-relation"]').click();
    await page.locator('[data-action="add-relation"]').click();await page.locator('#rel-type').selectOption('parent');await page.locator('#rel-target').selectOption('d');await page.locator('[data-action="save-relation"]').click();
    await page.locator('[data-action="set-focus"]').click();await page.waitForTimeout(300);
    await page.locator('[data-action="mode"][data-mode="family"]').click();await page.waitForTimeout(300);await page.screenshot({path:path.join(__dirname,'../test-results/02-family.png')});
    await page.locator('[data-action="mode"][data-mode="network"]').click();
    await page.locator('#search').fill('테스트');assert.equal(await page.locator('#person-list .person-row').count(),1);await page.locator('#search').fill('');
    await page.locator('[data-action="edit-person"]').first().click();await page.locator('#person-name').fill('수정한 인물');await page.locator('[data-action="save-person"]').click();await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='● 저장됨');
    await page.locator('#undo').click();await page.waitForFunction(()=>document.querySelector('#person-list').textContent.includes('테스트 인물'));
    await page.locator('#redo').click();await page.waitForFunction(()=>document.querySelector('#person-list').textContent.includes('수정한 인물'));
    await page.locator('[data-action="filters"]').click();await page.locator('input[name="edge-filter"][value="friend"]').uncheck();await page.locator('[data-action="apply-filters"]').click();
    await page.locator('[data-action="layout-menu"]').click();await page.locator('[data-action="layout-all"]').click();await page.waitForFunction(()=>document.querySelector('#layout-status').hidden);await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='● 저장됨');
    const proof=page.locator('[data-action="show-proof"]').first();if(await proof.count()){await proof.click();assert(await page.locator('#path-panel').isVisible());await page.locator('[data-action="close-proof"]').click();}
    await page.locator('[data-action="group-settings"]').click();await page.locator('[data-action="add-group-row"]').click();await page.locator('.group-edit input[type="text"]').last().fill('검증 그룹');await page.locator('[data-action="save-groups"]').click();
    await page.locator('[data-action="help"]').click();await page.screenshot({path:path.join(__dirname,'../test-results/03-help.png')});await page.locator('[data-action="close-modal"]').first().click();
    assert.deepEqual(errors,[]);await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='● 저장됨');
    const result=await page.evaluate(async()=>{const b=await window.desktop.call('bootstrap');return{people:b.project.people.length,relations:b.project.relations.length,name:b.project.people.find(p=>p.name==='수정한 인물')?.name,groups:b.project.groups.length};});assert.equal(result.people,9);assert.equal(result.relations,14);assert.equal(result.groups,4);assert.equal(result.name,'수정한 인물');
    // Native file dialogs are stubbed only in this isolated test instance.
    await app.evaluate(({dialog},image)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[image]});},path.join(__dirname,'../assets/icon.png'));
    await page.locator('[data-action="edit-person"]').first().click();await page.locator('[data-action="pick-photo"]').click();await page.waitForFunction(()=>document.querySelector('#photo-preview').src.startsWith('data:image/png'));
    await page.locator('#crop-zoom').fill('1.5');await page.locator('[data-action="save-person"]').click();await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='● 저장됨');
    const output=path.join(__dirname,'../test-results');
    await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async(_window,options)=>({canceled:false,filePath:output+'/'+options.defaultPath});},output);
    await page.locator('[data-action="export-menu"]').click();await page.locator('[data-action="export-project"]').click();
    const backup=path.join(output,'달빛 아래의 사람들.simline');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('백업을 저장'));
    const exported=JSON.parse(fs.readFileSync(backup,'utf8'));assert.equal(exported.project.people.length,9);assert.equal(Object.keys(exported.assets).length,1);assert(exported.project.people.some(p=>p.crop?.zoom===1.5));
    await page.locator('[data-action="export-svg"]').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('이미지를 저장'));
    assert(fs.readFileSync(path.join(output,'달빛 아래의 사람들.svg'),'utf8').includes('<svg'));
    await page.locator('[data-action="export-menu"]').click();await page.locator('[data-action="export-png"]').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('이미지를 저장'));
    assert.equal(fs.readFileSync(path.join(output,'달빛 아래의 사람들.png')).subarray(1,4).toString(),'PNG');
    await app.evaluate(({dialog},backup)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});},backup);
    await page.locator('[data-action="projects"]').first().click();await page.locator('[data-action="import-project"]').click();await page.waitForFunction(()=>document.querySelector('#canvas-title').textContent.includes('가져옴'));
    assert.equal(await page.locator('#person-list .person-row').count(),9);
    await page.locator('#person-list [data-action="select-person"]').filter({hasText:'수정한 인물'}).click();await page.locator('[data-action="merge-person"]').click();await page.locator('#merge-target').selectOption('d');await page.locator('[data-action="do-merge"]').click();await page.waitForFunction(()=>document.querySelectorAll('.node').length===8);await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='● 저장됨');
    await page.locator('#undo').click();await page.waitForFunction(()=>document.querySelectorAll('.node').length===9);
    await page.locator('#person-list [data-action="select-person"]').filter({hasText:'수정한 인물'}).click();await page.locator('[data-action="delete-person"]').click();await page.locator('[data-action="do-delete-person"]').click();await page.waitForFunction(()=>document.querySelectorAll('.node').length===8);await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='● 저장됨');
    await page.locator('#undo').click();await page.waitForFunction(()=>document.querySelectorAll('.node').length===9);
    assert.deepEqual(errors,[]);console.log('UI SMOKE PASSED',JSON.stringify(result));await page.screenshot({path:path.join(__dirname,'../test-results/04-final.png')});
  }catch(e){await page.screenshot({path:path.join(__dirname,'../test-results/ERROR.png')});throw e;}finally{await app.evaluate(({app})=>app.exit(0));}
  await new Promise(resolve=>app.process().exitCode!==null?resolve():app.process().once('exit',resolve));
  const reopened=await electron.launch({executablePath:process.env.INYEON_EXE||require('electron'),args:process.env.INYEON_EXE?[]:[path.join(__dirname,'..')],env:{...process.env,INYEON_DATA:data},timeout:40000});
  try{const page=await reopened.firstWindow();await page.waitForFunction(()=>document.querySelectorAll('.node').length===9);const restored=await page.evaluate(()=>window.desktop.call('bootstrap'));assert.equal(restored.project.people.length,9);assert.equal(Object.keys(restored.assets).length,1);assert(restored.history.redo);assert(restored.project.people.some(p=>p.name==='수정한 인물'));console.log('RESTART PERSISTENCE PASSED');}finally{await reopened.evaluate(({app})=>app.exit(0));}
})().catch(e=>{console.error(e);process.exit(1);});
