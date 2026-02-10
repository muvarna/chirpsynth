import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { 
  Upload, Activity, Waves, Volume2, Bird, RefreshCw, Info, 
  Keyboard, Square, Download, Circle, Loader2, Play, Music, Link as LinkIcon, Globe, CheckCircle, Search, X, FolderOpen, ChevronRight
} from 'lucide-react';

/** --- CONSTANTS & TYPES --- **/
const MIDI_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const COMPUTER_KEY_MAP: Record<string, number> = {
  'z': 48, 's': 49, 'x': 50, 'd': 51, 'c': 52, 'v': 53, 'g': 54, 'b': 55, 'h': 56, 'n': 57, 'j': 58, 'm': 59, ',': 60,
  'q': 60, '2': 61, 'w': 62, '3': 63, 'e': 64, 'r': 65, '5': 66, 't': 67, '6': 68, 'y': 69, '7': 70, 'u': 71, 'i': 72
};

const KEY_LABELS: Record<number, string> = {
  48: 'Z', 49: 'S', 50: 'X', 51: 'D', 52: 'C', 53: 'V', 54: 'G', 55: 'B', 56: 'H', 57: 'N', 58: 'J', 59: 'M',
  60: 'Q', 61: '2', 62: 'W', 63: '3', 64: 'E', 65: 'R', 66: '5', 67: 'T', 68: '6', 69: 'Y', 70: '7', 71: 'U', 72: 'I'
};

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

/** --- UTILS --- **/
const convertToRawUrl = (url: string): string => {
  let processed = url.trim();
  if (processed.includes('github.com') && processed.includes('/blob/')) {
    processed = processed
      .replace('github.com', 'raw.githubusercontent.com')
      .replace('/blob/', '/');
  }
  return processed;
};

/** --- DSP UTILS --- **/
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
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  return { frequency: bestCorrelation > 0.8 ? sampleRate / bestOffset : -1, confidence: bestCorrelation };
}

function freqToMidi(f: number): number { return Math.round(69 + 12 * Math.log2(f / 440)); }
function midiToNoteName(midi: number): string { return MIDI_NOTES[midi % 12] + (Math.floor(midi / 12) - 1); }

async function extractStableSamples(audioBuffer: AudioBuffer, onProgress: (p: number) => void) {
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.1);
  const hopSize = Math.floor(windowSize / 2);
  const samples: any[] = [];
  const pitchSeries: any[] = [];

  for (let i = 0; i < data.length - windowSize; i += hopSize) {
    const slice = data.slice(i, i + windowSize);
    const { frequency, confidence } = detectPitch(slice, sampleRate);
    pitchSeries.push({ time: i / sampleRate, frequency, clarity: confidence });
    if (i % (hopSize * 20) === 0) onProgress((i / data.length) * 0.5);
  }

  let currentSegment: any[] = [];
  const processSegment = (seg: any[]) => {
    if (seg.length >= 3) {
      const avgFreq = seg.reduce((acc, val) => acc + val.frequency, 0) / seg.length;
      const midi = freqToMidi(avgFreq);
      const startIdx = Math.floor(seg[0].time * sampleRate);
      const endIdx = Math.floor((seg[seg.length - 1].time + (windowSize / sampleRate)) * sampleRate);
      const subBuffer = new AudioBuffer({ length: endIdx - startIdx, numberOfChannels: 1, sampleRate });
      subBuffer.copyToChannel(data.slice(startIdx, endIdx), 0);
      
      const existingIdx = samples.findIndex(s => s.midiNote === midi);
      const newSample = { id: Math.random().toString(36).substr(2, 9), name: midiToNoteName(midi), midiNote: midi, frequency: avgFreq, buffer: subBuffer };
      if (existingIdx > -1) {
        if (newSample.buffer.length > samples[existingIdx].buffer.length) samples[existingIdx] = newSample;
      } else samples.push(newSample);
    }
  };

  pitchSeries.forEach(p => {
    if (p.frequency > 0 && p.clarity > 0.85) {
      if (currentSegment.length > 0) {
        const avgFreq = currentSegment.reduce((acc, v) => acc + v.frequency, 0) / currentSegment.length;
        if (Math.abs(p.frequency - avgFreq) / avgFreq < 0.05) currentSegment.push(p);
        else { processSegment(currentSegment); currentSegment = [p]; }
      } else currentSegment = [p];
    } else { processSegment(currentSegment); currentSegment = []; }
  });

  onProgress(1.0);
  return samples.sort((a, b) => a.midiNote - b.midiNote);
}

/** --- COMPONENTS --- **/
const BioRepositoryBrowser = ({ isOpen, onClose, onLoadBird }: any) => {
  const [search, setSearch] = useState("");
  
  const filtered = useMemo(() => {
    return BIRD_FILES.filter(f => f.toLowerCase().includes(search.toLowerCase()));
  }, [search]);

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
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm focus:border-cyan-500 outline-none transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="flex-grow overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {filtered.map((bird) => (
            <button 
              key={bird}
              onClick={() => onLoadBird(bird)}
              className="w-full flex items-center justify-between p-4 rounded-2xl bg-slate-800/30 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800/50 transition-all group"
            >
              <div className="flex items-center space-x-4">
                <div className="p-2 bg-slate-950 rounded-lg group-hover:bg-cyan-950 text-slate-500 group-hover:text-cyan-400 transition-colors">
                  <Bird className="w-5 h-5" />
                </div>
                <span className="text-sm font-bold text-slate-300 group-hover:text-white text-left truncate max-w-[200px] sm:max-w-none">
                  {bird.replace('.mp3', '')}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="py-20 text-center">
              <p className="text-slate-500 text-sm italic">No matching signals in repository.</p>
            </div>
          )}
        </div>
        
        <div className="p-4 bg-slate-950/50 border-t border-slate-800 text-[10px] text-slate-600 flex justify-between uppercase font-bold tracking-widest">
          <span>Source: muvarna/bird-signals</span>
          <span>{BIRD_FILES.length} Samples</span>
        </div>
      </div>
    </div>
  );
};

const PianoKeyboard = ({ onNoteOn, onNoteOff, mappedNotes, activeNotes }: any) => {
  const keys = useMemo(() => {
    const list = [];
    for (let i = 48; i <= 72; i++) list.push({ midi: i, isBlack: [1, 3, 6, 8, 10].includes(i % 12) });
    return list;
  }, []);

  return (
    <div className="flex w-full overflow-x-auto pb-4 justify-start md:justify-center bg-slate-900 p-4 md:p-8 rounded-xl border border-slate-800 shadow-2xl select-none custom-scrollbar">
      <div className="flex relative h-48 md:h-64 min-w-max">
        {keys.map((key) => {
          const isMapped = mappedNotes.has(key.midi);
          const isActive = activeNotes.has(key.midi);
          const computerKey = KEY_LABELS[key.midi];
          if (key.isBlack) {
            return (
              <div 
                key={key.midi} 
                onMouseDown={() => onNoteOn(key.midi)} 
                onMouseUp={() => onNoteOff(key.midi)} 
                className={`absolute w-6 md:w-8 h-28 md:h-40 z-10 -ml-3 md:-ml-4 rounded-b-md cursor-pointer transition-all flex flex-col justify-end items-center pb-2 ${isActive ? 'bg-cyan-400' : 'bg-slate-950'} ${isMapped ? 'border-b-4 border-emerald-400' : 'border-b-2 border-slate-700'} hover:bg-slate-800 shadow-lg`} 
                style={{ left: `${(keys.filter(k => !k.isBlack && k.midi < key.midi).length) * (window.innerWidth < 768 ? 2.5 : 3.5)}rem` }}
              >
                {computerKey && <span className={`text-[8px] md:text-[10px] font-black mono pointer-events-none ${isActive ? 'text-slate-950' : 'text-slate-600'}`}>[{computerKey}]</span>}
              </div>
            );
          }
          return (
            <div 
              key={key.midi} 
              onMouseDown={() => onNoteOn(key.midi)} 
              onMouseUp={() => onNoteOff(key.midi)} 
              className={`w-10 md:w-14 h-48 md:h-64 border border-slate-800 rounded-b-lg cursor-pointer transition-all flex flex-col justify-end items-center pb-4 ${isActive ? 'bg-cyan-100' : 'bg-slate-100'} ${isMapped ? 'ring-inset ring-2 ring-emerald-500' : ''} hover:bg-white`}
            >
              <div className="flex flex-col items-center space-y-1 pointer-events-none">
                {computerKey && <span className={`text-[8px] md:text-[10px] font-black mono ${isActive ? 'text-cyan-600' : 'text-slate-400'}`}>[{computerKey}]</span>}
                <span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase">{MIDI_NOTES[key.midi % 12]}{Math.floor(key.midi / 12) - 1}</span>
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
    <div className="flex flex-col items-center justify-center p-8 md:p-12 bg-slate-900/50 rounded-xl border border-dashed border-slate-700 w-full">
      <Info className="w-12 h-12 text-slate-600 mb-4" />
      <p className="text-slate-400 text-center text-sm">No stable segments detected.<br/>Select a bird from the Library.</p>
    </div>
  );
  return (
    <div className="grid grid-cols-1 gap-3">
      {samples.map((sample: any) => (
        <div key={sample.id} className="group bg-slate-900 border border-slate-800 p-3 md:p-4 rounded-xl hover:border-cyan-500/50 transition-all flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-3 md:space-x-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-cyan-950 rounded-lg flex items-center justify-center text-cyan-400 border border-cyan-800">
              <Music className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <div>
              <h4 className="font-bold text-sm md:text-base text-slate-200">{sample.name}</h4>
              <p className="text-[10px] md:text-xs text-slate-500 mono">{sample.frequency.toFixed(2)} Hz</p>
            </div>
          </div>
          <button onClick={() => onPlaySample(sample)} className="p-2 md:p-3 rounded-full bg-slate-800 text-slate-400 hover:bg-cyan-500 hover:text-white transition-colors">
            <Play className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

/** --- MAIN APP --- **/
const App = () => {
  const [samples, setSamples] = useState<any[]>([]);
  const [status, setStatus] = useState({ status: 'idle', progress: 0, message: 'Bio-engine ready' });
  const [activeMidiNotes, setActiveMidiNotes] = useState(new Set<number>());
  const [isRecording, setIsRecording] = useState(false);
  const [isEncoding, setIsEncoding] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterBusRef = useRef<GainNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const recordedPCMRef = useRef<Float32Array[]>([]);

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioContextClass();
      masterBusRef.current = audioCtxRef.current.createGain();
      masterBusRef.current.connect(audioCtxRef.current.destination);
    }
    return audioCtxRef.current;
  };

  const processAudioData = async (arrayBuffer: ArrayBuffer) => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    
    setStatus(prev => ({ ...prev, status: 'loading', progress: 0.1, message: 'Decoding audio stream...' }));
    try {
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      setStatus(prev => ({ ...prev, status: 'analyzing', progress: 0.2, message: 'Performing Bioacoustic Extraction...' }));
      const extracted = await extractStableSamples(decodedBuffer, p => setStatus(prev => ({ ...prev, progress: 0.2 + (p * 0.8) })));
      setSamples(extracted);
      setStatus({ status: 'completed', progress: 1.0, message: `System online: ${extracted.length} bio-samples active` });
    } catch (err) { 
      console.error(err);
      setStatus({ status: 'error', progress: 0, message: 'DSP Pipeline Failure' }); 
    }
  };

  const handleFileUpload = async (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;
    processAudioData(await file.arrayBuffer());
  };

  const loadFromUrl = async (url: string) => {
    if (!url) return;
    const finalUrl = convertToRawUrl(url);
    setRemoteUrl(finalUrl); 
    
    setStatus(prev => ({ ...prev, status: 'loading', progress: 0.05, message: 'Fetching remote signal...' }));
    try {
      const resp = await fetch(finalUrl);
      if (!resp.ok) throw new Error('Fetch failed');
      const buf = await resp.arrayBuffer();
      processAudioData(buf);
    } catch (e) {
      setStatus({ status: 'error', progress: 0, message: 'Fetch Error (Check your connection)' });
    }
  };

  const loadBirdFromRepo = useCallback((filename: string) => {
    const url = `${BIRD_REPO_BASE}${encodeURIComponent(filename)}`;
    setIsBrowserOpen(false);
    loadFromUrl(url);
  }, []);

  // AUTO-LOAD RANDOM SAMPLE ON MOUNT
  useEffect(() => {
    const randomIndex = Math.floor(Math.random() * BIRD_FILES.length);
    const randomBird = BIRD_FILES[randomIndex];
    // Slightly delay to ensure initialization
    const timer = setTimeout(() => {
      setStatus(prev => ({ ...prev, status: 'loading', message: `Auto-importing random bio-signal: ${randomBird.replace('.mp3', '')}...` }));
      loadBirdFromRepo(randomBird);
    }, 500);
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
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
    source.connect(gainNode);
    if (masterBusRef.current) gainNode.connect(masterBusRef.current);
    source.start();
    
    setActiveMidiNotes(prev => new Set(prev).add(midi));
    source.onended = () => {
      setActiveMidiNotes(prev => { const n = new Set(prev); n.delete(midi); return n; });
    };
  }, [samples]);

  const stopNote = useCallback((midi: number) => {
    setActiveMidiNotes(prev => { const n = new Set(prev); n.delete(midi); return n; });
  }, []);

  const startRecording = () => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const node = ctx.createScriptProcessor(4096, 1, 1);
    recordedPCMRef.current = [];
    node.onaudioprocess = e => recordedPCMRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    if (masterBusRef.current) masterBusRef.current.connect(node);
    node.connect(ctx.destination);
    scriptNodeRef.current = node;
    setIsRecording(true);
    setRecordedUrl(null);
  };

  const stopRecording = async () => {
    setIsRecording(false); setIsEncoding(true);
    const node = scriptNodeRef.current;
    if (node && masterBusRef.current) {
      node.onaudioprocess = null;
      masterBusRef.current.disconnect(node);
      node.disconnect();
    }
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      const midi = COMPUTER_KEY_MAP[key];
      if (midi) { e.preventDefault(); playNote(midi); }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const midi = COMPUTER_KEY_MAP[key];
      if (midi) stopNote(midi);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    const resumeOnInteraction = () => {
        const ctx = getAudioCtx();
        if (ctx.state === 'suspended') ctx.resume();
    };
    window.addEventListener('mousedown', resumeOnInteraction);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        window.removeEventListener('mousedown', resumeOnInteraction);
    };
  }, [playNote, stopNote]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-cyan-500/30 overflow-x-hidden">
      <BioRepositoryBrowser 
        isOpen={isBrowserOpen} 
        onClose={() => setIsBrowserOpen(false)} 
        onLoadBird={loadBirdFromRepo} 
      />

      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-20 flex items-center justify-between gap-2">
          {/* Logo Section */}
          <div className="flex items-center space-x-2 md:space-x-3 shrink-0">
            <div className="p-1.5 md:p-2 bg-cyan-500 rounded-lg shadow-lg shadow-cyan-500/20"><Bird className="w-5 h-5 md:w-6 md:h-6 text-slate-950" /></div>
            <div className="hidden xs:block">
              <h1 className="text-lg md:text-xl font-black tracking-tighter uppercase italic text-white leading-none">ChirpSynth</h1>
              <p className="text-[8px] md:text-[10px] mono text-cyan-400 font-bold tracking-widest leading-tight uppercase">Bioacoustic Sampler</p>
            </div>
          </div>

          {/* Center Actions (Visible on MD+) */}
          <div className="hidden lg:flex items-center mx-6 flex-1 space-x-2">
            <div className="relative flex-1 max-w-sm group">
              <input 
                type="text" 
                placeholder="Paste GitHub URL..." 
                className="w-full bg-slate-950 border border-slate-800 rounded-full px-4 py-1.5 text-xs mono focus:border-cyan-500 outline-none transition-all pr-10 hover:border-slate-600"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
              />
              <button 
                onClick={() => loadFromUrl(remoteUrl)}
                title="Fetch and Auto-Convert GitHub Links"
                className="absolute right-1 top-1 bottom-1 px-3 rounded-full bg-slate-800 text-cyan-400 hover:bg-cyan-500 hover:text-white transition-all flex items-center justify-center"
              >
                <LinkIcon className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Universal Header Actions */}
          <div className="flex items-center space-x-2 md:space-x-4 shrink-0">
            {/* Bio Library Button - Responsive Visibility */}
            <button 
              onClick={() => setIsBrowserOpen(true)}
              className="flex items-center space-x-2 bg-slate-900 border border-slate-800 hover:border-cyan-500/50 p-2 md:px-4 md:py-2 rounded-full text-xs font-black uppercase italic text-cyan-400 transition-all shadow-lg"
              title="Open Bio-Library"
            >
              <FolderOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Library</span>
            </button>

            {/* Rec Controls */}
            <div className="flex items-center space-x-1 md:space-x-2 bg-slate-950/50 p-1 rounded-full border border-slate-800">
              {!isRecording ? (
                <button 
                  onClick={startRecording} 
                  disabled={samples.length === 0 || isEncoding} 
                  className="flex items-center space-x-1 md:space-x-2 px-2 md:px-3 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-red-500 font-bold text-[9px] md:text-[10px] transition-all disabled:opacity-30"
                >
                  {isEncoding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Circle className="w-3 h-3 fill-red-500" />}
                  <span className="hidden xs:inline">{isEncoding ? 'WAIT' : 'REC'}</span>
                </button>
              ) : (
                <button 
                  onClick={stopRecording} 
                  className="flex items-center space-x-1 md:space-x-2 px-2 md:px-3 py-1.5 rounded-full bg-red-500 text-white font-bold text-[9px] md:text-[10px] transition-all animate-pulse"
                >
                  <Square className="w-3 h-3 fill-white" />
                  <span className="hidden xs:inline">STOP</span>
                </button>
              )}
              {recordedUrl && (
                <a href={recordedUrl} download="chirpsynth.mp3" className="flex items-center p-1.5 md:px-3 md:py-1.5 rounded-full bg-emerald-500 text-slate-950 font-bold text-[9px] md:text-[10px] transition-all hover:bg-emerald-400">
                  <Download className="w-3 h-3" />
                  <span className="hidden sm:inline ml-1.5">SAVE</span>
                </a>
              )}
            </div>

            {/* Load Button */}
            <label className="cursor-pointer">
              <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
              <div className="bg-white hover:bg-slate-200 text-slate-950 p-2 md:px-4 md:py-2 rounded-full font-black text-[9px] md:text-[10px] uppercase flex items-center space-x-1.5 transition-all">
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">LOAD</span>
              </div>
            </label>
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto w-full p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
        <div className="lg:col-span-8 space-y-6 md:space-y-8">
          {/* Progress Bar */}
          {(status.status === 'analyzing' || status.status === 'loading') && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-2xl">
              <div className="flex justify-between mb-4">
                <h3 className="font-bold flex items-center space-x-2 text-sm md:text-base"><Activity className="w-4 h-4 text-cyan-400" /><span>DSP PIPELINE ACTIVE</span></h3>
                <span className="mono text-cyan-400 text-xs">{(status.progress * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500 transition-all duration-300 shadow-[0_0_10px_rgba(6,182,212,0.5)]" style={{ width: `${status.progress * 100}%` }} />
              </div>
              <p className="mt-4 text-[10px] md:text-sm text-slate-400 italic leading-snug">“{status.message}”</p>
            </div>
          )}
          
          {/* Visualizer Display */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 relative overflow-hidden h-40 md:h-64 flex flex-col justify-end">
             <div className="absolute top-4 left-4 z-10 flex items-center space-x-2 bg-slate-950/80 px-3 py-1 rounded-full border border-slate-700">
              <Waves className="w-3 h-3 text-cyan-400" />
              <span className="text-[8px] md:text-[10px] font-bold mono uppercase">Bio_Stream_Active</span>
            </div>
            <div className="h-full flex items-end justify-center space-x-1 pt-8">
              {[...Array(window.innerWidth < 768 ? 30 : 60)].map((_, i) => (
                <div key={i} className={`w-1 bg-cyan-500/20 rounded-t-full transition-all duration-300 ${isRecording ? 'animate-pulse' : ''}`}
                  style={{ height: `${20 + (isRecording ? Math.random() * 80 : 20)}%`, opacity: 0.1 + (i / 60) * 0.5 }}
                />
              ))}
              {status.status === 'idle' && (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                  <p className="text-slate-500 font-bold uppercase tracking-[0.2em] text-[10px] md:text-xs">Waiting for Input Signal...</p>
                </div>
              )}
            </div>
          </div>

          {/* Keyboard Section */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base md:text-lg font-black uppercase italic flex items-center space-x-2 text-white">
                <Volume2 className="w-5 h-5 text-cyan-400" />
                <span>Playable Sampler</span>
              </h2>
              <div className="flex items-center space-x-2">
                <div className="px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-[8px] md:text-[10px] mono text-slate-400 flex items-center uppercase">
                  <Keyboard className="w-3 h-3 mr-1.5 md:mr-2 text-cyan-400" />
                  <span className="hidden xs:inline">Tracker Active</span>
                </div>
              </div>
            </div>
            <PianoKeyboard onNoteOn={playNote} onNoteOff={stopNote} mappedNotes={new Set(samples.map(s => s.midiNote))} activeNotes={activeMidiNotes} />
          </section>
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 md:p-6 flex flex-col h-full shadow-2xl overflow-hidden min-h-[400px] lg:min-h-[500px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-black uppercase italic text-xs md:text-sm flex items-center space-x-2 text-white">
                <RefreshCw className={`w-4 h-4 text-cyan-400 ${status.status === 'analyzing' ? 'animate-spin' : ''}`} />
                <span>Extracted Notes</span>
              </h2>
              <span className="bg-slate-950 px-2 py-0.5 rounded text-[10px] mono text-cyan-500 border border-cyan-900 font-bold">{samples.length}</span>
            </div>
            <div className="flex-grow overflow-y-auto custom-scrollbar pr-1">
               <SampleList samples={samples} onPlaySample={(s: any) => {
                 const ctx = getAudioCtx(); const src = ctx.createBufferSource(); src.buffer = s.buffer; src.connect(masterBusRef.current!); src.start();
               }} />
            </div>
          </div>

          <div className="bg-gradient-to-br from-cyan-950/40 to-slate-900 border border-cyan-800/30 rounded-2xl p-5 md:p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 blur-3xl rounded-full -mr-12 -mt-12" />
            <h3 className="font-bold text-[9px] md:text-[10px] text-cyan-400 uppercase mb-3 flex items-center tracking-widest">
              <Globe className="w-3 h-3 mr-2" />
              QUICK START INFO
            </h3>
            <div className="space-y-3 text-[11px] md:text-xs text-slate-300 leading-relaxed italic relative z-10">
              <p className="flex items-start">
                <CheckCircle className="w-3.5 h-3.5 text-cyan-500 mr-2 shrink-0 mt-0.5" />
                <span>Tap <b>Library</b> to choose professional bird recordings.</span>
              </p>
              <p className="flex items-start">
                <CheckCircle className="w-3.5 h-3.5 text-cyan-500 mr-2 shrink-0 mt-0.5" />
                <span>Extracted notes are mapped across the chromatic piano keys.</span>
              </p>
              <p className="flex items-start opacity-70">
                <Info className="w-3.5 h-3.5 text-slate-500 mr-2 shrink-0 mt-0.5" />
                <span>On desktop, use your <b>physical keyboard</b> to perform live.</span>
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-900 bg-slate-950 p-4 md:p-6 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center opacity-40">
          <div className="text-[8px] md:text-[10px] mono mb-2 sm:mb-0 uppercase tracking-widest text-white font-bold text-center sm:text-left">
            CHIRPSYNTH BIO-SYSTEMS // DSP CORE V1.5
          </div>
          <div className="flex space-x-6 text-[8px] md:text-[10px] mono uppercase font-bold tracking-[0.2em]">
            <span>Bio-Library Active</span>
            <span className="hidden xs:inline">{BIRD_FILES.length}_SIGNALS_LOADED</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}
