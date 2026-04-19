/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, RotateCcw, Award, CheckCircle2, XCircle } from 'lucide-react';

// --- Constants & Types ---

const TOTAL_LEVELS = 15;
const FLASH_DURATION = 420; // ms playback
const TAP_DURATION = 260;   // ms tap
const AUTO_NEXT_DELAY = 1200; // ms
const INTER_ITEM_DELAY = 180; // ms

interface ColorDef {
  base: string;
  bright: string;
  name: string;
}

const ALL_COLORS: ColorDef[] = [
  { base: '#06b6d4', bright: '#afeefc', name: 'Sian'    }, // Cyan
  { base: '#f43f5e', bright: '#fecdd3', name: 'Merah'  }, // Rose
  { base: '#f97316', bright: '#ffedd5', name: 'Oranye' }, // Orange
  { base: '#10b981', bright: '#d1fae5', name: 'Hijau'  }, // Emerald
  { base: '#8b5cf6', bright: '#ede9fe', name: 'Ungu'   }, // Violet
];

interface LevelConfig {
  part: number;
  numColors: number;
  span: number;
}

const LEVELS: LevelConfig[] = [
  { part: 1, numColors: 3, span: 1 }, // L1
  { part: 1, numColors: 3, span: 2 }, // L2
  { part: 1, numColors: 3, span: 3 }, // L3
  { part: 1, numColors: 3, span: 4 }, // L4
  { part: 1, numColors: 3, span: 5 }, // L5
  { part: 2, numColors: 4, span: 4 }, // L6
  { part: 2, numColors: 4, span: 5 }, // L7
  { part: 2, numColors: 4, span: 6 }, // L8
  { part: 2, numColors: 4, span: 7 }, // L9
  { part: 2, numColors: 4, span: 8 }, // L10
  { part: 3, numColors: 5, span: 5 }, // L11
  { part: 3, numColors: 5, span: 6 }, // L12
  { part: 3, numColors: 5, span: 7 }, // L13
  { part: 3, numColors: 5, span: 8 }, // L14
  { part: 3, numColors: 5, span: 9 }, // L15
];

type GamePhase = 'idle' | 'showing' | 'input' | 'wrong' | 'finished';

// --- Audio Engine ---

class SoundEngine {
  ctx: AudioContext | null = null;

  async init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        latencyHint: 'interactive'
      });
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  play(index: number, duration: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    
    // Frequencies for a pentatonic scale starting at C4
    const freqs = [261.63, 293.66, 329.63, 392.00, 440.00]; // C4, D4, E4, G4, A4
    this.playPiano(freqs[index], now, duration / 1000);
  }

  private playPiano(freq: number, now: number, dur: number) {
    if (!this.ctx) return;

    const createTone = (frequency: number, type: OscillatorType, gainValue: number, decay: number) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, now);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(gainValue, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + decay);
      
      osc.connect(gain).connect(this.ctx!.destination);
      osc.start(now);
      osc.stop(now + decay);
    };

    // Piano character: Fundamental + harmonics
    createTone(freq, 'sine', 0.5, dur);       
    createTone(freq * 2, 'sine', 0.2, dur * 0.8);
    createTone(freq * 3, 'sine', 0.1, dur * 0.6);
    createTone(freq * 4, 'sine', 0.05, dur * 0.4);
    
    // Add attack noise
    const noiseGain = this.ctx!.createGain();
    noiseGain.gain.setValueAtTime(0.05, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    
    const bufferSize = this.ctx!.sampleRate * 0.05;
    const buffer = this.ctx!.createBuffer(1, bufferSize, this.ctx!.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    
    const noise = this.ctx!.createBufferSource();
    noise.buffer = buffer;
    noise.connect(noiseGain).connect(this.ctx!.destination);
    noise.start(now);
  }
}

// --- SVG Helpers ---

const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    "M", start.x, start.y, 
    "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y,
    "L", x, y,
    "Z"
  ].join(" ");
};

const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
  return {
    x: centerX + (radius * Math.cos(angleInRadians)),
    y: centerY + (radius * Math.sin(angleInRadians))
  };
};

// --- Main App Component ---

const NormalCurve = ({ userScore }: { userScore: number }) => {
  const width = 360;
  const height = 150;
  const padding = 30;
  
  // Normal Distribution for Levels: 
  // Most people fall in levels 5-10 (Span 4-7)
  const mean = 8; 
  const stdDev = 2.2;
  const points: [number, number][] = [];
  
  for (let x = 0; x <= TOTAL_LEVELS; x += 0.2) {
    const y = (1 / (stdDev * Math.sqrt(2 * Math.PI))) * 
              Math.exp(-0.5 * Math.pow((x - mean) / stdDev, 2));
    points.push([x, y]);
  }
  
  const minX = 0;
  const maxX = TOTAL_LEVELS;
  const maxY = (1 / (stdDev * Math.sqrt(2 * Math.PI))); // Peak of the curve
  
  const scaleX = (x: number) => padding + ((x - minX) / (maxX - minX)) * (width - 2 * padding);
  const scaleY = (y: number) => height - padding - (y / maxY) * (height - 2 * padding);
  
  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(p[0])} ${scaleY(p[1])}`).join(' ');
  const areaData = pathData + ` L ${scaleX(maxX)} ${scaleY(0)} L ${scaleX(minX)} ${scaleY(0)} Z`;
  
  const userX = scaleX(userScore);
  const userY = scaleY((1 / (stdDev * Math.sqrt(2 * Math.PI))) * 
               Math.exp(-0.5 * Math.pow((userScore - mean) / stdDev, 2)));

  return (
    <div className="w-full flex flex-col items-center mt-4">
      <div className="relative w-full aspect-[2.4/1]">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          {/* Normal Range Shading (-1SD to +1SD) */}
          <rect 
            x={scaleX(mean - stdDev)} 
            y={scaleY(maxY)} 
            width={scaleX(mean + stdDev) - scaleX(mean - stdDev)} 
            height={height - padding - scaleY(maxY)} 
            fill="white" 
            fillOpacity="0.03" 
          />
          
          <path d={areaData} className="curve-fill opacity-20" />
          <path d={pathData} className="curve-path stroke-white/20" />
          
          {/* Mid Line */}
          <line 
            x1={scaleX(mean)} y1={height - padding} 
            x2={scaleX(mean)} y2={scaleY(maxY)} 
            stroke="white" strokeOpacity="0.1" strokeDasharray="4 4" 
          />
          
          {/* User Marker */}
          <motion.g
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.6 }}
          >
            <line x1={userX} y1={userY} x2={userX} y2={height - padding + 4} stroke="white" strokeWidth="1.5" strokeDasharray="2 2" />
            <circle cx={userX} cy={userY} r="5" className="fill-accent shadow-lg" />
            <text x={userX} y={userY - 14} textAnchor="middle" className="fill-white text-[10px] font-black uppercase tracking-wider italic">Anda</text>
          </motion.g>

          <text x={scaleX(mean)} y={height - padding + 18} textAnchor="middle" className="fill-white/30 text-[7px] uppercase font-black tracking-[0.3em]">Normal Range</text>
        </svg>
      </div>
      <p className="text-[9px] uppercase tracking-[0.4em] opacity-20 font-black mt-4">Statistik Capaian Memory Span</p>
    </div>
  );
};

export default function App() {
  const [levelIdx, setLevelIdx] = useState(0);
  const [levelsOk, setLevelsOk] = useState(0);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [trialSeq, setTrialSeq] = useState<number[]>([]);
  const [userSeq, setUserSeq] = useState<number[]>([]);
  const [activeSector, setActiveSector] = useState<number | null>(null);
  const [resultText, setResultText] = useState('');
  
  const audioRef = useRef<SoundEngine | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const currentLevel = LEVELS[Math.min(levelIdx, TOTAL_LEVELS - 1)];

  // Initialize Audio
  useEffect(() => {
    audioRef.current = new SoundEngine();
  }, []);

  const stopAllTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const flashSector = useCallback(async (idx: number, duration: number) => {
    setActiveSector(idx);
    audioRef.current?.play(idx, duration);
    return new Promise(resolve => {
      setTimeout(() => {
        setActiveSector(null);
        setTimeout(resolve, INTER_ITEM_DELAY);
      }, duration);
    });
  }, []);

  const runRound = useCallback(async (idx: number) => {
    const config = LEVELS[idx];
    const seq = Array.from({ length: config.span }, () => Math.floor(Math.random() * config.numColors));
    
    setTrialSeq(seq);
    setUserSeq([]);
    setPhase('showing');
    setResultText('');

    await new Promise(r => setTimeout(r, 600));

    for (const colorIdx of seq) {
      await flashSector(colorIdx, FLASH_DURATION);
    }

    setPhase('input');
  }, [flashSector]);

  const startGame = useCallback(async () => {
    await audioRef.current?.init();
    setLevelIdx(0);
    setLevelsOk(0);
    runRound(0);
  }, [runRound]);

  const handleSectorTap = useCallback(async (idx: number) => {
    if (phase !== 'input') return;

    audioRef.current?.play(idx, TAP_DURATION);
    setActiveSector(idx);
    setTimeout(() => setActiveSector(null), TAP_DURATION);

    const newUserSeq = [...userSeq, idx];
    setUserSeq(newUserSeq);

    const isCorrect = idx === trialSeq[userSeq.length];

    if (!isCorrect) {
      setPhase('wrong');
      setResultText('SALAH!');
      // Replay correct sequence
      setTimeout(async () => {
        for (const c of trialSeq) {
          await flashSector(c, 380);
        }
        setTimeout(() => setPhase('finished'), 1000);
      }, 1000);
    } else if (newUserSeq.length === trialSeq.length) {
      setPhase('showing'); // Prevent input
      setResultText('BENAR!');
      setLevelsOk(prev => prev + 1);
      
      setTimeout(() => {
        if (levelIdx + 1 >= TOTAL_LEVELS) {
          setPhase('finished');
        } else {
          const nextIdx = levelIdx + 1;
          setLevelIdx(nextIdx);
          runRound(nextIdx);
        }
      }, AUTO_NEXT_DELAY);
    }
  }, [phase, trialSeq, userSeq, levelIdx, runRound, flashSector]);

  const resetGame = useCallback(() => {
    setPhase('idle');
    setLevelIdx(0);
    setLevelsOk(0);
    setTrialSeq([]);
    setUserSeq([]);
    setResultText('');
  }, []);

  const getInterpretation = (score: number) => {
    if (score === 100) return "Sempurna! Semua 15 level berhasil.";
    if (score >= 80) return "Sangat baik. Jauh di atas rata-rata.";
    if (score >= 60) return "Baik. Di atas rata-rata orang dewasa.";
    if (score >= 40) return "Cukup. Sesuai rata-rata orang dewasa.";
    if (score >= 20) return "Rata-rata rendah. Latihan rutin dapat membantu.";
    return "Di bawah rata-rata. Coba lagi setelah istirahat.";
  };

  const score = Math.round((levelsOk / TOTAL_LEVELS) * 100);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      
      {/* WRONG OVERLAY EFFECT */}
      <AnimatePresence>
        {phase === 'wrong' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none wrong-overlay z-50" 
          />
        )}
      </AnimatePresence>

      <div className="w-full max-w-lg px-4 flex flex-col items-center justify-center min-h-[100dvh]">
        {phase !== 'finished' ? (
          <div id="game-view" className="flex flex-col items-center gap-4 sm:gap-6 w-full py-8">
            
            {/* Status Info */}
            <div className="text-[10px] sm:text-xs uppercase font-black tracking-[0.4em] opacity-30 select-none">
              LEVEL {levelIdx + 1}
            </div>

            {/* Wheel Area */}
            <div className="relative group mt-4 sm:mt-8 w-full flex justify-center">
              <div className="relative w-[min(85vw,380px)] h-[min(85vw,380px)]">
                <motion.svg 
                  viewBox="0 0 400 400" 
                  className="w-full h-full wheel-svg"
                  animate={{ 
                    rotate: phase === 'showing' ? 360 : 0,
                    scale: phase === 'showing' ? 1.05 : 1,
                  }}
                  transition={{ 
                    rotate: { duration: 20, repeat: Infinity, ease: "linear" },
                    scale: { duration: 0.5, ease: "easeOut" }
                  }}
                  style={{ filter: phase === 'showing' ? 'brightness(1)' : 'brightness(1.1)' }}
                >
                  {/* Draw Sectors */}
                  {Array.from({ length: currentLevel.numColors }).map((_, i) => {
                    const angle = 360 / currentLevel.numColors;
                    const start = i * angle;
                    const end = (i + 1) * angle;
                    const isActive = activeSector === i;
                    const color = ALL_COLORS[i];

                    return (
                      <path
                        key={`${currentLevel.numColors}-${i}`}
                        d={describeArc(200, 200, 180, start, end)}
                        fill={isActive ? color.bright : color.base}
                        className={`sector ${isActive ? 'transition-none' : ''}`}
                        onClick={() => handleSectorTap(i)}
                        stroke="#000"
                        strokeWidth="2"
                      />
                    );
                  })}
                </motion.svg>

                {/* Center Circle Overlay */}
                <div className="wheel-center shadow-inner">
                  <span className="text-[10px] font-bold tracking-[2px] opacity-80 uppercase leading-none mb-1">Span</span>
                  <span className="text-3xl font-black text-gold tabular-nums leading-none">
                    {currentLevel.span}
                  </span>
                </div>
              </div>

              {/* Status Text Overlay */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-center">
                {resultText && (
                  <motion.div 
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`text-6xl font-black italic drop-shadow-[0_0_20px_rgba(0,0,0,0.5)] ${resultText === 'BENAR!' ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {resultText}
                  </motion.div>
                )}
              </div>
            </div>

            {/* Dot Indicators */}
            <div className="flex flex-col items-center gap-6 mt-4">
              <div className="flex gap-3 h-4 items-center">
                {Array.from({ length: currentLevel.span }).map((_, i) => {
                  let statusClass = '';
                  if (i < userSeq.length) statusClass = 'dot-filled';
                  else if (i === userSeq.length && phase === 'input') statusClass = 'dot-active';
                  
                  return (
                    <div 
                      key={i} 
                      className={`dot ${statusClass}`} 
                    />
                  );
                })}
              </div>
              
              <div className="h-6">
                <AnimatePresence mode="wait">
                  {phase === 'idle' ? (
                    <motion.button 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      onClick={startGame}
                      className="btn-primary flex items-center gap-2 group"
                    >
                      <Play className="fill-current w-5 h-5 group-hover:scale-110 transition-transform" />
                      Mulai Tes
                    </motion.button>
                  ) : (
                    <motion.p 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs uppercase tracking-widest font-bold text-accent h-4"
                    >
                      {phase === 'showing' ? 'Perhatikan Urutan...' : 'Sekarang Giliranmu!'}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        ) : (
          <motion.div 
            id="score-view" 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card flex flex-col items-center text-center gap-8 sm:gap-10 w-full max-w-[90vw] sm:max-w-sm"
          >
            <div className="space-y-4">
              <Award className="w-12 h-12 sm:w-16 sm:h-16 text-gold mx-auto drop-shadow-[0_0_15px_rgba(245,158,11,0.5)]" />
              <div className="space-y-1">
                <h1 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter italic">SCORE: {score}</h1>
                <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.4em] opacity-30 font-bold">Total Capaian</p>
              </div>
            </div>

            <NormalCurve userScore={levelsOk} />

            <button onClick={resetGame} className="btn-primary w-full group flex items-center justify-center gap-4 py-3 sm:py-4">
              <RotateCcw className="w-5 h-5 group-hover:rotate-[-45deg] transition-transform" />
              Main Lagi
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
