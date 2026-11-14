const {performance}=require('node:perf_hooks');const fs=require('node:fs'),path=require('node:path');const K=require('../core.js');
const results=[];
for(const count of [100,500,2000]){
 const p=K.emptyProject('규모 검증');p.people=Array.from({length:count},(_,i)=>({id:'p'+i,name:'인물 '+i,groups:[]}));
 for(let i=1;i<count;i++){p.relations.push({id:'p'+i,from:'p'+Math.floor((i-1)/2),to:'p'+i,type:'parent',parentKind:'biological'});if(i>2)p.relations.push({id:'f'+i,from:'p'+i,to:'p'+(i-2),type:i%5?'friend':'spouse'});}
 let start=performance.now();const result=K.infer(p,'p'+Math.floor(count/3),{depth:6,limit:100000}),inferenceMs=performance.now()-start;
 start=performance.now();const layout=K.networkLayout(p),layoutMs=performance.now()-start;
 start=performance.now();const tree=K.familyProjection(p,'p'+Math.floor(count/3),6,600),familyMs=performance.now()-start;
 results.push({people:count,relations:p.relations.length,inferenceMs:Math.round(inferenceMs),states:result.states,partial:result.truncated,layoutMs:Math.round(layoutMs),familyMs:Math.round(familyMs),familyCards:tree.nodes.length});
 if(Object.values(layout).some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error('Non-finite layout');
}
fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../test-results/performance.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
