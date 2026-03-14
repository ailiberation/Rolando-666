import * as Tone from "tone";

const INSTRUMENTS = [
  { id: 'bass', label: 'Bass Drum' },
  { id: 'snare', label: 'Snare' },
  { id: 'closed_hh', label: 'Closed Hi-Hat' },
  { id: 'open_hh', label: 'Open Hi-Hat' },
  { id: 'cymbal', label: 'Cymbal' },
  { id: 'low_tom', label: 'Low Tom' },
  { id: 'high_tom', label: 'High Tom' }
];

const STEPS = 16;

const state = {
  bpm: 120,
  playing: false,
  position: 0,
  grid: null
};

const headsEl = document.querySelector('#heads');
const playBtn = document.querySelector('#play');
const stopBtn = document.querySelector('#stop');
const bpmDisplay = document.querySelector('#bpm-display');
const bpmUp = document.querySelector('#bpm-up');
const bpmDown = document.querySelector('#bpm-down');
const reverbWet = document.querySelector('#reverb-wet');
const reverbDecay = document.querySelector('#reverb-decay');
const accentInput = document.querySelector('#accent');
const clearBtn = document.querySelector('#clear');
const randomBtn = document.querySelector('#random');
const recordBtn = document.querySelector('#record');
const meterEl = document.querySelector('#meter');

let reverb, master;
let synths = {}; // per-instrument synths

// recording
let mediaDest = null;
let mediaRecorder = null;
let recordedChunks = [];
let recording = false;

function buildGrid(){
  const grid = {};
  INSTRUMENTS.forEach(inst=>{
    grid[inst.id] = new Array(STEPS).fill(false);
  });
  return grid;
}

function createUI(){
  state.grid = buildGrid();

  INSTRUMENTS.forEach(inst=>{
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = inst.label;
    row.appendChild(label);

    const steps = document.createElement('div');
    steps.className = 'steps';
    for(let i=0;i<STEPS;i++){
      const s = document.createElement('button');
      s.className = 'step';
      s.dataset.inst = inst.id;
      s.dataset.step = i;
      s.addEventListener('click', onStepClick);
      steps.appendChild(s);
    }
    row.appendChild(steps);
    headsEl.appendChild(row);
  });
}

function onStepClick(e){
  const btn = e.currentTarget;
  const inst = btn.dataset.inst;
  const step = Number(btn.dataset.step);
  state.grid[inst][step] = !state.grid[inst][step];
  btn.classList.toggle('on', state.grid[inst][step]);
  if (navigator.vibrate) navigator.vibrate(8);
}

function setupAudio(){
  master = new Tone.Gain(0.9).toDestination();
  reverb = new Tone.Reverb({ decay: Number(reverbDecay.value), wet: Number(reverbWet.value) }).toDestination();
  // route master -> reverb -> destination (dry+wet)
  master.connect(reverb);
  master.connect(Tone.Destination);

  // setup MediaStream destination for recording (connect master and reverb to it)
  if (!mediaDest) mediaDest = Tone.getContext().rawContext.createMediaStreamDestination();

  // Connect master to mediaDest (raw node fallback)
  try {
    master.connect({ input: mediaDest });
  } catch (e) {
    const rawMaster = master.output ? master.output : master;
    if (rawMaster && rawMaster.connect) rawMaster.connect(mediaDest);
  }
  // Also connect the reverb output into the media destination so wet signal is captured
  try {
    if (reverb && reverb.output && reverb.output.connect) {
      reverb.output.connect(mediaDest);
    } else if (reverb && reverb.connect) {
      reverb.connect({ input: mediaDest });
    }
  } catch (e) {
    const rawReverb = reverb.output ? reverb.output : reverb;
    if (rawReverb && rawReverb.connect) rawReverb.connect(mediaDest);
  }

  // Instruments
  // Bass drum
  const bass = new Tone.MembraneSynth({
    pitchDecay: 0.01,
    octaves: 10,
    envelope:{attack:0.001,decay:0.4,sustain:0.0}
  }).connect(master);

  // Snare: noise + body
  const snareNoise = new Tone.NoiseSynth({ volume:-6, envelope:{attack:0.001,decay:0.18}}).connect(master);
  const snareBody = new Tone.MetalSynth({ frequency:200, envelope:{attack:0.001,decay:0.2,release:0.01}, volume:-4 }).connect(master);

  // Closed hi-hat: short metallic (use a high pitched note, short duration, audible volume)
  const closed_hh = new Tone.MetalSynth({
    volume: -2,
    envelope: { attack: 0.001, decay: 0.06, release: 0.01 },
    harmonicity: 6
  }).connect(master);

  // Open hi-hat: longer decay, slightly louder so it reads over mix
  const open_hh = new Tone.MetalSynth({
    volume: -1,
    envelope: { attack: 0.001, decay: 0.28, release: 0.02 },
    harmonicity: 5
  }).connect(master);

  // Cymbal (brighter metal synth) with a clear pitched hit and more presence
  const cymbal = new Tone.MetalSynth({
    volume: -0.5,
    envelope: { attack: 0.001, decay: 0.9, release: 0.05 },
    harmonicity: 8
  }).connect(master);

  // Toms
  const low_tom = new Tone.MembraneSynth({pitchDecay:0.02,octaves:2,envelope:{attack:0.001,decay:0.38}}).connect(master);
  const high_tom = new Tone.MembraneSynth({pitchDecay:0.02,octaves:4,envelope:{attack:0.001,decay:0.28}}).connect(master);

  synths = { bass, snareNoise, snareBody, closed_hh, open_hh, cymbal, low_tom, high_tom };

  Tone.Transport.bpm.value = state.bpm;
  Tone.Transport.scheduleRepeat(repeat, '16n');
}

function repeat(time){
  const step = state.position % STEPS;
  document.querySelectorAll('.step').forEach(el=>{
    el.classList.toggle('active', Number(el.dataset.step) === step);
  });

  INSTRUMENTS.forEach(inst=>{
    if (state.grid[inst.id][step]) {
      triggerInstrument(inst.id, time);
    }
  });

  // meter
  const pct = ((step+1)/STEPS)*100;
  let bar = meterEl._bar;
  if (!bar) {
    bar = document.createElement('div');
    bar.style.height = '100%';
    bar.style.width = '0%';
    bar.style.background = 'linear-gradient(90deg,var(--accent),#ffd19a)';
    bar.style.transition = 'width 0.06s linear';
    meterEl.appendChild(bar);
    meterEl._bar = bar;
  }
  const fillWidth = Math.max(6, Math.round((pct/100)*100));
  bar.style.width = `${fillWidth}%`;

  state.position++;
}

function triggerInstrument(id, time){
  // accent knob scales velocity (0.4..1.0) and allows stronger hits for bass/snare/toms
  const accent = accentInput ? Number(accentInput.value) : 0.9;
  const baseVel = 0.9;
  const vel = Math.max(0.1, baseVel * accent);

  switch(id){
    case 'bass':
      synths.bass.triggerAttackRelease('C1', '8n', time, vel);
      break;
    case 'snare':
      synths.snareNoise.triggerAttackRelease('16n', time, Math.min(1, vel));
      synths.snareBody.triggerAttackRelease('8n', time, Math.min(0.7, vel*0.7));
      break;
    case 'closed_hh':
      // play a high pitched short note for closed hi-hat
      synths.closed_hh.triggerAttackRelease('C6', '16n', time, 0.6 * vel);
      break;
    case 'open_hh':
      // longer decay for open hi-hat
      synths.open_hh.triggerAttackRelease('C6', '8n', time, 0.7 * vel);
      break;
    case 'cymbal':
      // cymbal as a longer pitched metal hit
      synths.cymbal.triggerAttackRelease('C5', '1n', time, 0.85 * vel);
      break;
    case 'low_tom':
      synths.low_tom.triggerAttackRelease('C2', '8n', time, 0.9 * vel);
      break;
    case 'high_tom':
      synths.high_tom.triggerAttackRelease('C3', '8n', time, 0.95 * vel);
      break;
  }
}

function start(){
  if (!Tone.context) return;
  if (!reverb) setupAudio();
  Tone.start();
  Tone.Transport.start();
  state.playing = true;
  playBtn.style.background = '#ffb08a';
  playBtn.textContent = '⏸';
}

function stop(){
  Tone.Transport.stop();
  state.playing = false;
  state.position = 0;
  playBtn.style.background = 'var(--accent)';
  playBtn.textContent = '▶';
  document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
}

function initControls(){
  bpmDisplay.textContent = state.bpm;
  bpmUp.addEventListener('click', ()=>{ state.bpm = Math.min(260, state.bpm+1); Tone.Transport.bpm.value = state.bpm; bpmDisplay.textContent = state.bpm; });
  bpmDown.addEventListener('click', ()=>{ state.bpm = Math.max(40, state.bpm-1); Tone.Transport.bpm.value = state.bpm; bpmDisplay.textContent = state.bpm; });
  playBtn.addEventListener('click', async ()=>{
    if (!state.playing){
      await Tone.start();
      if (!reverb) setupAudio();
      start();
    } else {
      Tone.Transport.pause();
      state.playing = false;
      playBtn.textContent = '▶';
      playBtn.style.background = 'var(--accent)';
    }
  });
  stopBtn.addEventListener('click', ()=> stop());

  reverbWet.addEventListener('input', ()=>{ if (reverb) reverb.wet.value = Number(reverbWet.value); });
  reverbDecay.addEventListener('input', ()=>{ if (reverb) reverb.decay = Number(reverbDecay.value); });

  // Recording controls
  recordBtn.addEventListener('click', async ()=>{
    if (!recording) {
      await Tone.start();
      if (!reverb) setupAudio();
      start(); // play while recording
      startRecording();
    } else {
      stopRecording();
    }
  });

  clearBtn.addEventListener('click', ()=>{
    INSTRUMENTS.forEach(inst=>{
      state.grid[inst.id].fill(false);
    });
    document.querySelectorAll('.step').forEach(el=>el.classList.remove('on'));
  });

  randomBtn.addEventListener('click', ()=>{
    INSTRUMENTS.forEach(inst=>{
      for(let i=0;i<STEPS;i++){
        const on = Math.random() > 0.7;
        state.grid[inst.id][i] = on;
      }
    });
    document.querySelectorAll('.step').forEach(el=>{
      const inst = el.dataset.inst;
      const step = Number(el.dataset.step);
      el.classList.toggle('on', state.grid[inst][step]);
    });
  });

  // accent updates a knob only (no per-step accents yet)
  if (accentInput) {
    accentInput.addEventListener('input', ()=>{/* value read on trigger */});
  }
}

function hydrateFromHash(){
  try{
    const hash = location.hash.slice(1);
    if (!hash) return;
    const parts = hash.split(';');
    parts.forEach((p,i)=>{
      if (INSTRUMENTS[i]){
        for(let s=0;s<Math.min(STEPS,p.length);s++){
          state.grid[INSTRUMENTS[i].id][s] = p[s] === '1';
        }
      }
    });
    document.querySelectorAll('.step').forEach(el=>{
      const inst = el.dataset.inst;
      const step = Number(el.dataset.step);
      el.classList.toggle('on', state.grid[inst][step]);
    });
  }catch(e){}
}

function startRecording(){
  if (!mediaDest) {
    mediaDest = Tone.getContext().rawContext.createMediaStreamDestination();
    // best-effort connect if master exists
    if (master && master.output && master.output.connect) master.output.connect(mediaDest);
    // also ensure reverb is connected so wet is recorded
    try {
      if (reverb && reverb.output && reverb.output.connect) reverb.output.connect(mediaDest);
    } catch(e){}
  }
  recordedChunks = [];
  try {
    mediaRecorder = new MediaRecorder(mediaDest.stream);
  } catch(e) {
    alert('Recording not supported in this browser.');
    return;
  }
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g,'-');
    a.download = `rolando666-${ts}.wav`;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1500);
  };
  mediaRecorder.start();
  recording = true;
  recordBtn.classList.add('recording');
  recordBtn.textContent = '■ STOP';
}

function stopRecording(){
  if (mediaRecorder && recording) {
    mediaRecorder.stop();
  }
  recording = false;
  recordBtn.classList.remove('recording');
  recordBtn.textContent = '● REC';
}

function startup(){
  createUI();
  initControls();
  hydrateFromHash();
}

startup();
