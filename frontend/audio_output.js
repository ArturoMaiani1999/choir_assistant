/* A listening-device choice lasts exactly 24 hours after confirmation. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ChoirAudioOutput=api;})(globalThis,function(){
  'use strict';
  const KEY='choir-audio-output:v2', TTL=24*60*60*1000;
  function parse(raw,now=Date.now()){
    try{
      const value=JSON.parse(raw);
      if(!['bluetooth','standard'].includes(value?.type)||!Number.isFinite(value.confirmedAt)
        ||value.confirmedAt>now||now-value.confirmedAt>=TTL)return null;
      return {type:value.type,confirmedAt:value.confirmedAt};
    }catch(_){return null;}
  }
  return Object.freeze({KEY,TTL,parse});
});
