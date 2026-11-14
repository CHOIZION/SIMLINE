const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../core.js'), F=require('../families.js'), U=require('../unified.js');

test('one P1 in seven unions, with separate spouse and child ports on P3',()=>{
  const p=F.fixture(K),before=JSON.stringify([p.people,p.families,p.relations,p.views.family,p.views.network]);
  const g=U.projection(p),people=new Map(g.nodes.map(n=>[n.person,n]));
  assert.equal(g.nodes.length,10);assert.equal(people.size,10);assert.equal(g.junctions.length,7);
  assert(g.junctions.every(j=>j.parents[0]===people.get('P1')));
  const spouse=g.segments.filter(s=>s.unitId==='F2'&&s.type==='spouse');
  assert.equal(spouse[0].points[0].y,people.get('P1').y+132);
  assert.deepEqual(spouse.at(-1).points.at(-1),{x:people.get('P3').x,y:people.get('P3').y+66});
  const child=g.segments.find(s=>s.unitId==='F1'&&s.type==='parent');
  assert.deepEqual(child.points[0],g.junctions[0].center);
  assert.deepEqual(child.points.at(-1),{x:people.get('P3').x+94,y:people.get('P3').y});
  for(const s of g.segments){
    assert(!s.blocked);
    for(let i=1;i<s.points.length;i++){
      const a=s.points[i-1],b=s.points[i];assert(a.x===b.x||a.y===b.y);
      assert(!g.nodes.some(n=>F.crosses(a,b,{...n,w:188,h:132})));
    }
  }
  assert.equal(JSON.stringify([p.people,p.families,p.relations,p.views.family,p.views.network]),before);
});
test('multiple generations tolerate cycles, additions and pinned positions',()=>{
  const p=F.fixture(K);
  p.relations.push({id:'cycle',type:'parent',from:'P9',to:'P1'});
  const v=U.ensure(p);v.positions.P1={x:90,y:55,pinned:true};U.ensure(p,true);
  assert.deepEqual(v.positions.P1,{x:90,y:55,pinned:true});
  const old=K.clone(v.positions);p.people.push({id:'extra',name:'extra',groups:[]});
  U.ensure(p);for(const id of Object.keys(old))assert.deepEqual(v.positions[id],old[id]);
  assert.equal(U.projection(p).nodes.length,11);
});
test('legacy and standalone people each get one actual card',()=>{
  for(const p of [K.demo(),K.emptyProject('새 프로젝트')]){
    p.people.push({id:'solo',name:'solo',groups:[]});
    const g=U.projection(p);assert.equal(g.nodes.length,p.people.length);
    assert.equal(new Set(g.nodes.map(n=>n.id)).size,p.people.length);
  }
});
