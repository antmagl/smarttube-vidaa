export function gridTarget(index,direction,count,columns=3){
 if(direction==='left')return index%columns===0?'sidebar':index-1;
 if(direction==='right')return index%columns===columns-1||index===count-1?index:index+1;
 if(direction==='up')return index<columns?'header':index-columns;
 if(direction==='down')return index+columns<count?index+columns:index;
 return index;
}
export function readHistory(raw){
 try{return JSON.parse(raw).filter(v=>/^[\w-]{11}$/.test(v?.id)&&typeof v.title==='string').slice(0,60).map(cleanVideo);}catch{return [];}
}
function cleanVideo(v){const raw=typeof v.thumbnail==='string'?v.thumbnail:'';const thumb=/^\/\//.test(raw)?'https:'+raw:raw;return {id:v.id,title:String(v.title),author:String(v.author||''),thumbnail:/^https:\/\//.test(thumb)?thumb:'',duration:typeof v.duration==='string'?v.duration:''};}
export function rememberVideo(history,video){return [cleanVideo(video),...history.filter(v=>v.id!==video.id)].slice(0,60);}
export function preferredFormat(formats,height=0){
 formats=formats.filter(f=>f.available!==false);
 const rank=(a,b)=>b.height-a.height||b.fps-a.fps||Number(/vp0?9/i.test(b.codec||''))-Number(/vp0?9/i.test(a.codec||''))||Number(/avc/i.test(b.codec||''))-Number(/avc/i.test(a.codec||''))||(b.bitrate||0)-(a.bitrate||0);
 return (height>0?formats.filter(f=>f.height>0&&f.height<=height).sort(rank)[0]:null)||formats.find(f=>f.id==='auto')||formats.slice().sort(rank)[0];
}
export function withFormat(video,format){return {...video,...format,id:video.id,adaptiveInfo:format.adaptiveInfo,quality:format.label||video.quality,selectedFormatId:format.id||video.selectedFormatId};}
