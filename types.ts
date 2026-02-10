
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

export const MIDI_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
