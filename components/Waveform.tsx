
import React from 'react';

const Waveform: React.FC<{ active: boolean }> = ({ active }) => {
  if (!active) return null;

  return (
    <div className="flex items-center justify-center gap-2 h-32">
      {[...Array(16)].map((_, i) => (
        <div
          key={i}
          className="wave-bar w-1.5 bg-gradient-to-t from-[#AA771C] via-[#FCF6BA] to-[#BF953F] rounded-full"
          style={{
            height: `${20 + Math.random() * 60}%`,
            animationDelay: `${i * 0.05}s`,
            animationDuration: `${0.5 + Math.random() * 0.5}s`
          }}
        />
      ))}
    </div>
  );
};

export default Waveform;
