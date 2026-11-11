importScripts('families.js','core.js');
self.onmessage = ({data}) => {
  try { const value=data.type==='layout'?Kin.networkLayout(data.project,data.positions,data.options):Kin.infer(data.project,data.focus,data.options);self.postMessage({token:data.token,value}); }
  catch(e){self.postMessage({token:data.token,error:e.message});}
};
