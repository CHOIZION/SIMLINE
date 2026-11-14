'use strict';

const canvasElement = document.getElementById('canvas');
const standardHint = '카드의 ⊕를 다른 카드까지 끌어 연결하세요.';
const openProfiles = new Set();
let linking = null;
let candidateNode = null;
const svgNamespace = 'http://www.w3.org/2000/svg';

function drawConnectionHandles() {
  for (const card of document.querySelectorAll('#world .node')) {
    card.insertAdjacentHTML('beforeend', `<g class="connect-port" data-editor-only="true" data-port="${esc(card.dataset.person)}" transform="translate(${CARD_W},30)" role="button" tabindex="0" aria-label="${esc(personName(card.dataset.person))}에서 관계 연결"><circle class="port-hit" r="18" fill="transparent"/><circle class="port-face" r="9" fill="#344d3e" stroke="#c3d9b6" stroke-width="1.6"/><path d="M-4 0H4 M0 -4V4" stroke="#e6f0df" stroke-width="1.6" stroke-linecap="round" pointer-events="none"/><title>다른 카드까지 끌어 관계 연결</title></g>`);
  }
  if(!linking)hint();
  sizeEditorPorts(true);
  for (const junction of document.querySelectorAll('#world [data-junction]')) {
    const dot=junction.querySelector('circle');
    const hit=dot.cloneNode(false);
    hit.setAttribute('r','16');hit.setAttribute('fill','transparent');hit.setAttribute('stroke','none');
    hit.setAttribute('data-editor-only','true');junction.prepend(hit);
    junction.insertAdjacentHTML('beforeend',`<text data-editor-only="true" class="junction-hint" x="${Number(dot.getAttribute('cx'))+12}" y="${Number(dot.getAttribute('cy'))+18}" font-size="11" fill="#d2e5cc" pointer-events="none">자녀 카드로 끌기</text>`);
    const title=junction.querySelector('title');
    if(title)title.textContent+=' · 자녀 카드로 끌기 / 클릭해 가족 편집';
  }
}
function sizeEditorPorts(force=false){
  const world=$('#world'),scale=String(view.scale);
  if(!force&&world.dataset.portZoom===scale)return;
  world.dataset.portZoom=scale;
  const adjust=Math.max(.65,Math.min(2.2,1/view.scale));
  for(const port of world.querySelectorAll('[data-port]'))port.setAttribute('transform',`translate(${CARD_W},30) scale(${adjust})`);
}
function simplifyAddPerson() {
  const body=$('#modal .modal-body');
  const extra=document.createElement('details');
  extra.className='optional-profile';
  extra.innerHTML='<summary>사진·성별·메모 추가</summary>';
  for(const item of [...body.children]){
    if(item.id==='form-error'||item.querySelector('#person-name,#person-subtitle'))continue;
    extra.append(item);
  }
  body.append(extra);
  $('#modal .modal-footer').insertAdjacentHTML('afterbegin','<button class="secondary add-next" data-action="save-another">저장하고 계속 추가</button>');
}
function revealNewCard(id) {
  let node=projection?.nodes.find(n=>n.person===id);
  if(!node||!filteredPeople().some(p=>p.id===id)){
    query='';groupFilter=null;$('#search').value='';
    project.ui={...project.ui,groupFilter:null,familyOwner:'',familyBranch:''};
    renderAll();node=projection.nodes.find(n=>n.person===id);
  }
  if(!node)return;
  const box=canvasElement.getBoundingClientRect();
  const x=node.x*view.scale+view.x,y=node.y*view.scale+view.y;
  if(project.people.length===1||x<15||y<15||x+CARD_W*view.scale>box.width-15||y+CARD_H*view.scale>box.height-25){
    if(project.people.length<=12)fitGraph();else centerPerson(id);
  }
}
function simplifyDetails(el,p) {
  const actions=el.querySelector('.profile-actions');
  if(!actions)return;
  const quick=actions.querySelector('[data-action="add-relation"]');
  if(quick){quick.dataset.action='choose-link-target';quick.textContent='다른 카드와 연결';}
  const drawer=document.createElement('details');
  drawer.className='profile-drawer';drawer.open=openProfiles.has(p.id);
  drawer.innerHTML='<summary>프로필·가족·친족 상세</summary>';
  let next=actions.nextElementSibling;
  while(next){const sibling=next.nextElementSibling;drawer.append(next);next=sibling;}
  drawer.insertAdjacentHTML('beforeend',buttonHTML('add-relation','관계 상세 입력',p.id));
  drawer.addEventListener('toggle',()=>{if(drawer.open)openProfiles.add(p.id);else openProfiles.delete(p.id);});
  const edges=project.relations.filter(r=>r.from===p.id||r.to===p.id);
  const summary=document.createElement('div');
  summary.className='compact-connections';
  summary.innerHTML=`<div class="section-caption">연결된 관계 <small>${edges.length}개</small></div>`+
    (edges.slice(0,5).map(r=>{
      const target=r.from===p.id?r.to:r.from;
      return `<button data-action="edit-relation" data-id="${esc(r.id)}"><span>${esc(personName(target))}</span><small>${esc(Kin.labelRelation(r,p.id))}</small></button>`;
    }).join('')||'<p class="micro">카드의 ⊕에서 첫 관계를 연결하세요.</p>');
  el.append(summary,drawer);
}
function canvasPoint(clientX,clientY) {
  return new DOMPoint(clientX,clientY).matrixTransform(canvasElement.getScreenCTM().inverse());
}
function hint(message){$('#connection-hint').textContent=message||(projection?.junctions?.length?'카드 ⊕는 인물끼리, 가운데 ○는 자녀 카드로 끌어 연결하세요.':standardHint);}
function clearTarget(){
  candidateNode?.classList.remove('drop-candidate');candidateNode=null;
}
function cancelLink(){
  const pending=linking;linking=null;
  if(pending?.pointerId!=null&&canvasElement.hasPointerCapture(pending.pointerId))canvasElement.releasePointerCapture(pending.pointerId);
  $('#link-preview')?.remove();clearTarget();canvasElement.classList.remove('is-linking');hint();
}
function sourceName(source){
  return source.kind==='family'?source.family.name:personName(source.id);
}
function beginLink(source,point,event=null) {
  cancelLink();
  linking={...source,point,projectId:project.id,pointerId:event?.pointerId??null,start:event?{x:event.clientX,y:event.clientY}:null,moved:false};
  if(event)canvasElement.setPointerCapture(event.pointerId);
  const preview=document.createElementNS(svgNamespace,'path');
  preview.id='link-preview';preview.setAttribute('data-editor-only','true');preview.setAttribute('pointer-events','none');
  canvasElement.append(preview);canvasElement.classList.add('is-linking');
  hint((source.kind==='family'?'자녀로 연결할 카드':'연결할 상대 카드')+'를 선택하세요 · Esc 취소');
}
function pickTargetAt(x,y){
  const card=document.elementFromPoint(x,y)?.closest('#world .node');
  return card && !(linking?.kind==='person' && card.dataset.person===linking.id)?card:null;
}
function updateLink(x,y){
  if(!linking)return;
  const point=canvasPoint(x,y),start=linking.point;
  const target=pickTargetAt(x,y);
  if(candidateNode!==target){clearTarget();candidateNode=target;target?.classList.add('drop-candidate');}
  $('#link-preview')?.setAttribute('d',`M ${start.x} ${start.y} L ${point.x} ${point.y}`);
}
function openSourceFamily(id) {
  if(familyById(id))openFamily(id);else previewLegacy();
}
function takeDrop(targetId) {
  const source=linking;
  cancelLink();
  if(!source||source.projectId!==project.id||!person(targetId))return;
  if(source.kind==='family')familyDropDialog(source.family,targetId);
  else if(source.id!==targetId)pairDropDialog(source.id,targetId);
}
function junctionModel(id){
  return familyById(id)||projection.junctions?.find(j=>j.id===id)?.record;
}
function eat(event){event.preventDefault();event.stopImmediatePropagation();}
canvasElement.addEventListener('pointerdown',event=>{
  if(event.button!==0||!event.isPrimary)return;
  if(linking?.pointerId==null&&linking){
    eat(event);
    const target=pickTargetAt(event.clientX,event.clientY);
    if(target)takeDrop(target.dataset.person);else cancelLink();
    return;
  }
  const port=event.target.closest('[data-port]');
  const junction=event.target.closest('[data-junction]');
  if(!port&&!junction)return;
  const family=junction&&junctionModel(junction.dataset.junction);
  if(!port&&!family)return;
  eat(event);
  const dot=(port||junction).querySelector('circle');
  const bounds=dot.getBoundingClientRect();
  beginLink(port?{kind:'person',id:port.dataset.port}:{kind:'family',family},
    canvasPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2),event);
},true);
canvasElement.addEventListener('pointermove',event=>{
  if(!linking||linking.pointerId!==null&&linking.pointerId!==event.pointerId)return;
  eat(event);
  if(linking.start && Math.hypot(event.clientX-linking.start.x,event.clientY-linking.start.y)>5)linking.moved=true;
  updateLink(event.clientX,event.clientY);
},true);
canvasElement.addEventListener('pointerup',event=>{
  if(!linking||linking.pointerId!==event.pointerId)return;
  eat(event);
  const source=linking;
  if(!source.moved){
    if(source.kind==='family'){cancelLink();openSourceFamily(source.family.id);return;}
    linking.pointerId=null;
    if(canvasElement.hasPointerCapture(event.pointerId))canvasElement.releasePointerCapture(event.pointerId);
    return;
  }
  const target=pickTargetAt(event.clientX,event.clientY);
  if(target)takeDrop(target.dataset.person);else cancelLink();
},true);
for(const name of ['pointercancel','lostpointercapture'])canvasElement.addEventListener(name,event=>{
  if(linking&&linking.pointerId===event.pointerId){eat(event);cancelLink();}
},true);
window.addEventListener('blur',cancelLink);
document.addEventListener('pointerdown',event=>{
  if(linking&&!canvasElement.contains(event.target))cancelLink();
},true);
function startPicker(id) {
  const port=document.querySelector(`[data-port="${CSS.escape(id)}"]`);
  if(!port)return;
  const r=port.getBoundingClientRect();beginLink({kind:'person',id},canvasPoint(r.x+r.width/2,r.y+r.height/2));
  canvasElement.focus();
}
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&linking){eat(event);cancelLink();return;}
  if((event.key==='Enter'||event.key===' ')&&event.target.closest('[data-port]')){
    eat(event);startPicker(event.target.closest('[data-port]').dataset.port);return;
  }
  if(linking && event.key==='Enter' && event.target.closest('.node')){
    eat(event);takeDrop(event.target.closest('.node').dataset.person);return;
  }
  if(event.key==='Enter'&&event.target.id==='person-name'&&modalState.type==='person'&&!event.isComposing){
    eat(event);savePerson(event.ctrlKey&&!modalState.editing&&!modalState.relationAnchor);
  }
},true);

const quickRelations=[
  ['spouse','배우자'],['parent','출발 인물이 부모'],['child','도착 인물이 부모'],
  ['sibling','형제자매'],['friend','친구'],['lover','연인'],['colleague','동료'],
  ['former','이전 배우자'],['rival','라이벌'],['custom','직접 입력']
];
function proposedPair(choice,from,to,label=''){
  return {id:Kin.id(),from:choice==='child'?to:from,to:choice==='child'?from:to,
    type:choice==='child'?'parent':choice,parentKind:choice==='parent'||choice==='child'?'unspecified':'',label,notes:''};
}
function alreadyRegistered(proposal){
  return project.relations.some(r=>r.type===proposal.type &&
    (r.from===proposal.from&&r.to===proposal.to||r.type!=='parent'&&r.from===proposal.to&&r.to===proposal.from)&&
    (r.type!=='custom'||r.label===proposal.label));
}
function pairTile(choice,label,from,to){
  const disabled=choice!=='custom'&&alreadyRegistered(proposedPair(choice,from,to));
  const caption=choice==='parent'?personName(from)+' → '+personName(to):choice==='child'?personName(to)+' → '+personName(from):label;
  return `<button class="relation-choice" data-action="pair-choice" data-choice="${choice}" ${disabled?'disabled':''}><span>${esc(choice==='parent'?personName(from)+'이(가) 부모':choice==='child'?personName(to)+'이(가) 부모':label)}</span>${disabled?'<small>이미 연결됨</small>':caption!==label?`<small>${esc(caption)}</small>`:''}</button>`;
}
function pairDropDialog(from,to){
  const a=person(from),b=person(to);
  const tiles=quickRelations.map(([choice,label])=>pairTile(choice,label,from,to));
  modal('관계 선택',`<div class="endpoint-pair"><div>${thumb(a)}<strong>${esc(a.name)}</strong></div><span>↔</span><div>${thumb(b)}<strong>${esc(b.name)}</strong></div></div>
    <p class="choice-instruction">관계를 누르면 두 인물이 연결됩니다.</p>
    <div class="choice-grid">${tiles.slice(0,6).join('')}</div>
    <details class="optional-profile"><summary>다른 관계</summary><div class="choice-grid">${tiles.slice(6).join('')}</div></details>
    <div id="custom-pair" hidden>${field('관계 이름','pair-label','','text','maxlength="100"')}<button class="primary" data-action="pair-custom">연결</button></div>`);
  modalState={type:'pair-drop',from,to};
}
function savePair(choice,label=''){
  if(modalState.type!=='pair-drop')return;
  const {from,to}=modalState;
  if(!person(from)||!person(to))throw Error('연결할 인물을 찾을 수 없습니다.');
  const r=proposedPair(choice,from,to,label);
  if(alreadyRegistered(r))throw Error('같은 관계가 이미 등록되어 있습니다.');
  const success=commit('두 카드 연결',()=>{appendConnection(r);pathSelection=null;});
  if(success){closeModal();toast(`${personName(from)} · ${personName(to)} 관계를 연결했습니다.`);}
}
function familyDropDialog(family,id){
  const name=personName(id),parents=family.parents.map(personName).join(' · ');
  const enrolled=Families.childrenOf(family).includes(id);
  const options=family.births.map(b=>[b.id,b.children.map(personName).join(', ')+'와 같은 출생 사건']);
  modal('자녀 연결',`<p class="family-preview"><strong>${esc(name)}</strong>을(를) <strong>${esc(parents||family.name)}</strong>의 자녀로 연결합니다.</p>
    ${enrolled?'<p class="notice">이 가족에 이미 등록된 자녀입니다.</p>':''}
    ${options.length&&!enrolled?`<details class="optional-profile"><summary>출생 사건 선택 · 쌍둥이 등</summary>${selectField('출생 사건','drop-birth',[['','새 출생 사건'],...options],'')}</details>`:''}`,
    buttonHTML('close-modal','취소')+`<button class="primary" data-action="save-family-drop" ${enrolled?'disabled':''}>자녀로 연결</button>`);
  modalState={type:'family-drop',familyId:family.id,target:id};
}
function saveFamilyDrop(){
  if(modalState.type!=='family-drop')return;
  const {familyId,target}=modalState;
  const eventId=$('#drop-birth')?.value;
  const success=commit('가족에 자녀 연결',()=>{
    let family=familyById(familyId);
    if(!family){
      const legacy=Families.legacyUnits(project).units.find(f=>f.id===familyId);
      if(!legacy)throw Error('이 가족을 다시 선택해 주세요.');
      const bindings=new Set(Object.values(legacy.relationIds));
      Families.adoptLegacy(project,{units:[legacy],consumed:bindings});family=familyById(familyId);
    }
    const edited=Kin.clone(family);
    if(Families.childrenOf(edited).includes(target))throw Error('이 가족에 이미 등록된 자녀입니다.');
    if(eventId){const event=edited.births.find(b=>b.id===eventId);if(!event)throw Error('출생 사건을 다시 선택해 주세요.');event.children.push(target);}
    else edited.births.push({id:Kin.id(),date:'',children:[target]});
    Families.save(project,edited);
    project.views.family.anchors=Families.projectUnits(project).placement;pathSelection=null;
  });
  if(success){closeModal();toast(personName(target)+'을(를) 자녀로 연결했습니다.');}
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');
  const tools=$('#canvas-tools');
  if(tools.open&&(!tools.contains(event.target)||button&&button.dataset.action!=='ignore'))tools.open=false;
  if(!button||button.disabled)return;
  try{
    switch(button.dataset.action){
      case 'save-another':savePerson(true);break;
      case 'choose-link-target':startPicker(button.dataset.id);break;
      case 'pair-choice':
        if(button.dataset.choice==='custom'){$('#custom-pair').hidden=false;$('#pair-label').focus();}
        else savePair(button.dataset.choice);
        break;
      case 'pair-custom':{
        const label=$('#pair-label').value.trim();if(!label)throw Error('관계 이름을 입력하세요.');savePair('custom',label);break;
      }
      case 'save-family-drop':saveFamilyDrop();break;
      case 'reload-source':await flush();await api('reload-source');break;
    }
  }catch(error){if($('#modal').open)formError(error);else toast(error.message,true);}
});
boot();
