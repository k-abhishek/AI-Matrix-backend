import React from 'react';
import { cn } from '../../utils/cn';

interface ShinyTextProps {
  text: string;
  className?: string;
}

/**
 * ReactBits-inspired ShinyText
 * Adds a high-fidelity light sheen sweeping across typography.
 */
export const ShinyText: React.FC<ShinyTextProps> = ({
  text,
  className,
}) => {
  return (
    <span
      className={cn(
        'inline-block bg-[linear-gradient(110deg,hsl(var(--foreground))_40%,hsl(var(--primary))_50%,hsl(var(--foreground))_60%)] bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer select-none font-semibold',
        className
      )}
      style={{
        animation: 'shimmer 4s infinite linear',
      }}
    >
      {text}
    </span>
  );
};

export default ShinyText;
