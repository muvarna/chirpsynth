
import { PitchData, AudioSample } from '../types.ts';

export function detectPitch(buffer: Float32Array, sampleRate: number): { frequency: number; confidence: number } {
  const SIZE = buffer.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);
  let bestOffset = -1;
  let bestCorrelation = 0;
  let rms = 0;

  for (let i = 0; i < SIZE; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / SIZE);

  if (rms < 0.01) return { frequency: -1, confidence: 0 };

  for (let offset = Math.floor(sampleRate / 2000); offset < Math.floor(sampleRate / 50); offset++) {
    let correlation = 0;
    for (let i = 0; i < MAX_SAMPLES; i++) {
      correlation += Math.abs(buffer[i] - buffer[i + offset]);
    }
    
    correlation = 1 - (correlation / MAX_SAMPLES);
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestCorrelation < 0.8) return { frequency: -1, confidence: bestCorrelation };

  const frequency = sampleRate / bestOffset;
  return { frequency, confidence: bestCorrelation };
}

export function freqToMidi(f: number): number {
  return Math.round(69 + 12 * Math.log2(f / 440));
}

export function midiToNoteName(midi: number): string {
  const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return notes[midi % 12] + (Math.floor(midi / 12) - 1);
}

export async function extractStableSamples(
  audioBuffer: AudioBuffer,
  onProgress: (p: number) => void
): Promise<AudioSample[]> {
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
    rms = Math.sqrt(rms / slice.length);

    pitchSeries.push({
      time: i / sampleRate,
      frequency,
      rms,
      clarity: confidence
    });

    if (i % (hopSize * 20) === 0) onProgress((i / data.length) * 0.5);
  }

  let currentSegment: PitchData[] = [];
  for (let i = 0; i < pitchSeries.length; i++) {
    const p = pitchSeries[i];
    if (p.frequency > 0 && p.clarity > 0.85) {
      if (currentSegment.length > 0) {
        const avgFreq = currentSegment.reduce((acc, val) => acc + val.frequency, 0) / currentSegment.length;
        const diff = Math.abs(p.frequency - avgFreq) / avgFreq;
        if (diff < 0.05) {
          currentSegment.push(p);
        } else {
          processSegment(currentSegment);
          currentSegment = [p];
        }
      } else {
        currentSegment = [p];
      }
    } else {
      processSegment(currentSegment);
      currentSegment = [];
    }
  }

  function processSegment(seg: PitchData[]) {
    if (seg.length >= stableDurationThreshold) {
      const avgFreq = seg.reduce((acc, val) => acc + val.frequency, 0) / seg.length;
      const midi = freqToMidi(avgFreq);
      const startTime = seg[0].time;
      const endTime = seg[seg.length - 1].time + (windowSize / sampleRate);
      
      const existing = samples.find(s => s.midiNote === midi);
      if (existing) {
        if (seg.length > (existing.endTime - existing.startTime) * (sampleRate / hopSize)) {
          const idx = samples.indexOf(existing);
          samples[idx] = createSample(midi, avgFreq, startTime, endTime);
        }
      } else {
        samples.push(createSample(midi, avgFreq, startTime, endTime));
      }
    }
  }

  function createSample(midi: number, freq: number, start: number, end: number): AudioSample {
    const startIdx = Math.floor(start * sampleRate);
    const endIdx = Math.floor(end * sampleRate);
    const length = endIdx - startIdx;
    
    const subBuffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate });
    subBuffer.copyToChannel(data.slice(startIdx, endIdx), 0);
    
    return {
      id: Math.random().toString(36).substr(2, 9),
      name: midiToNoteName(midi),
      midiNote: midi,
      frequency: freq,
      buffer: subBuffer,
      startTime: start,
      endTime: end,
      confidence: 1.0
    };
  }

  onProgress(1.0);
  return samples.sort((a, b) => a.midiNote - b.midiNote);
}
