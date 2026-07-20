import React from 'react';
import './Avatar.css';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  colorSeed?: string;
}

export const Avatar: React.FC<AvatarProps> = ({ name, size = 'md', colorSeed }) => {
  const initials = name.substring(0, 2).toUpperCase();
  
  // Generate a consistent background color based on the name or colorSeed
  const seed = colorSeed || name;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  const backgroundColor = `hsl(${h}, 70%, 40%)`;

  return (
    <div 
      className={`avatar avatar-${size}`}
      style={{ backgroundColor }}
      aria-label={name}
      title={name}
    >
      {initials}
    </div>
  );
};
