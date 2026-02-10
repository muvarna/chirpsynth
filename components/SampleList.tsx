
import React from 'react';
import { AudioSample } from '../types.ts';
import { Play, Music, Info } from 'lucide-react';

interface SampleListProps {
  samples: AudioSample[];
  onPlaySample: (sample: AudioSample) => void;
}

const SampleList: React.FC<SampleListProps> = ({ samples, onPlaySample }) => {
  if (samples.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-slate-900/50 rounded-xl border border-dashed border-slate-700">
        <Info className="w-12 h-12 text-slate-600 mb-4" />
        <p className="text-slate-400 text-center">No stable pitch segments detected yet.<br/>Upload an MP3 to begin analysis.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {samples.map((sample) => (
        <div 
          key={sample.id}
          className="group bg-slate-900 border border-slate-800 p-4 rounded-xl hover:border-cyan-500/50 transition-all flex items-center justify-between shadow-lg"
        >
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-cyan-950 rounded-lg flex items-center justify-center text-cyan-400 border border-cyan-800">
              <Music className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-slate-200">{sample.name}</h4>
              <p className="text-xs text-slate-500 mono">{sample.frequency.toFixed(2)} Hz</p>
            </div>
          </div>
          <button 
            onClick={() => onPlaySample(sample)}
            className="p-3 rounded-full bg-slate-800 text-slate-400 hover:bg-cyan-500 hover:text-white transition-colors"
          >
            <Play className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default SampleList;
