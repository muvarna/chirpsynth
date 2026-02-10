
import React, { useMemo } from 'react';
import { MIDI_NOTES } from '../types.ts';

interface PianoKeyboardProps {
  onNoteOn: (midi: number) => void;
  onNoteOff: (midi: number) => void;
  mappedNotes: Set<number>;
  activeNotes: Set<number>;
}

const KEY_LABELS: Record<number, string> = {
  60: 'A', 61: 'W', 62: 'S', 63: 'E', 64: 'D', 65: 'F', 66: 'T', 67: 'G', 
  68: 'Y', 69: 'H', 70: 'U', 71: 'J', 72: 'K', 73: 'O', 74: 'L', 75: 'P', 
  76: ';', 77: "'"
};

const PianoKeyboard: React.FC<PianoKeyboardProps> = ({ onNoteOn, onNoteOff, mappedNotes, activeNotes }) => {
  const startNote = 48;
  const endNote = 84;
  
  const keys = useMemo(() => {
    const list = [];
    for (let i = startNote; i <= endNote; i++) {
      const isBlack = [1, 3, 6, 8, 10].includes(i % 12);
      list.push({ midi: i, isBlack });
    }
    return list;
  }, []);

  return (
    <div className="flex w-full overflow-x-auto pb-4 justify-center bg-slate-900 p-8 rounded-xl border border-slate-800 shadow-2xl select-none">
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
                onMouseLeave={() => onNoteOff(key.midi)}
                className={`
                  absolute w-8 h-40 z-10 -ml-4 rounded-b-md cursor-pointer transition-all flex flex-col justify-end items-center pb-2
                  ${isActive ? 'bg-cyan-400' : 'bg-slate-950'}
                  ${isMapped ? 'border-b-4 border-emerald-400' : 'border-b-2 border-slate-700'}
                  hover:bg-slate-800
                `}
                style={{ 
                  left: `${(keys.filter(k => !k.isBlack && k.midi < key.midi).length) * 3.5}rem`
                }}
              >
                {computerKey && (
                  <span className={`text-[10px] font-black mono ${isActive ? 'text-slate-950' : 'text-slate-600'}`}>
                    [{computerKey}]
                  </span>
                )}
              </div>
            );
          }
          
          return (
            <div
              key={key.midi}
              onMouseDown={() => onNoteOn(key.midi)}
              onMouseUp={() => onNoteOff(key.midi)}
              onMouseLeave={() => onNoteOff(key.midi)}
              className={`
                w-14 h-64 border border-slate-800 rounded-b-lg cursor-pointer transition-all flex flex-col justify-end items-center pb-4
                ${isActive ? 'bg-cyan-100' : 'bg-slate-100'}
                ${isMapped ? 'ring-inset ring-2 ring-emerald-500' : ''}
                hover:bg-white
              `}
            >
              <div className="flex flex-col items-center space-y-1">
                {computerKey && (
                  <span className={`text-[10px] font-black mono ${isActive ? 'text-cyan-600' : 'text-slate-400'}`}>
                    [{computerKey}]
                  </span>
                )}
                <span className="text-[10px] font-bold text-slate-400 uppercase">
                  {MIDI_NOTES[key.midi % 12]}{Math.floor(key.midi / 12) - 1}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PianoKeyboard;
