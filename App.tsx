
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Activity, Waves, Volume2, Bird, RefreshCw, AlertCircle, Info, Keyboard, Mic, Square, Download, Circle, Loader2 } from 'lucide-react';
import { AudioSample, AnalysisProgress } from './types.ts';
import { extractStableSamples, midiToNoteName } from './services/dspService.ts';
import PianoKeyboard from './components/PianoKeyboard.tsx';
import SampleList from './components/SampleList.tsx';

// Mapping computer keys to MIDI offsets (relative to C4 = 60)
const COMPUTER_KEY_MAP: Record<string, number> = {
  'a': 60, // C4
  'w': 61, // C#4
  's': 62, // D4
  'e': 63, // D#4
  'd': 64, // E4
  'f': 65, // F4
  't': 66, // F#4
  'g': 67, // G4
  'y': 68, // G#4
  'h': 69, // A4
  'u': 70, // A#4
  'j': 71, // B4
  'k': 72, // C5
  'o': 73, // C#5
  'l': 74, // D5
  'p': 75, // D#5
  ';': 76, // E5
  "'": 77, // F5
};

const App: React.FC = () => {
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [samples, setSamples] = useState<AudioSample[]>([]);
  const [status, setStatus] = useState<AnalysisProgress>({
    status: 'idle',
    progress: 0,
    message: 'Ready to analyze bird songs'
  });
  const [activeMidiNotes, setActiveMidiNotes] = useState<Set<number>>(new Set());
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isEncoding, setIsEncoding] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  
  // Track computer keys specifically to handle auto-repeat
  const pressedComputerKeys = useRef<Set<string>>(new Set());

  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterBusRef = useRef<GainNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const recordedPCMRef = useRef<Float32Array[]>([]);
  const activeSources = useRef<Map<number, AudioBufferSourceNode>>(new Map());

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      
      // Create a master bus for all synth notes
      const masterBus = ctx.createGain();
      masterBus.gain.setValueAtTime(1.0, ctx.currentTime);
      masterBus.connect(ctx.destination);
      masterBusRef.current = masterBus;
    }
    return audioCtxRef.current;
  };

  const startRecording = () => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    if (!masterBusRef.current) return;

    // Use ScriptProcessor to capture PCM chunks
    const scriptNode = ctx.createScriptProcessor(4096, 1, 1);
    recordedPCMRef.current = [];
    
    scriptNode.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      recordedPCMRef.current.push(new Float32Array(inputData));
    };

    masterBusRef.current.connect(scriptNode);
    scriptNode.connect(ctx.destination);

    scriptNodeRef.current = scriptNode;
    setIsRecording(true);
    setRecordedUrl(null);
  };

  const stopRecording = async () => {
    if (!scriptNodeRef.current || !masterBusRef.current) return;

    setIsRecording(false);
    setIsEncoding(true);

    scriptNodeRef.current.onaudioprocess = null;
    masterBusRef.current.disconnect(scriptNodeRef.current);
    scriptNodeRef.current.disconnect();
    scriptNodeRef.current = null;

    try {
      const mp3Url = await encodeToMp3(recordedPCMRef.current, getAudioCtx().sampleRate);
      setRecordedUrl(mp3Url);
    } catch (err) {
      console.error("MP3 Encoding failed", err);
    } finally {
      setIsEncoding(false);
    }
  };

  const encodeToMp3 = async (pcmChunks: Float32Array[], sampleRate: number): Promise<string> => {
    const totalLength = pcmChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const pcm = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of pcmChunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }

    const int16Samples = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const mp3encoder = new (window as any).lamejs.Mp3Encoder(1, sampleRate, 128);
    const mp3Data: Uint8Array[] = [];
    
    const sampleBlockSize = 1152;
    for (let i = 0; i < int16Samples.length; i += sampleBlockSize) {
      const sampleChunk = int16Samples.subarray(i, i + sampleBlockSize);
      const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
      if (mp3buf.length > 0) mp3Data.push(new Uint8Array(mp3buf));
    }

    const flushBuf = mp3encoder.flush();
    if (flushBuf.length > 0) mp3Data.push(new Uint8Array(flushBuf));

    const blob = new Blob(mp3Data, { type: 'audio/mp3' });
    return URL.createObjectURL(blob);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus({ status: 'loading', progress: 0.1, message: 'Decoding audio file...' });
    const ctx = getAudioCtx();
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      setAudioBuffer(decodedBuffer);
      
      setStatus({ status: 'analyzing', progress: 0.2, message: 'Performing Bioacoustic Analysis...' });
      
      const extracted = await extractStableSamples(decodedBuffer, (p) => {
        setStatus(prev => ({ ...prev, progress: 0.2 + (p * 0.8) }));
      });
      
      setSamples(extracted);
      setStatus({ 
        status: 'completed', 
        progress: 1.0, 
        message: `Extracted ${extracted.length} stable bird notes!` 
      });
    } catch (err) {
      console.error(err);
      setStatus({ status: 'error', progress: 0, message: 'Failed to process audio' });
    }
  };

  const playNote = useCallback((midi: number) => {
    if (samples.length === 0) return;
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    let nearest: AudioSample = samples[0];
    let minDiff = Math.abs(samples[0].midiNote - midi);

    for (const s of samples) {
      const diff = Math.abs(s.midiNote - midi);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = s;
      }
    }

    const semitoneDiff = midi - nearest.midiNote;
    const playbackRate = Math.pow(2, semitoneDiff / 12);

    if (activeSources.current.has(midi)) {
      try {
        activeSources.current.get(midi)?.stop();
      } catch(e) {}
    }

    const source = ctx.createBufferSource();
    source.buffer = nearest.buffer;
    source.playbackRate.value = playbackRate;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);

    source.connect(gainNode);
    if (masterBusRef.current) {
      gainNode.connect(masterBusRef.current);
    }
    
    source.start();
    setActiveMidiNotes(prev => new Set(prev).add(midi));

    source.onended = () => {
      activeSources.current.delete(midi);
      setActiveMidiNotes(prev => {
        const next = new Set(prev);
        next.delete(midi);
        return next;
      });
    };
  }, [samples]);

  const stopNote = useCallback((midi: number) => {}, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (COMPUTER_KEY_MAP[key]) {
        const midi = COMPUTER_KEY_MAP[key];
        pressedComputerKeys.current.add(key);
        playNote(midi);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (COMPUTER_KEY_MAP[key]) {
        const midi = COMPUTER_KEY_MAP[key];
        pressedComputerKeys.current.delete(key);
        stopNote(midi);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [playNote, stopNote]);

  const playSampleRaw = (sample: AudioSample) => {
    const ctx = getAudioCtx();
    const source = ctx.createBufferSource();
    source.buffer = sample.buffer;
    if (masterBusRef.current) {
      source.connect(masterBusRef.current);
    }
    source.start();
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-cyan-500/30">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-cyan-500 rounded-lg shadow-lg shadow-cyan-500/20">
              <Bird className="w-6 h-6 text-slate-950" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter uppercase italic text-white">ChirpSynth</h1>
              <p className="text-[10px] mono text-cyan-400 font-bold tracking-widest leading-tight uppercase">Bioacoustic Sampler V1.2</p>
            </div>
          </div>
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2 bg-slate-950/50 p-1.5 rounded-full border border-slate-800">
              {!isRecording ? (
                <button 
                  onClick={startRecording}
                  disabled={samples.length === 0 || isEncoding}
                  className="flex items-center space-x-2 px-4 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-red-500 font-bold text-xs transition-all disabled:opacity-30 disabled:cursor-not-allowed group"
                >
                  {isEncoding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Circle className="w-3 h-3 fill-red-500 group-hover:scale-110 transition-transform" />}
                  <span>{isEncoding ? 'ENCODING...' : 'REC MP3'}</span>
                </button>
              ) : (
                <button 
                  onClick={stopRecording}
                  className="flex items-center space-x-2 px-4 py-1.5 rounded-full bg-red-500 text-white font-bold text-xs transition-all animate-pulse"
                >
                  <Square className="w-3 h-3 fill-white" />
                  <span>STOP & RENDER</span>
                </button>
              )}
              {recordedUrl && (
                <a 
                  href={recordedUrl} 
                  download="chirpsynth-output.mp3"
                  className="flex items-center space-x-2 px-4 py-1.5 rounded-full bg-emerald-500 text-slate-950 font-bold text-xs transition-all hover:bg-emerald-400"
                >
                  <Download className="w-3 h-3" />
                  <span>SAVE MP3</span>
                </a>
              )}
            </div>
            <label className="cursor-pointer group">
              <input type="file" accept="audio/mp3,audio/wav,audio/mpeg" onChange={handleFileUpload} className="hidden" />
              <div className="bg-white hover:bg-slate-200 text-slate-950 px-6 py-2 rounded-full font-black text-xs uppercase flex items-center space-x-2 transition-all shadow-lg shadow-white/5 group-active:scale-95">
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
                <h3 className="font-bold flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span>DSP PIPELINE ACTIVE</span>
                </h3>
                <span className="mono text-cyan-400">{(status.progress * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-cyan-500 transition-all duration-300 shadow-[0_0_10px_rgba(6,182,212,0.5)]"
                  style={{ width: `${status.progress * 100}%` }}
                />
              </div>
              <p className="mt-4 text-sm text-slate-400 italic">“{status.message}”</p>
            </div>
          )}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 relative overflow-hidden group">
            <div className="absolute top-4 left-4 z-10 flex items-center space-x-2 bg-slate-950/80 px-3 py-1 rounded-full border border-slate-700">
              <Waves className="w-3 h-3 text-cyan-400" />
              <span className="text-[10px] font-bold mono uppercase">PCM_Stream_Capture</span>
            </div>
            <div className="h-48 flex items-end justify-center space-x-1">
              {[...Array(60)].map((_, i) => (
                <div 
                  key={i}
                  className={`w-1 bg-cyan-500/20 rounded-t-full transition-all duration-300 ${status.status === 'analyzing' || isRecording ? 'animate-pulse' : ''}`}
                  style={{ 
                    height: `${20 + (isRecording ? Math.random() * 80 : 20)}%`,
                    animationDelay: `${i * 0.05}s`,
                    opacity: 0.1 + (i / 60) * 0.5
                  }}
                />
              ))}
              {status.status === 'idle' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-slate-500 font-bold uppercase tracking-[0.2em] text-xs animate-pulse">Waiting for Input Signal...</p>
                </div>
              )}
            </div>
          </div>
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black uppercase italic flex items-center space-x-2 text-white">
                <Volume2 className="w-5 h-5 text-cyan-400" />
                <span>Playable Sampler</span>
              </h2>
              <div className="flex items-center space-x-4">
                <div className="px-3 py-1 rounded-md bg-slate-800 border border-slate-700 text-[10px] mono text-slate-400 flex items-center">
                  <Keyboard className="w-3 h-3 mr-2 text-cyan-400" />
                  KEYBOARD_PLAY :: ENABLED
                </div>
                <div className="px-3 py-1 rounded-md bg-slate-800 border border-slate-700 text-[10px] mono text-slate-400">
                  POLYPHONIC_MODE :: ACTIVE
                </div>
              </div>
            </div>
            <PianoKeyboard 
              onNoteOn={playNote}
              onNoteOff={stopNote}
              mappedNotes={new Set(samples.map(s => s.midiNote))}
              activeNotes={activeMidiNotes}
            />
          </section>
        </div>
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col h-full shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-black uppercase italic text-sm flex items-center space-x-2 text-white">
                <RefreshCw className={`w-4 h-4 text-cyan-400 ${status.status === 'analyzing' ? 'animate-spin' : ''}`} />
                <span>Extracted Notes</span>
              </h2>
              <span className="bg-slate-950 px-2 py-0.5 rounded text-[10px] mono text-cyan-500 border border-cyan-900 font-bold">
                BUFFER: {samples.length}
              </span>
            </div>
            <div className="flex-grow overflow-y-auto max-h-[600px] pr-2 custom-scrollbar">
              <SampleList samples={samples} onPlaySample={playSampleRaw} />
            </div>
          </div>
          <div className="bg-gradient-to-br from-cyan-950/40 to-slate-900 border border-cyan-800/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 blur-3xl rounded-full -mr-12 -mt-12" />
            <h3 className="font-bold text-[10px] text-cyan-400 uppercase mb-3 flex items-center tracking-widest">
              <Info className="w-3 h-3 mr-2" />
              MP3_EXPORT_ENGINE
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed italic relative z-10">
              "System uses a client-side LAME encoder to process the captured Master Bus PCM stream. The bit depth is normalized to 16-bit Int for high-fidelity MP3 compression at 128kbps."
            </p>
          </div>
        </div>
      </main>
      <footer className="border-t border-slate-900 bg-slate-950 p-6 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center opacity-40">
          <div className="text-[10px] mono mb-4 md:mb-0 uppercase tracking-widest text-white font-bold">
            CHIRPSYNTH BIO-SYSTEMS // MP3_ENCODE_ACTIVE
          </div>
          <div className="flex space-x-8 text-[10px] mono uppercase font-bold tracking-[0.2em]">
            <span>Documentation</span>
            <span>V1.2_Build</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
