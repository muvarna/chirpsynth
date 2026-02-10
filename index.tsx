import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { 
  Upload, Activity, Waves, Volume2, Bird, RefreshCw, Info, 
  Keyboard, Square, Download, Circle, Loader2, Play, Music, 
  Search, X, FolderOpen, ChevronRight, Zap, Wind, Layers 
} from 'lucide-react';

/** --- TYPES --- **/
export interface AudioSample {
  id: string;
  name: string;
  midiNote: number;
  frequency: number;
  buffer: AudioBuffer;
  startTime: number;
  endTime: number;
  confidence: number;
}

export interface AnalysisProgress {
  status: 'idle' | 'loading' | 'analyzing' | 'completed' | 'error';
  progress: number;
  message: string;
}

export interface PitchData {
  time: number;
  frequency: number;
  rms: number;
  clarity: number;
}

const MIDI_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** --- CONSTANTS --- **/
const BIRD_REPO_BASE = "https://raw.githubusercontent.com/muvarna/bird-signals/main/";
const BIRD_FILES = [
  "03 Downy Woodpecker Calls.mp3", "04 Downy Woodpecker Drum.mp3", "07 Northern Flicker Drum.mp3",
  "08 Steller's Jay Call.mp3", "09 Steller's Jay Calls.mp3", "11 Black-capped Chickadee Song.mp3",
  "12 Black-capped Chickadee Call.mp3", "14 White-breasted Nuthatch Call 1.mp3",
  "16 White-crowned Sparrow Song 1.mp3", "17 White-crowned Sparrow Song 2.mp3",
  "18 White-crowned Sparrow Call.mp3", "19 Red-winged Blackbird Song.mp3",
  "20 Red-winged Blackbird Calls.mp3", "23 House Finch Song.mp3",
  "25 Pine Siskin Song, Calls.mp3", "27 Evening Grosbeak Calls.mp3"
];

// 2-Octave Computer Key Mapping (C3 to C5)
const COMPUTER_KEY_MAP: Record<string, number> = {
  // Octave 1: Z row
  'z': 48, 's': 49, 'x': 50, 'd': 51, 'c': 52, 'v': 53, 'g': 54, 'b': 55, 'h': 56, 'n': 57, 'j': 58, 'm': 59, ',': 60,
  // Octave 2: Q row
  'q': 60, '2': 61, 'w': 62, '3': 63, 'e': 64, 'r': 65, '5': 66, 't': 67, '6': 68, 'y': 69, '7': 70, 'u': 71, 'i': 72
};

const PIANO_KEY_LABELS: Record<number, string> = {
  48: 'Z', 49: 'S', 50: 'X', 51: 'D', 52: 'C', 53: 'V', 54: 'G', 55: 'B', 56: 'H', 57: 'N', 58: 'J', 59: 'M',
  60: 'Q', 61: '2', 62: 'W', 63: '3', 64: 'E', 65: 'R', 66: '5', 67: 'T', 68: '6', 69: 'Y', 70: '7', 71: 'U', 72: 'I'
};

/** --- DSP UTILITIES --- **/
function detectPitch(buffer: Float32Array, sampleRate: number): { frequency: number; confidence: number } {
  const SIZE = buffer.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);
  let bestOffset = -1;
  let bestCorrelation = 0;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return { frequency: -1, confidence: 0 };
  for (let offset = Math.floor(sampleRate / 2000); offset < Math.floor(sampleRate / 50); offset++) {
    let correlation = 0;
    for (let i = 0; i < MAX_SAMPLES; i++) correlation += Math.abs(buffer[i] - buffer[i + offset]);
    correlation = 1 - (correlation / MAX_SAMPLES);
    if (correlation > bestCorrelation) { bestCorrelation = correlation; bestOffset = offset; }
  }
  if (bestCorrelation < 0.8) return { frequency: -1, confidence: bestCorrelation };
  return { frequency: sampleRate / bestOffset, confidence: bestCorrelation };
}

function freqToMidi(f: number): number { return Math.round(69 + 12 * Math.log2(f / 440)); }
function midiToNoteName(midi: number): string { return MIDI_NOTES[midi % 12] + (Math.floor(midi / 12) - 1); }

async function extractStableSamples(audioBuffer: AudioBuffer, onProgress: (p: number) => void): Promise<AudioSample[]> {
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.1);
  const hopSize = Math.floor(windowSize / 2);
  const stableDurationThreshold = 3;
  const samples: AudioSample[] = [];
  const pitchSeries: PitchData[] = [];

  for (let i = 0; i < data.length - windowSize; i += hopSize) {
    const slice = data.slice(i, i + windowSize);
    const { frequency, confidence } = detectPitch(slice, sampleRate);
    let rms = 0;
    for (let j = 0; j < slice.length; j++) rms += slice[j] * slice[j];
    pitchSeries.push({ time: i / sampleRate, frequency, rms: Math.sqrt(rms / slice.length), clarity: confidence });
    if (i % (hopSize * 20) === 0) onProgress((i / data.length) * 0.5);
  }

  let currentSegment: PitchData[] = [];
  const processSegment = (seg: PitchData[]) => {
    if (seg.length >= stableDurationThreshold) {
      const avgFreq = seg.reduce((acc, val) => acc + val.frequency, 0) / seg.length;
      const midi = freqToMidi(avgFreq);
      const startIdx = Math.floor(seg[0].time * sampleRate);
      const endIdx = Math.floor((seg[seg.length - 1].time + (windowSize / sampleRate)) * sampleRate);
      const sub = new AudioBuffer({ length: endIdx - startIdx, numberOfChannels: 1, sampleRate });
      sub.copyToChannel(data.slice(startIdx, endIdx), 0);
      const existing = samples.find(s => s.midiNote === midi);
      if (!existing || seg.length > (existing.endTime - existing.startTime) * (sampleRate / hopSize)) {
        const sampleObj = { id: Math.random().toString(36).substr(2, 9), name: midiToNoteName(midi), midiNote: midi, frequency: avgFreq, buffer: sub, startTime: seg[0].time, endTime: seg[seg.length-1].time, confidence: 1.0 };
        const idx = samples.indexOf(existing!);
        if (idx !== -1) samples[idx] = sampleObj; else samples.push(sampleObj);
      }
    }
  };

  pitchSeries.forEach(p => {
    if (p.frequency > 0 && p.clarity > 0.85) {
      if (currentSegment.length > 0) {
        const avg = currentSegment.reduce((a, v) => a + v.frequency, 0) / currentSegment.length;
        if (Math.abs(p.frequency - avg) / avg < 0.05) currentSegment.push(p);
        else { processSegment(currentSegment); currentSegment = [p]; }
      } else currentSegment = [p];
    } else { processSegment(currentSegment); currentSegment = []; }
  });
  onProgress(1.0);
  return samples.sort((a, b) => a.midiNote - b.midiNote);
}

/** --- COMPONENTS --- **/

const PianoKeyboard = ({ onNoteOn, onNoteOff, mappedNotes, activeNotes }: any) => {
  // 2-Octave strictly (C3 to C5)
  const startNote = 48, endNote = 72;
  const keys = useMemo(() => {
    const list = [];
    for (let i = startNote; i <= endNote; i++) list.push({ midi: i, isBlack: [1, 3, 6, 8, 10].includes(i % 12) });
    return list;
  }, []);

  return (
    <div className="flex w-full overflow-x-auto pb-4 justify-center bg-slate-900 p-8 rounded-xl border border-slate-800 shadow-2xl select-none">
      <div className="flex relative h-64 min-w-max">
        {keys.map((key) => {
          const isMapped = mappedNotes.has(key.midi);
          const isActive = activeNotes.has(key.midi);
          const label = PIANO_KEY_LABELS[key.midi];
          if (key.isBlack) return (
            <div key={key.midi} onMouseDown={() => onNoteOn(key.midi)} onMouseUp={() => onNoteOff(key.midi)}
              className={`absolute w-8 h-40 z-10 -ml-4 rounded-b-md cursor-pointer transition-all flex flex-col justify-end items-center pb-2 ${isActive ? 'bg-cyan-400' : 'bg-slate-950'} ${isMapped ? 'border-b-4 border-emerald-400' : 'border-b-2 border-slate-700'} hover:bg-slate-800`}
              style={{ left: `${(keys.filter(k => !k.isBlack && k.midi < key.midi).length) * 3.5}rem` }}
            >
              {label && <span className={`text-[10px] font-black mono ${isActive ? 'text-slate-950' : 'text-slate-600'}`}>[{label}]</span>}
            </div>
          );
          return (
            <div key={key.midi} onMouseDown={() => onNoteOn(key.midi)} onMouseUp={() => onNoteOff(key.midi)}
              className={`w-14 h-64 border border-slate-800 rounded-b-lg cursor-pointer transition-all flex flex-col justify-end items-center pb-4 ${isActive ? 'bg-cyan-100' : 'bg-slate-100'} ${isMapped ? 'ring-inset ring-2 ring-emerald-500' : ''} hover:bg-white`}
            >
              <div className="flex flex-col items-center space-y-1">
                {label && <span className={`text-[10px] font-black mono ${isActive ? 'text-cyan-600' : 'text-slate-400'}`}>[{label}]</span>}
                <span className="text-[10px] font-bold text-slate-400 uppercase">{midiToNoteName(key.midi)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SampleList = ({ samples, onPlaySample }: any) => {
  if (samples.length === 0) return (
    <div className="flex flex-col items-center justify-center p-12 bg-slate-900/50 rounded-xl border border-dashed border-slate-700">
      <Info className="w-12 h-12 text-slate-600 mb-4" />
      <p className="text-slate-400 text-center">No stable segments detected.<br/>Load a bio-signal to start.</p>
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {samples.map((s: any) => (
        <div key={s.id} className="group bg-slate-900 border border-slate-800 p-4 rounded-xl hover:border-cyan-500/50 transition-all flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-cyan-950 rounded-lg flex items-center justify-center text-cyan-400 border border-cyan-800"><Music className="w-6 h-6" /></div>
            <div><h4 className="font-bold text-slate-200">{s.name}</h4><p className="text-xs text-slate-500 mono">{s.frequency.toFixed(2)} Hz</p></div>
          </div>
          <button onClick={() => onPlaySample(s)} className="p-3 rounded-full bg-slate-800 text-slate-400 hover:bg-cyan-500 hover:text-white transition-colors"><Play className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
};

const BioRepositoryBrowser = ({ isOpen, onClose, onLoadBird }: any) => {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => BIRD_FILES.filter(f => f.toLowerCase().includes(search.toLowerCase())), [search]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3"><FolderOpen className="w-5 h-5 text-cyan-400" /><h2 className="text-xl font-black italic uppercase text-white">Bio-Repository</h2></div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 bg-slate-950/50">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" placeholder="Filter signals..." className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm focus:border-cyan-500 outline-none text-white" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="flex-grow overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {filtered.map((bird) => (
            <button key={bird} onClick={() => onLoadBird(bird)} className="w-full flex items-center justify-between p-4 rounded-2xl bg-slate-800/30 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800/50 transition-all group">
              <div className="flex items-center space-x-4"><div className="p-2 bg-slate-950 rounded-lg group-hover:bg-cyan-950 text-slate-500 group-hover:text-cyan-400"><Bird className="w-5 h-5" /></div><span className="text-sm font-bold text-slate-300 group-hover:text-white truncate">{bird.replace('.mp3', '')}</span></div>
              <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 transition-all" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [samples, setSamples] = useState<AudioSample[]>([]);
  const [status, setStatus] = useState<AnalysisProgress>({ status: 'idle', progress: 0, message: 'Bio-engine ready' });
  const [activeMidiNotes, setActiveMidiNotes] = useState<Set<number>>(new Set());
  const [activeFileName, setActiveFileName] = useState<string>("Detecting Source...");
  const [isRecording, setIsRecording] = useState(false);
  const [isEncoding, setIsEncoding] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [fxState, setFxState] = useState({ delay: false, reverb: false });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterBusRef = useRef<GainNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const recordedPCMRef = useRef<Float32Array[]>([]);
  
  const delayWetRef = useRef<GainNode | null>(null);
  const reverbWetRef = useRef<GainNode | null>(null);

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;
      const master = ctx.createGain(); master.connect(ctx.destination); masterBusRef.current = master;

      const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.4;
      const feedback = ctx.createGain(); feedback.gain.value = 0.4;
      const dWet = ctx.createGain(); dWet.gain.value = 0;
      master.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(dWet); dWet.connect(ctx.destination);
      delayWetRef.current = dWet;

      const reverb = ctx.createConvolver(); const rWet = ctx.createGain(); rWet.gain.value = 0;
      const length = ctx.sampleRate * 2; const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
      for (let i = 0; i < 2; i++) { const data = buffer.getChannelData(i); for (let j = 0; j < length; j++) data[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 2); }
      reverb.buffer = buffer; master.connect(reverb); reverb.connect(rWet); rWet.connect(ctx.destination);
      reverbWetRef.current = rWet;
    }
    return audioCtxRef.current;
  }, []);

  const toggleFx = (type: 'delay' | 'reverb') => {
    const ctx = getAudioCtx(); if (ctx.state === 'suspended') ctx.resume();
    setFxState(prev => {
      const next = { ...prev, [type]: !prev[type] };
      const node = type === 'delay' ? delayWetRef.current : reverbWetRef.current;
      if (node) node.gain.setTargetAtTime(next[type] ? 0.5 : 0, ctx.currentTime, 0.03);
      return next;
    });
  };

  const processAudioData = async (arrayBuffer: ArrayBuffer, name: string) => {
    const ctx = getAudioCtx(); if (ctx.state === 'suspended') ctx.resume();
    setActiveFileName(name.replace('.mp3', '').replace('.wav', ''));
    setStatus({ status: 'loading', progress: 0.1, message: 'Decoding audio stream...' });
    try {
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      setStatus({ status: 'analyzing', progress: 0.2, message: 'Extracting Bio-samples...' });
      const extracted = await extractStableSamples(decodedBuffer, p => setStatus(prev => ({ ...prev, progress: 0.2 + (p * 0.8) })));
      setSamples(extracted);
      setStatus({ status: 'completed', progress: 1.0, message: `System online: ${extracted.length} samples extracted` });
    } catch (err) { setStatus({ status: 'error', progress: 0, message: 'DSP Pipeline Error' }); }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (file) processAudioData(await file.arrayBuffer(), file.name);
  };

  const loadBirdFromRepo = useCallback((filename: string) => {
    setIsBrowserOpen(false); setStatus({ status: 'loading', progress: 0.05, message: 'Fetching from repository...' });
    fetch(`${BIRD_REPO_BASE}${encodeURIComponent(filename)}`).then(r => r.arrayBuffer()).then(buf => processAudioData(buf, filename));
  }, []);

  useEffect(() => {
    const randomBird = BIRD_FILES[Math.floor(Math.random() * BIRD_FILES.length)];
    const timer = setTimeout(() => loadBirdFromRepo(randomBird), 500); return () => clearTimeout(timer);
  }, [loadBirdFromRepo]);

  const playNote = useCallback((midi: number) => {
    if (samples.length === 0) return;
    const ctx = getAudioCtx(); if (ctx.state === 'suspended') ctx.resume();
    let nearest = samples[0]; let minDiff = Math.abs(samples[0].midiNote - midi);
    samples.forEach(s => { const d = Math.abs(s.midiNote - midi); if (d < minDiff) { minDiff = d; nearest = s; } });
    const source = ctx.createBufferSource(); source.buffer = nearest.buffer;
    source.playbackRate.value = Math.pow(2, (midi - nearest.midiNote) / 12);
    const gain = ctx.createGain(); gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);
    source.connect(gain); if (masterBusRef.current) gain.connect(masterBusRef.current);
    source.start(); setActiveMidiNotes(prev => new Set(prev).add(midi));
    source.onended = () => setActiveMidiNotes(prev => { const n = new Set(prev); n.delete(midi); return n; });
  }, [samples, getAudioCtx]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent, isDown: boolean) => {
      if (e.target instanceof HTMLInputElement) return;
      const midi = COMPUTER_KEY_MAP[e.key.toLowerCase()]; if (!midi) return;
      if (isDown) { if (!e.repeat) { e.preventDefault(); playNote(midi); } }
      else setActiveMidiNotes(prev => { const n = new Set(prev); n.delete(midi); return n; });
    };
    const down = (e: KeyboardEvent) => handleKey(e, true);
    const up = (e: KeyboardEvent) => handleKey(e, false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [playNote]);

  const startRecording = () => {
    const ctx = getAudioCtx(); const node = ctx.createScriptProcessor(4096, 1, 1);
    recordedPCMRef.current = []; node.onaudioprocess = e => recordedPCMRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    masterBusRef.current?.connect(node); node.connect(ctx.destination);
    scriptNodeRef.current = node; setIsRecording(true); setRecordedUrl(null);
  };

  const stopRecording = async () => {
    setIsRecording(false); setIsEncoding(true);
    const node = scriptNodeRef.current; if (node) { node.onaudioprocess = null; masterBusRef.current?.disconnect(node); node.disconnect(); }
    try {
      const chunks = recordedPCMRef.current;
      const pcm = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
      let off = 0; chunks.forEach(c => { pcm.set(c, off); off += c.length; });
      const i16 = new Int16Array(pcm.length); for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; }
      const enc = new (window as any).lamejs.Mp3Encoder(1, getAudioCtx().sampleRate, 128);
      const data = []; for (let i = 0; i < i16.length; i += 1152) { const b = enc.encodeBuffer(i16.subarray(i, i + 1152)); if (b.length > 0) data.push(new Uint8Array(b)); }
      const f = enc.flush(); if (f.length > 0) data.push(new Uint8Array(f));
      setRecordedUrl(URL.createObjectURL(new Blob(data, { type: 'audio/mp3' })));
    } finally { setIsEncoding(false); }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-cyan-500/30 overflow-x-hidden">
      <BioRepositoryBrowser isOpen={isBrowserOpen} onClose={() => setIsBrowserOpen(false)} onLoadBird={loadBirdFromRepo} />
      
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50 h-20">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-full flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-cyan-500 rounded-lg shadow-lg shadow-cyan-500/20"><Bird className="w-6 h-6 text-slate-950" /></div>
            <div>
              <h1 className="text-lg font-black uppercase italic text-white leading-none">ChirpSynth</h1>
              <p className="text-[10px] mono text-cyan-400 font-bold uppercase tracking-widest leading-none">Bio-Sampler Pro</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 md:space-x-4">
            <button onClick={() => setIsBrowserOpen(true)} className="flex items-center space-x-2 bg-slate-900 border border-slate-800 hover:border-cyan-500/50 px-4 py-2 rounded-full text-[10px] font-black uppercase italic text-cyan-400 transition-all"><FolderOpen className="w-4 h-4" /><span>Library</span></button>
            
            {/* PERMANENTLY VISIBLE LOAD BUTTON */}
            <label className="cursor-pointer group flex items-center">
              <input type="file" accept="audio/mp3,audio/wav" onChange={handleFileUpload} className="hidden" />
              <div className="bg-white hover:bg-cyan-500 hover:text-white text-slate-950 px-5 py-2.5 rounded-full font-black text-[10px] uppercase flex items-center space-x-2 transition-all shadow-2xl scale-100 active:scale-95">
                <Upload className="w-4 h-4" />
                <span>Load Signal</span>
              </div>
            </label>

            <div className="flex items-center space-x-1 bg-slate-950/50 p-1 rounded-full border border-slate-800">
              {!isRecording ? (
                <button onClick={startRecording} disabled={samples.length === 0 || isEncoding} className="flex items-center px-3 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-red-500 font-bold text-[10px] space-x-2 disabled:opacity-30">
                  {isEncoding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Circle className="w-3 h-3 fill-red-500" />}
                  <span className="hidden sm:inline">REC</span>
                </button>
              ) : (
                <button onClick={stopRecording} className="flex items-center px-3 py-1.5 rounded-full bg-red-500 text-white font-bold text-[10px] animate-pulse space-x-2">
                  <Square className="w-3 h-3 fill-white" /><span>STOP</span>
                </button>
              )}
              {recordedUrl && <a href={recordedUrl} download="chirp.mp3" className="p-1.5 rounded-full bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors"><Download className="w-3.5 h-3.5" /></a>}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto w-full p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
          {(status.status === 'analyzing' || status.status === 'loading') && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex justify-between mb-4"><h3 className="font-bold flex items-center space-x-2"><Activity className="w-4 h-4 text-cyan-400" /><span>DSP PIPELINE ACTIVE</span></h3><span className="mono text-cyan-400">{(status.progress * 100).toFixed(0)}%</span></div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-cyan-500 transition-all duration-300" style={{ width: `${status.progress * 100}%` }} /></div>
              <p className="mt-4 text-xs text-slate-400 italic">“{status.message}”</p>
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 relative overflow-hidden h-64 flex flex-col justify-end">
            <div className="absolute top-4 left-4 z-10 flex flex-col space-y-2">
              <div className="flex items-center space-x-2 bg-slate-950/80 px-3 py-1 rounded-full border border-slate-700 text-[10px] font-bold mono uppercase text-cyan-400"><Waves className="w-3 h-3" /><span>Bio_Stream_Active</span></div>
              <div className="flex items-center space-x-2 bg-cyan-500/10 px-3 py-1.5 rounded-full border border-cyan-500/40 text-[11px] font-black mono text-cyan-400 uppercase tracking-tight backdrop-blur-md"><Music className="w-3.5 h-3.5" /><span>Source: {activeFileName}</span></div>
            </div>
            <div className="h-full flex items-end justify-center space-x-1 pt-12">
              {[...Array(60)].map((_, i) => (
                <div key={i} className={`w-1 bg-cyan-500/20 rounded-t-full transition-all duration-300 ${activeMidiNotes.size > 0 ? 'animate-pulse' : ''}`} style={{ height: `${20 + (activeMidiNotes.size > 0 ? Math.random() * 80 : 20)}%`, opacity: 0.1 + (i / 60) * 0.5 }} />
              ))}
            </div>
          </div>

          <section className="space-y-4">
            <h2 className="text-lg font-black uppercase italic flex items-center space-x-2 text-white"><Volume2 className="w-5 h-5 text-cyan-400" /><span>Sampler Engine</span></h2>
            <PianoKeyboard onNoteOn={playNote} onNoteOff={() => {}} mappedNotes={new Set(samples.map(s => s.midiNote))} activeNotes={activeMidiNotes} />
          </section>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <h2 className="font-black uppercase italic text-sm flex items-center space-x-2 text-white"><Zap className="w-4 h-4 text-cyan-400" /><span>Bio-FX Rack</span></h2>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => toggleFx('delay')} className={`p-4 rounded-xl border flex flex-col items-center justify-center space-y-2 transition-all ${fxState.delay ? 'bg-cyan-500/10 border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'bg-slate-800/50 border-slate-800 text-slate-500'}`}><Wind className="w-6 h-6" /><span className="text-[10px] font-black uppercase italic">Echo</span></button>
              <button onClick={() => toggleFx('reverb')} className={`p-4 rounded-xl border flex flex-col items-center justify-center space-y-2 transition-all ${fxState.reverb ? 'bg-pink-500/10 border-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.3)]' : 'bg-slate-800/50 border-slate-800 text-slate-500'}`}><Layers className="w-6 h-6" /><span className="text-[10px] font-black uppercase italic">Space</span></button>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col shadow-2xl h-[450px]">
            <div className="flex items-center justify-between mb-6"><h2 className="font-black uppercase italic text-sm flex items-center space-x-2 text-white"><RefreshCw className="w-4 h-4 text-cyan-400" /><span>Notes</span></h2><span className="bg-slate-950 px-2 py-0.5 rounded text-[10px] mono text-cyan-500 border border-cyan-900 font-bold">{samples.length}</span></div>
            <div className="flex-grow overflow-y-auto custom-scrollbar"><SampleList samples={samples} onPlaySample={(s: any) => { const ctx = getAudioCtx(); const src = ctx.createBufferSource(); src.buffer = s.buffer; src.connect(masterBusRef.current!); src.start(); }} /></div>
          </div>
        </div>
      </main>
    </div>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) ReactDOM.createRoot(rootEl).render(<App />);
