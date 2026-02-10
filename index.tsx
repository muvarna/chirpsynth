import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { 
  Upload, Activity, Waves, Volume2, Bird, RefreshCw, Info, 
  Keyboard, Square, Download, Circle, Loader2, Play, Music, 
  Search, X, FolderOpen, ChevronRight, Zap, Wind, Layers 
} from 'lucide-react';
import { AudioSample, AnalysisProgress } from './types.ts';
import { extractStableSamples } from './services/dspService.ts';
import PianoKeyboard from './components/PianoKeyboard.tsx';
import SampleList from './components/SampleList.tsx';

/** --- CONSTANTS --- **/
const BIRD_REPO_BASE = "https://raw.githubusercontent.com/muvarna/bird-signals/main/";
const BIRD_FILES = [
  "03 Downy Woodpecker Calls.mp3",
  "04 Downy Woodpecker Drum.mp3",
  "07 Northern Flicker Drum.mp3",
  "08 Steller's Jay Call.mp3",
  "09 Steller's Jay Calls.mp3",
  "11 Black-capped Chickadee Song.mp3",
  "12 Black-capped Chickadee Call.mp3",
  "14 White-breasted Nuthatch Call 1.mp3",
  "16 White-crowned Sparrow Song 1.mp3",
  "17 White-crowned Sparrow Song 2.mp3",
  "18 White-crowned Sparrow Call.mp3",
  "19 Red-winged Blackbird Song.mp3",
  "20 Red-winged Blackbird Calls.mp3",
  "23 House Finch Song.mp3",
  "25 Pine Siskin Song, Calls.mp3",
  "27 Evening Grosbeak Calls.mp3"
];

const COMPUTER_KEY_MAP: Record<string, number> = {
  'z': 48, 's': 49, 'x': 50, 'd': 51, 'c': 52, 'v': 53, 'g': 54, 'b': 55, 'h': 56, 'n': 57, 'j': 58, 'm': 59, ',': 60,
  'q': 60, '2': 61, 'w': 62, '3': 63, 'e': 64, 'r': 65, '5': 66, 't': 67, '6': 68, 'y': 69, '7': 70, 'u': 71, 'i': 72
};

/** --- COMPONENTS --- **/

const BioRepositoryBrowser = ({ isOpen, onClose, onLoadBird }: any) => {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => BIRD_FILES.filter(f => f.toLowerCase().includes(search.toLowerCase())), [search]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <FolderOpen className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-black italic uppercase text-white tracking-tight">Bio-Repository</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 bg-slate-950/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              type="text" 
              placeholder="Filter bio-signals..." 
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm focus:border-cyan-500 outline-none transition-all text-white"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="flex-grow overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {filtered.length > 0 ? filtered.map((bird) => (
            <button 
              key={bird}
              onClick={() => onLoadBird(bird)}
              className="w-full flex items-center justify-between p-4 rounded-2xl bg-slate-800/30 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800/50 transition-all group"
            >
              <div className="flex items-center space-x-4">
                <div className="p-2 bg-slate-950 rounded-lg group-hover:bg-cyan-950 text-slate-500 group-hover:text-cyan-400 transition-colors">
                  <Bird className="w-5 h-5" />
                </div>
                <span className="text-sm font-bold text-slate-300 group-hover:text-white text-left truncate">
                  {bird.replace('.mp3', '')}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
            </button>
          )) : (
            <div className="p-12 text-center text-slate-500 text-sm italic">No matching signals found.</div>
          )}
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
  
  // FX Nodes
  const delayNodeRef = useRef<DelayNode | null>(null);
  const delayWetRef = useRef<GainNode | null>(null);
  const reverbNodeRef = useRef<ConvolverNode | null>(null);
  const reverbWetRef = useRef<GainNode | null>(null);

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;

      const master = ctx.createGain();
      master.connect(ctx.destination);
      masterBusRef.current = master;

      // Init Delay
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.4;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.4;
      const dWet = ctx.createGain();
      dWet.gain.value = 0;
      master.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(dWet);
      dWet.connect(ctx.destination);
      delayNodeRef.current = delay;
      delayWetRef.current = dWet;

      // Init Reverb
      const reverb = ctx.createConvolver();
      const rWet = ctx.createGain();
      rWet.gain.value = 0;
      const length = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
      for (let i = 0; i < 2; i++) {
        const data = buffer.getChannelData(i);
        for (let j = 0; j < length; j++) data[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 2);
      }
      reverb.buffer = buffer;
      master.connect(reverb);
      reverb.connect(rWet);
      rWet.connect(ctx.destination);
      reverbNodeRef.current = reverb;
      reverbWetRef.current = rWet;
    }
    return audioCtxRef.current;
  }, []);

  const toggleFx = (type: 'delay' | 'reverb') => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    setFxState(prev => {
      const next = { ...prev, [type]: !prev[type] };
      const node = type === 'delay' ? delayWetRef.current : reverbWetRef.current;
      if (node) node.gain.setTargetAtTime(next[type] ? 0.5 : 0, ctx.currentTime, 0.03);
      return next;
    });
  };

  const processAudioData = async (arrayBuffer: ArrayBuffer, name: string) => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    setActiveFileName(name.replace('.mp3', '').replace('.wav', ''));
    setStatus({ status: 'loading', progress: 0.1, message: 'Decoding audio stream...' });
    try {
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      setStatus({ status: 'analyzing', progress: 0.2, message: 'Extracting Bio-samples...' });
      const extracted = await extractStableSamples(decodedBuffer, p => setStatus(prev => ({ ...prev, progress: 0.2 + (p * 0.8) })));
      setSamples(extracted);
      setStatus({ status: 'completed', progress: 1.0, message: `System online: ${extracted.length} samples extracted` });
    } catch (err) {
      console.error(err);
      setStatus({ status: 'error', progress: 0, message: 'DSP Pipeline Error' });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    processAudioData(await file.arrayBuffer(), file.name);
  };

  const loadBirdFromRepo = useCallback((filename: string) => {
    setIsBrowserOpen(false);
    setStatus({ status: 'loading', progress: 0.05, message: 'Fetching from repository...' });
    fetch(`${BIRD_REPO_BASE}${encodeURIComponent(filename)}`)
      .then(r => r.arrayBuffer())
      .then(buf => processAudioData(buf, filename))
      .catch(() => setStatus({ status: 'error', progress: 0, message: 'Network Fetch Error' }));
  }, []);

  useEffect(() => {
    const randomBird = BIRD_FILES[Math.floor(Math.random() * BIRD_FILES.length)];
    const timer = setTimeout(() => loadBirdFromRepo(randomBird), 500);
    return () => clearTimeout(timer);
  }, [loadBirdFromRepo]);

  const playNote = useCallback((midi: number) => {
    if (samples.length === 0) return;
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    let nearest = samples[0];
    let minDiff = Math.abs(samples[0].midiNote - midi);
    samples.forEach(s => { const d = Math.abs(s.midiNote - midi); if (d < minDiff) { minDiff = d; nearest = s; } });
    const source = ctx.createBufferSource();
    source.buffer = nearest.buffer;
    source.playbackRate.value = Math.pow(2, (midi - nearest.midiNote) / 12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);
    source.connect(gain);
    if (masterBusRef.current) gain.connect(masterBusRef.current);
    source.start();
    setActiveMidiNotes(prev => new Set(prev).add(midi));
    source.onended = () => setActiveMidiNotes(prev => { const n = new Set(prev); n.delete(midi); return n; });
  }, [samples, getAudioCtx]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      const midi = COMPUTER_KEY_MAP[e.key.toLowerCase()];
      if (midi) { e.preventDefault(); playNote(midi); }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const midi = COMPUTER_KEY_MAP[e.key.toLowerCase()];
      if (midi) setActiveMidiNotes(prev => { const n = new Set(prev); n.delete(midi); return n; });
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [playNote]);

  const startRecording = () => {
    const ctx = getAudioCtx();
    const node = ctx.createScriptProcessor(4096, 1, 1);
    recordedPCMRef.current = [];
    node.onaudioprocess = e => recordedPCMRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    masterBusRef.current?.connect(node);
    node.connect(ctx.destination);
    scriptNodeRef.current = node;
    setIsRecording(true);
    setRecordedUrl(null);
  };

  const stopRecording = async () => {
    setIsRecording(false); setIsEncoding(true);
    const node = scriptNodeRef.current;
    if (node) { node.onaudioprocess = null; masterBusRef.current?.disconnect(node); node.disconnect(); }
    try {
      const chunks = recordedPCMRef.current;
      const pcm = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
      let off = 0; chunks.forEach(c => { pcm.set(c, off); off += c.length; });
      const i16 = new Int16Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; }
      const enc = new (window as any).lamejs.Mp3Encoder(1, getAudioCtx().sampleRate, 128);
      const data = [];
      for (let i = 0; i < i16.length; i += 1152) { const b = enc.encodeBuffer(i16.subarray(i, i + 1152)); if (b.length > 0) data.push(new Uint8Array(b)); }
      const f = enc.flush(); if (f.length > 0) data.push(new Uint8Array(f));
      setRecordedUrl(URL.createObjectURL(new Blob(data, { type: 'audio/mp3' })));
    } catch (e) { console.error(e); } finally { setIsEncoding(false); }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-cyan-500/30 overflow-x-hidden">
      <BioRepositoryBrowser isOpen={isBrowserOpen} onClose={() => setIsBrowserOpen(false)} onLoadBird={loadBirdFromRepo} />
      
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-20 flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-cyan-500 rounded-lg shadow-lg shadow-cyan-500/20"><Bird className="w-6 h-6 text-slate-950" /></div>
            <div className="hidden xs:block">
              <h1 className="text-lg md:text-xl font-black tracking-tighter uppercase italic text-white leading-none">ChirpSynth</h1>
              <p className="text-[10px] mono text-cyan-400 font-bold tracking-widest leading-tight uppercase">Bio-Sampler Pro</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 md:space-x-4">
            <button 
              onClick={() => setIsBrowserOpen(true)} 
              className="flex items-center space-x-2 bg-slate-900 border border-slate-800 hover:border-cyan-500/50 px-3 md:px-4 py-2 rounded-full text-[10px] font-black uppercase italic text-cyan-400 transition-all"
            >
              <FolderOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Repository</span>
            </button>

            {/* FIXED LOAD SIGNAL BUTTON */}
            <label className="cursor-pointer group flex items-center">
              <input type="file" accept="audio/mp3,audio/wav" onChange={handleFileUpload} className="hidden" />
              <div className="bg-white hover:bg-cyan-500 hover:text-white text-slate-950 px-4 py-2 rounded-full font-black text-[10px] uppercase flex items-center space-x-2 transition-all shadow-xl">
                <Upload className="w-4 h-4" />
                <span>Load Signal</span>
              </div>
            </label>

            <div className="flex items-center space-x-1 md:space-x-2 bg-slate-950/50 p-1 rounded-full border border-slate-800">
              {!isRecording ? (
                <button onClick={startRecording} disabled={samples.length === 0 || isEncoding} className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-red-500 font-bold text-[10px] disabled:opacity-30">
                  {isEncoding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Circle className="w-3 h-3 fill-red-500" />}
                  <span className="hidden sm:inline">{isEncoding ? 'WAIT' : 'REC'}</span>
                </button>
              ) : (
                <button onClick={stopRecording} className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-red-500 text-white font-bold text-[10px] animate-pulse">
                  <Square className="w-3 h-3 fill-white" />
                  <span className="hidden sm:inline">STOP</span>
                </button>
              )}
              {recordedUrl && (
                <a href={recordedUrl} download="chirp.mp3" className="flex items-center p-1.5 rounded-full bg-emerald-500 text-slate-950 transition-all hover:bg-emerald-400">
                  <Download className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto w-full p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
          {(status.status === 'analyzing' || status.status === 'loading') && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex justify-between mb-4">
                <h3 className="font-bold flex items-center space-x-2"><Activity className="w-4 h-4 text-cyan-400" /><span>DSP PIPELINE ACTIVE</span></h3>
                <span className="mono text-cyan-400">{(status.progress * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500 transition-all duration-300" style={{ width: `${status.progress * 100}%` }} />
              </div>
              <p className="mt-4 text-xs text-slate-400 italic">“{status.message}”</p>
            </div>
          )}

          {/* VISUALIZER SECTION WITH SOURCE NAME */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 relative overflow-hidden h-64 flex flex-col justify-end">
            <div className="absolute top-4 left-4 z-10 flex flex-col space-y-2">
               <div className="flex items-center space-x-2 bg-slate-950/80 px-3 py-1 rounded-full border border-slate-700">
                <Waves className="w-3 h-3 text-cyan-400" />
                <span className="text-[10px] font-bold mono uppercase">Bio_Stream_Active</span>
              </div>
              <div className="flex items-center space-x-2 bg-cyan-500/10 px-3 py-1.5 rounded-full border border-cyan-500/40 backdrop-blur-md">
                <Music className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[11px] font-black mono text-cyan-400 uppercase tracking-tight">System Source: {activeFileName}</span>
              </div>
            </div>
            <div className="h-full flex items-end justify-center space-x-1 pt-12">
              {[...Array(60)].map((_, i) => (
                <div key={i} className={`w-1 bg-cyan-500/20 rounded-t-full transition-all duration-300 ${activeMidiNotes.size > 0 ? 'animate-pulse' : ''}`}
                  style={{ height: `${20 + (activeMidiNotes.size > 0 ? Math.random() * 80 : 20)}%`, opacity: 0.1 + (i / 60) * 0.5 }}
                />
              ))}
            </div>
          </div>

          <section className="space-y-4">
            <h2 className="text-lg font-black uppercase italic flex items-center space-x-2 text-white">
              <Volume2 className="w-5 h-5 text-cyan-400" />
              <span>Sampler Engine</span>
            </h2>
            <PianoKeyboard onNoteOn={playNote} onNoteOff={() => {}} mappedNotes={new Set(samples.map(s => s.midiNote))} activeNotes={activeMidiNotes} />
          </section>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <h2 className="font-black uppercase italic text-sm flex items-center space-x-2 text-white">
              <Zap className="w-4 h-4 text-cyan-400" />
              <span>Bio-FX Rack</span>
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => toggleFx('delay')} className={`p-4 rounded-xl border flex flex-col items-center justify-center space-y-2 transition-all ${fxState.delay ? 'bg-cyan-500/10 border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'bg-slate-800/50 border-slate-800'}`}>
                <Wind className={`w-6 h-6 ${fxState.delay ? 'text-cyan-400 animate-pulse' : 'text-slate-500'}`} />
                <span className={`text-[10px] font-black uppercase italic ${fxState.delay ? 'text-cyan-400' : 'text-slate-500'}`}>Echo</span>
              </button>
              <button onClick={() => toggleFx('reverb')} className={`p-4 rounded-xl border flex flex-col items-center justify-center space-y-2 transition-all ${fxState.reverb ? 'bg-pink-500/10 border-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.3)]' : 'bg-slate-800/50 border-slate-800'}`}>
                <Layers className={`w-6 h-6 ${fxState.reverb ? 'text-pink-400 animate-pulse' : 'text-slate-500'}`} />
                <span className={`text-[10px] font-black uppercase italic ${fxState.reverb ? 'text-pink-400' : 'text-slate-500'}`}>Space</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col shadow-2xl h-[450px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-black uppercase italic text-sm flex items-center space-x-2 text-white">
                <RefreshCw className="w-4 h-4 text-cyan-400" />
                <span>Extracted Notes</span>
              </h2>
              <span className="bg-slate-950 px-2 py-0.5 rounded text-[10px] mono text-cyan-500 border border-cyan-900 font-bold">{samples.length}</span>
            </div>
            <div className="flex-grow overflow-y-auto custom-scrollbar">
              <SampleList samples={samples} onPlaySample={(s: any) => {
                const ctx = getAudioCtx(); const src = ctx.createBufferSource(); src.buffer = s.buffer; src.connect(masterBusRef.current!); src.start();
              }} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}
