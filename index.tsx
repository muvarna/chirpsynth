import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { 
  Upload, Activity, Waves, Volume2, Bird, RefreshCw, Info, 
  Keyboard, Square, Download, Circle, Loader2, Play, Music 
} from 'lucide-react';

/** --- CONSTANTS & TYPES --- **/
const MIDI_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Two-octave mapping (Standard Tracker Layout)
// Lower octave (C3 - C4): Z row
// Upper octave (C4 - C5): Q row
const COMPUTER_KEY_MAP: Record<string, number> = {
  // Lower Octave (C3 - C4)
  'z': 48, 's': 49, 'x': 50, 'd': 51, 'c': 52, 'v': 53, 'g': 54, 'b': 55, 'h': 56, 'n': 57, 'j': 58, 'm': 59, ',': 60,
  // Upper Octave (C4 - C5)
  'q': 60, '2': 61, 'w': 62, '3': 63, 'e': 64, 'r': 65, '5': 66, 't': 67, '6': 68, 'y': 69, '7': 70, 'u': 71, 'i': 72
};

const KEY_LABELS: Record<number, string> = {
  48: 'Z', 49: 'S', 50: 'X', 51: 'D', 52: 'C', 53: 'V', 54: 'G', 55: 'B', 56: 'H', 57: 'N', 58: 'J', 59: 'M',
  60: 'Q', 61: '2', 62: 'W', 63: '3', 64: 'E', 65: 'R', 66: '5', 67: 'T', 68: '6', 69: 'Y', 70: '7', 71: 'U', 72: 'I'
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
const PianoKeyboard = ({ onNoteOn, onNoteOff, mappedNotes, activeNotes }: any) => {
  const keys = useMemo(() => {
    const list = [];
    // Full 2-octave range display: MIDI 48 (C3) to MIDI 72 (C5)
    for (let i = 48; i <= 72; i++) list.push({ midi: i, isBlack: [1, 3, 6, 8, 10].includes(i % 12) });
    return list;
  }, []);

  return (
    <div className="flex w-full overflow-x-auto pb-4 justify-center bg-slate-900 p-8 rounded-xl border border-slate-800 shadow-2xl select-none custom-scrollbar">
      <div className="flex relative h-64 min-w-max">
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
                className={`absolute w-8 h-40 z-10 -ml-4 rounded-b-md cursor-pointer transition-all flex flex-col justify-end items-center pb-2 ${isActive ? 'bg-cyan-400' : 'bg-slate-950'} ${isMapped ? 'border-b-4 border-emerald-400' : 'border-b-2 border-slate-700'} hover:bg-slate-800 shadow-lg`} 
                style={{ left: `${(keys.filter(k => !k.isBlack && k.midi < key.midi).length) * 3.5}rem` }}
              >
                {computerKey && <span className={`text-[10px] font-black mono pointer-events-none ${isActive ? 'text-slate-950' : 'text-slate-600'}`}>[{computerKey}]</span>}
              </div>
            );
          }
          return (
            <div 
              key={key.midi} 
              onMouseDown={() => onNoteOn(key.midi)} 
              onMouseUp={() => onNoteOff(key.midi)} 
              className={`w-14 h-64 border border-slate-800 rounded-b-lg cursor-pointer transition-all flex flex-col justify-end items-center pb-4 ${isActive ? 'bg-cyan-100' : 'bg-slate-100'} ${isMapped ? 'ring-inset ring-2 ring-emerald-500' : ''} hover:bg-white`}
            >
              <div className="flex flex-col items-center space-y-1 pointer-events-none">
                {computerKey && <span className={`text-[10px] font-black mono ${isActive ? 'text-cyan-600' : 'text-slate-400'}`}>[{computerKey}]</span>}
                <span className="text-[10px] font-bold text-slate-400 uppercase">{MIDI_NOTES[key.midi % 12]}{Math.floor(key.midi / 12) - 1}</span>
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
    <div className="flex flex-col items-center justify-center p-12 bg-slate-900/50 rounded-xl border border-dashed border-slate-700 w-full">
      <Info className="w-12 h-12 text-slate-600 mb-4" />
      <p className="text-slate-400 text-center">No stable segments detected.<br/>Upload a signal to start.</p>
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
      {samples.map((sample: any) => (
        <div key={sample.id} className="group bg-slate-900 border border-slate-800 p-4 rounded-xl hover:border-cyan-500/50 transition-all flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-cyan-950 rounded-lg flex items-center justify-center text-cyan-400 border border-cyan-800">
              <Music className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-slate-200">{sample.name}</h4>
              <p className="text-xs text-slate-500 mono">{sample.frequency.toFixed(2)} Hz</p>
            </div>
          </div>
          <button onClick={() => onPlaySample(sample)} className="p-3 rounded-full bg-slate-800 text-slate-400 hover:bg-cyan-500 hover:text-white transition-colors">
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

  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterBusRef = useRef<GainNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const recordedPCMRef = useRef<Float32Array[]>([]);
  const activeSources = useRef<Map<number, AudioBufferSourceNode>>(new Map());

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioContextClass();
      masterBusRef.current = audioCtxRef.current.createGain();
      masterBusRef.current.connect(audioCtxRef.current.destination);
    }
    return audioCtxRef.current;
  };

  const handleFileUpload = async (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    
    setStatus({ status: 'loading', progress: 0.1, message: 'Decoding audio...' });
    try {
      const decodedBuffer = await ctx.decodeAudioData(await file.arrayBuffer());
      setStatus({ status: 'analyzing', progress: 0.2, message: 'Analyzing Bio-patterns...' });
      const extracted = await extractStableSamples(decodedBuffer, p => setStatus(prev => ({ ...prev, progress: 0.2 + (p * 0.8) })));
      setSamples(extracted);
      setStatus({ status: 'completed', progress: 1.0, message: `Captured ${extracted.length} bio-samples` });
    } catch (err) { 
      console.error(err);
      setStatus({ status: 'error', progress: 0, message: 'DSP Failure' }); 
    }
  };

  const playNote = useCallback((midi: number) => {
    if (samples.length === 0) return;
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    
    // Polyphonic source tracking to prevent overlaps if needed, though samplers usually just stack
    let nearest = samples[0];
    let minDiff = Math.abs(samples[0].midiNote - midi);
    samples.forEach(s => { const d = Math.abs(s.midiNote - midi); if (d < minDiff) { minDiff = d; nearest = s; } });

    const source = ctx.createBufferSource();
    source.buffer = nearest.buffer;
    source.playbackRate.value = Math.pow(2, (midi - nearest.midiNote) / 12);
    
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5); // Fast decay for "plucky" samplers
    
    source.connect(gainNode);
    if (masterBusRef.current) gainNode.connect(masterBusRef.current);
    
    source.start();
    
    setActiveMidiNotes(prev => new Set(prev).add(midi));
    activeSources.current.set(midi, source);

    source.onended = () => {
      setActiveMidiNotes(prev => {
        const next = new Set(prev);
        next.delete(midi);
        return next;
      });
      activeSources.current.delete(midi);
    };
  }, [samples]);

  const stopNote = useCallback((midi: number) => {
    // We rely on the buffer ending or decay for now, but we immediately clear the visual state if the user releases
    // To implement sustain, we'd need envelopes here.
    setActiveMidiNotes(prev => {
      const next = new Set(prev);
      next.delete(midi);
      return next;
    });
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

  // Improved Keyboard Management
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key.toLowerCase();
      const midi = COMPUTER_KEY_MAP[key];
      if (midi) {
        e.preventDefault();
        playNote(midi);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const midi = COMPUTER_KEY_MAP[key];
      if (midi) {
        stopNote(midi);
      }
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
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-cyan-500/30">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-cyan-500 rounded-lg shadow-lg shadow-cyan-500/20"><Bird className="w-6 h-6 text-slate-950" /></div>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase italic text-white">ChirpSynth</h1>
              <p className="text-[10px] mono text-cyan-400 font-bold tracking-widest leading-tight uppercase">Bioacoustic Sampler</p>
            </div>
          </div>
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2 bg-slate-950/50 p-1.5 rounded-full border border-slate-800">
              {!isRecording ? (
                <button onClick={startRecording} disabled={samples.length === 0 || isEncoding} className="flex items-center space-x-2 px-4 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-red-500 font-bold text-xs transition-all disabled:opacity-30 group">
                  {isEncoding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Circle className="w-3 h-3 fill-red-500" />}
                  <span>{isEncoding ? 'ENCODING...' : 'REC MP3'}</span>
                </button>
              ) : (
                <button onClick={stopRecording} className="flex items-center space-x-2 px-4 py-1.5 rounded-full bg-red-500 text-white font-bold text-xs transition-all animate-pulse">
                  <Square className="w-3 h-3 fill-white" />
                  <span>STOP & RENDER</span>
                </button>
              )}
              {recordedUrl && (
                <a href={recordedUrl} download="chirpsynth.mp3" className="flex items-center space-x-2 px-4 py-1.5 rounded-full bg-emerald-500 text-slate-950 font-bold text-xs transition-all hover:bg-emerald-400">
                  <Download className="w-3 h-3" />
                  <span>SAVE MP3</span>
                </a>
              )}
            </div>
            <label className="cursor-pointer">
              <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
              <div className="bg-white hover:bg-slate-200 text-slate-950 px-6 py-2 rounded-full font-black text-xs uppercase flex items-center space-x-2 transition-all">
                <Upload className="w-4 h-4" />
                <span>LOAD SIGNAL</span>
              </div>
            </label>
          </div>
        </div>
      </header>
      <main className="flex-grow max-w-7xl mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
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
              <p className="mt-4 text-sm text-slate-400 italic">“{status.message}”</p>
            </div>
          )}
          
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 relative overflow-hidden">
             <div className="absolute top-4 left-4 z-10 flex items-center space-x-2 bg-slate-950/80 px-3 py-1 rounded-full border border-slate-700">
              <Waves className="w-3 h-3 text-cyan-400" />
              <span className="text-[10px] font-bold mono uppercase">Bio_Stream_Active</span>
            </div>
            <div className="h-48 flex items-end justify-center space-x-1">
              {[...Array(60)].map((_, i) => (
                <div key={i} className={`w-1 bg-cyan-500/20 rounded-t-full transition-all duration-300 ${isRecording ? 'animate-pulse' : ''}`}
                  style={{ height: `${20 + (isRecording ? Math.random() * 80 : 20)}%`, opacity: 0.1 + (i / 60) * 0.5 }}
                />
              ))}
              {status.status === 'idle' && <div className="absolute inset-0 flex items-center justify-center"><p className="text-slate-500 font-bold uppercase tracking-[0.2em] text-xs">Waiting for Input Signal...</p></div>}
            </div>
          </div>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black uppercase italic flex items-center space-x-2 text-white">
                <Volume2 className="w-5 h-5 text-cyan-400" />
                <span>Playable Sampler</span>
              </h2>
              <div className="flex items-center space-x-4">
                <div className="px-3 py-1 rounded-md bg-slate-800 border border-slate-700 text-[10px] mono text-slate-400 flex items-center uppercase">
                  <Keyboard className="w-3 h-3 mr-2 text-cyan-400" />
                  Tracker Layout: ZXCVB (Low) / QWERTY (High)
                </div>
              </div>
            </div>
            <PianoKeyboard onNoteOn={playNote} onNoteOff={stopNote} mappedNotes={new Set(samples.map(s => s.midiNote))} activeNotes={activeMidiNotes} />
          </section>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col h-full shadow-2xl overflow-hidden min-h-[500px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-black uppercase italic text-sm flex items-center space-x-2 text-white">
                <RefreshCw className={`w-4 h-4 text-cyan-400 ${status.status === 'analyzing' ? 'animate-spin' : ''}`} />
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
          <div className="bg-gradient-to-br from-cyan-950/40 to-slate-900 border border-cyan-800/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 blur-3xl rounded-full -mr-12 -mt-12" />
            <h3 className="font-bold text-[10px] text-cyan-400 uppercase mb-3 flex items-center tracking-widest">
              <Info className="w-3 h-3 mr-2" />
              SYSTEM INFO
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed italic relative z-10">
              "2-Octave Tracker layout enabled. Bottom row (Z to M) covers Octave 3. Top row (Q to I) covers Octave 4. High-fidelity pitch tracking active."
            </p>
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
