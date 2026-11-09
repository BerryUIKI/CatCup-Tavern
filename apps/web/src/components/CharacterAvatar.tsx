import { useState } from 'react';

import { cn } from '../lib/cn';

interface CharacterAvatarProps {
    name: string;
    src?: string | null;
    size?: number;
    className?: string;
}

function hashHue(value: string): number {
    let hash = 0;
    for (const char of value) {
        hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
    }
    return hash;
}

function initialsFor(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
        return parts
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? '')
            .join('');
    }
    return name.trim().slice(0, 2).toUpperCase() || '?';
}

export function CharacterAvatar({ name, src, size = 40, className }: CharacterAvatarProps) {
    const [failed, setFailed] = useState(false);

    if (src && !failed) {
        return (
            <img
                src={src}
                alt=""
                width={size}
                height={size}
                loading="lazy"
                className={cn('shrink-0 rounded-xl object-cover ring-1 ring-white/10', className)}
                style={{ width: size, height: size }}
                onError={() => setFailed(true)}
            />
        );
    }

    const hue = hashHue(name);

    return (
        <div
            className={cn(
                'flex shrink-0 items-center justify-center rounded-xl font-display font-semibold text-ink ring-1 ring-white/10',
                className,
            )}
            style={{
                width: size,
                height: size,
                fontSize: Math.max(11, Math.round(size * 0.32)),
                background: `linear-gradient(145deg, hsl(${hue} 46% 62%), hsl(${(hue + 42) % 360} 38% 38%))`,
            }}
            aria-hidden="true"
        >
            {initialsFor(name)}
        </div>
    );
}
