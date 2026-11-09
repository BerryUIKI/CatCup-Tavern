interface LogoProps {
    size?: number;
    className?: string;
}

export function Logo({ size = 40, className }: LogoProps) {
    return (
        <svg viewBox="0 0 64 64" width={size} height={size} fill="none" className={className} aria-hidden="true">
            <path
                d="M18 24 12 12l12 5"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M46 24 52 12 40 17"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M14 25h36v10c0 8.837-7.163 16-16 16h-4c-8.837 0-16-7.163-16-16V25Z"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinejoin="round"
            />
            <path d="M50 29h4a6 6 0 0 1 0 12h-4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path
                d="M25 20c0-3 3-3 3-6M33 20c0-3 3-3 3-6M41 20c0-3 3-3 3-6"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                opacity=".6"
            />
            <path d="M27 38h.01M37 38h.01" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
            <path d="M29 43c1.5 1.5 4.5 1.5 6 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
    );
}
