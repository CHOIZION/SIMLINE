(function(root, factory) {
  if(typeof module!=='undefined' && module.exports)module.exports=factory(require('./families.js'));
  else root.Unified=factory(root.Families);
})(globalThis,function(Families){
  'use strict';
  const W=188,H=132,ROW=248,COLUMN=272;
  // Collapse directed parent cycles for placement only. Every individual is still drawn.
  function generations(ids, parents) {
    const forward=new Map(ids.map(id=>[id,new Set()]));
    const reverse=new Map(ids.map(id=>[id,new Set()]));
    for(const [parent,child] of parents){forward.get(parent).add(child);reverse.get(child).add(parent);}
    const finished=[],visited=new Set();
    for(const start of ids){
      if(visited.has(start))continue;
      const stack=[[start,false]];
      while(stack.length){
        const [id,done]=stack.pop();
        if(done){finished.push(id);continue;}
        if(visited.has(id))continue;
        visited.add(id);stack.push([id,true]);
        for(const child of forward.get(id))if(!visited.has(child))stack.push([child,false]);
      }
    }
    const group=new Map();let count=0;
    for(const start of finished.reverse()){
      if(group.has(start))continue;
      const stack=[start];group.set(start,count);
      while(stack.length){
        for(const id of reverse.get(stack.pop()))if(!group.has(id)){group.set(id,count);stack.push(id);}
      }
      count++;
    }
    const next=Array.from({length:count},()=>new Set()),degree=Array(count).fill(0),rank=Array(count).fill(0);
    for(const [p,c] of parents){const a=group.get(p),b=group.get(c);if(a!==b&&!next[a].has(b)){next[a].add(b);degree[b]++;}}
    const queue=degree.flatMap((n,i)=>n===0?[i]:[]);
    for(let i=0;i<queue.length;i++)for(const b of next[queue[i]]){
      rank[b]=Math.max(rank[b],rank[queue[i]]+1);if(--degree[b]===0)queue.push(b);
    }
    return new Map(ids.map(id=>[id,rank[group.get(id)]]));
  }
  function layout(project,previous={},options={}){
    const ids=project.people.map(p=>p.id);
    const parents=project.relations.filter(r=>r.type==='parent').map(r=>[r.from,r.to]);
    const ranks=generations(ids,parents),neighbors=new Map(ids.map(id=>[id,new Set()]));
    const participation=new Map(ids.map(id=>[id,0])),knownParents=new Map(ids.map(id=>[id,[]]));
    for(const [p,c] of parents)knownParents.get(c).push(p);
    for(const e of project.relations){
      neighbors.get(e.from).add(e.to);neighbors.get(e.to).add(e.from);
      if(e.type==='spouse'||e.type==='former'){participation.set(e.from,participation.get(e.from)+1);participation.set(e.to,participation.get(e.to)+1);}
    }
    const positions={},fixed=[],seen=new Set();
    for(const id of ids)if(previous[id]&&(previous[id].pinned||options.incremental||options.only&&!options.only.has(id))){
      positions[id]={...previous[id]};fixed.push(positions[id]);
    }
    let left=0;
    for(const start of ids){
      if(seen.has(start))continue;
      const component=[start];seen.add(start);
      for(let i=0;i<component.length;i++)for(const id of neighbors.get(component[i]))if(!seen.has(id)){seen.add(id);component.push(id);}
      const rows=new Map();
      for(const id of component){const rank=ranks.get(id);if(!rows.has(rank))rows.set(rank,[]);rows.get(rank).push(id);}
      let right=left;
      for(const [rank,row] of [...rows].sort((a,b)=>a[0]-b[0])){
        const meanParentX=id=>{const ps=knownParents.get(id).filter(p=>positions[p]);return ps.length?ps.reduce((sum,p)=>sum+positions[p].x,0)/ps.length:0;};
        row.sort((a,b)=>rank?meanParentX(a)-meanParentX(b):Number(b===options.focus)-Number(a===options.focus)||participation.get(b)-participation.get(a));
        for(let i=0;i<row.length;i++){
          const id=row[i];
          if(!positions[id]){
            let x=left+(rank?240:0)+i*(rank?COLUMN:480);
            if(rank===1 && row.length===1 && knownParents.get(id).length===2 && knownParents.get(id).every(p=>positions[p]))x=Math.round(meanParentX(id));
            const y=rank*ROW;
            while(fixed.some(n=>Math.abs(n.x-x)<W+28&&Math.abs(n.y-y)<H+30))x+=COLUMN;
            positions[id]={x,y,pinned:false};fixed.push(positions[id]);
          }
          right=Math.max(right,positions[id].x+W);
        }
      }
      left=right+160;
    }
    return positions;
  }
  // Different generations use a bottom port on the older card and a side
  // port on its partner. The child's top port remains available for its birth line.
  function coupleRouter(positions){
    const cache=new Map();
    return function(unit,units,boxes){
      const [a,b]=unit.parents;
      if(a.id===b.id||Math.abs(a.y-b.y)<H+10)return null;
      const upper=a.y<b.y?a:b,lower=upper===a?b:a;
      const side=lower.x>=upper.x?1:-1;
      const cacheKey=JSON.stringify([upper.person,side]);
      if(!cache.has(cacheKey)){
        const partners=units.filter(f=>f.parents.includes(upper.person)).map(f=>{
          const p=positions[f.parents.find(id=>id!==upper.person)];
          return {id:f.id,p};
        }).filter(({p})=>p&&p.y-upper.y>=H+10&&(p.x>=upper.x?1:-1)===side)
          .sort((a,b)=>a.p.y-b.p.y||a.p.x-b.p.x||a.id.localeCompare(b.id));
        cache.set(cacheKey,partners.map(({id})=>id));
      }
      const lanes=cache.get(cacheKey),order=Math.max(0,lanes.indexOf(unit.id));
      const fraction=(order+1)/(lanes.length+1);
      const port=upper.x+Math.round(18+(W-36)*(side===1?1-fraction:fraction));
      const start={x:port,y:upper.y+H};
      const end={x:lower.x+(side===1?0:W),y:lower.y+H/2};
      let rail=port;
      if((side===1&&rail>=end.x-16)||(side===-1&&rail<=end.x+16))rail=side===1?Math.min(upper.x,lower.x)-32-order*10:Math.max(upper.x,lower.x)+W+32+order*10;
      const via=[{x:port,y:start.y+18},{x:rail,y:start.y+18},{x:rail,y:end.y}];
      const approach={x:end.x-side*26,y:end.y};
      const direct=[start,...via,end];
      const clear=direct.every((p,i)=>!i||!boxes.some(box=>Families.crosses(direct[i-1],p,box)));
      let path;
      if(clear)path=Families.route(start,end,boxes,via);
      else if(!boxes.some(box=>Families.crosses(approach,end,box))){
        const bypassY=lower.y-28;
        path=Families.route(start,approach,boxes,[{x:rail,y:start.y+18},{x:rail,y:bypassY},{x:approach.x,y:bypassY}]);
        if(path.length)path.push(end);
      }else path=Families.route(start,end,boxes,via);
      if(path.length<2)return null;
      // Place the junction on the final approach to the partner. All child
      // branches therefore start near that generation even if a parent spans many rows.
      const prev=path.at(-2),last=path.at(-1);
      const distance=Math.abs(last.x-prev.x)+Math.abs(last.y-prev.y);
      const remainingFromEnd=distance/2;
      const length=path.slice(1).reduce((n,p,i)=>n+Math.abs(p.x-path[i].x)+Math.abs(p.y-path[i].y),0);
      return upper===a?{points:path,cut:length-remainingFromEnd}:{points:path.reverse(),cut:remainingFromEnd};
    };
  }
  function ensure(project,reset=false,only=null){
    const v=project.views.unified||={positions:{},viewport:null};
    if(reset||Object.keys(v.positions).length!==project.people.length||project.people.some(p=>!v.positions[p.id])){
      v.positions=layout(project,v.positions,{incremental:!reset,only,focus:project.focus});
    }
    return v;
  }
  function projection(project){
    const positions=ensure(project).positions;
    const options={network:true,sharedCouple:coupleRouter(positions)};
    const model={...project,views:{...project.views,network:{positions}}};
    const loose=Families.legacyUnits(model);
    if(loose.units.length){
      const graph=Families.projectUnits({...model,
        families:[...(model.families||[]),...loose.units],
        relations:model.relations.filter(r=>!loose.consumed.has(r.id)).concat(loose.units.flatMap(Families.facts))
      },options);
      graph.legacy=true;
      return graph;
    }
    return Families.projectUnits(model,options);
  }
  return {layout,ensure,projection};
});
