const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Clock=require('../frontend/audio_sample_clock.js');
function fixture(name,options){
  let Processor;const packets=[];
  const ctx={AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>packets.push(data)};}},
    registerProcessor:(_,p)=>Processor=p,currentFrame:0,sampleRate:48000,Float32Array,ChoirAudioSampleClock:Clock};
  vm.runInNewContext(fs.readFileSync(require.resolve(`../frontend/${name}`),'utf8').replace(/^import .*;\r?$/gm,''),ctx);
  return {ctx,packets,node:new Processor({processorOptions:options}),output:[[new Float32Array(128).fill(1)]]};
}
const signal=(block,channel=0)=>Float32Array.from({length:128},(_,i)=>block*128+i+channel*10000);

test('stale render timestamps preserve every synchronized sample and exact capture limits',()=>{
  for(const file of ['echo_diagnostic_worklet.js','echo_capture_worklet.js']){
    const f=fixture(file,{startFrame:0,maximumFrames:1024,length:1024});
    [0,128,128,384,384,384,768,896].forEach((frame,i)=>{
      f.ctx.currentFrame=frame;f.node.process(Array.from({length:4},(_,c)=>[signal(i,c)]),f.output);
    });
    assert.equal(f.packets.length,1);const packet=f.packets[0];assert.ok(!packet.error);
    const channels=packet.channels||[packet.microphone,packet.reference];
    for(let c=0;c<channels.length;c++)for(let i=0;i<1024;i++)assert.equal(channels[c][i],i+c*10000);
    assert.equal(packet.clock.skewCount,3);assert.equal(packet.clock.maxLagFrames,256);assert.equal(packet.clock.forwardGaps,0);
    assert.ok(f.output[0][0].every(v=>v===0));assert.equal(f.node.process([],f.output),false);
  }
});

test('unaligned starts and partial final quanta retain the scheduled sample boundaries',()=>{
  const f=fixture('echo_diagnostic_worklet.js',{startFrame:17,maximumFrames:193});
  for(let i=0;i<2;i++){f.ctx.currentFrame=0;f.node.process([[signal(i)]],f.output);}
  assert.equal(f.packets.length,1);const p=f.packets[0];
  assert.equal(p.firstFrame,17);assert.equal(p.valid,193);assert.equal(p.channels[0][0],17);assert.equal(p.channels[0][192],209);
  assert.equal(p.clock.skewCount,1);
});

test('late startup and forward jumps reject calibration instead of silently shifting it',()=>{
  for(const file of ['echo_diagnostic_worklet.js','echo_capture_worklet.js']){
    const late=fixture(file,{startFrame:128,maximumFrames:1024,length:1024});late.ctx.currentFrame=256;
    assert.equal(late.node.process([[signal(2)],[signal(2)]],late.output),false);
    assert.equal(late.packets.at(-1).error,'discontinuous-capture');
    const gap=fixture(file,{startFrame:0,maximumFrames:1024,length:1024});
    gap.node.process([[signal(0)],[signal(0)]],gap.output);gap.ctx.currentFrame=256;
    assert.equal(gap.node.process([[signal(2)],[signal(2)]],gap.output),false);
    assert.equal(gap.packets.at(-1).error,'discontinuous-capture');
  }
});

test('monitor retains contiguous history and increasing sample time through stale timestamps',()=>{
  const f=fixture('echo_monitor_worklet.js');const windows=[];
  for(let i=0;i<88;i++){
    f.ctx.currentFrame=(i%7===3?i-1:i%7===4?i-2:i)*128;
    f.node.process([[signal(i)],[signal(i,1)]],f.output);
    const p=f.packets.at(-1);
    if(p?.microphone&&!windows.includes(p)){
      windows.push(p);f.node.port.onmessage({data:p});
      for(let j=0;j<8192;j++){
        assert.equal(p.microphone[j],(i+1)*128-8192+j);
        assert.equal(p.prediction[j],p.microphone[j]+10000);
      }
    }
  }
  assert.equal(f.packets.filter(p=>p.type==='gap').length,0);assert.ok(windows.length>=3);
  assert.ok(windows.at(-1).clock.skewCount>0);
  for(let i=1;i<windows.length;i++)assert.ok(windows[i].endTime>windows[i-1].endTime);
});

test('forward jumps and explicit reanchors discard monitor windows across interruptions',()=>{
  const f=fixture('echo_monitor_worklet.js');
  for(let i=0;i<63;i++){f.ctx.currentFrame=i*128;f.node.process([[signal(i)]],f.output);}
  f.ctx.currentFrame=65*128;f.node.process([[signal(65)]],f.output);
  assert.equal(f.packets.length,1);assert.equal(f.packets[0].type,'gap');assert.equal(f.node.filled,128);
  f.node.port.onmessage({data:{type:'reset',epoch:9,reanchor:true}});
  for(let i=0;i<64;i++){f.ctx.currentFrame=(100+i)*128;f.node.process([[signal(100+i)]],f.output);}
  const p=f.packets.at(-1);assert.equal(p.epoch,9);assert.equal(p.microphone[0],100*128);
  assert.equal(p.clock.forwardGaps,0);assert.equal(p.endTime,164*128/48000);
});
