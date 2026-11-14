const {contextBridge,ipcRenderer}=require('electron');
const allowed=new Set([
  'bootstrap','list','load','create','save','undo','redo','delete-project',
  'image','export-project','import-project','export-image','data-folder','reload-source','close',
  'sims4-detect','sims4-read-sync','sims4-pick-sync-file','sims4-open-folder',
  'sims4-list-screenshots','sims4-pick-screenshot'
]);
contextBridge.exposeInMainWorld('desktop',{
  call:async(name,...args)=>{if(!allowed.has(name))throw Error('Unknown operation');const r=await ipcRenderer.invoke(name,...args);if(!r.ok)throw Error(r.error);return r.value;},
  onClose:fn=>ipcRenderer.on('request-close',()=>fn()),
  onSims4Update:fn=>ipcRenderer.on('sims4-sync-updated',(_,info)=>fn(info))
});
