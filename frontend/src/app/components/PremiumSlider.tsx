import React from 'react';
import * as Slider from '@radix-ui/react-slider';

interface PremiumSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (val: number) => void;
}

export function PremiumSlider({ value, min, max, step = 1, onValueChange }: PremiumSliderProps) {
  return (
    <Slider.Root
      className="relative flex items-center select-none touch-none w-full h-5 cursor-pointer"
      value={[value]}
      max={max}
      min={min}
      step={step}
      onValueChange={(vals) => onValueChange(vals[0])}
    >
      <Slider.Track className="bg-[var(--card-border)]/40 relative grow rounded-full h-[4px]">
        <Slider.Range className="absolute bg-gradient-to-r from-[var(--accent)] to-[var(--accent-dark)] rounded-full h-full" />
      </Slider.Track>
      <Slider.Thumb 
        className="block w-5 h-5 bg-[var(--foreground)] border-2 border-[var(--accent)] rounded-full shadow-lg hover:bg-white focus:outline-none transition-colors"
        aria-label="Volume"
      />
    </Slider.Root>
  );
}