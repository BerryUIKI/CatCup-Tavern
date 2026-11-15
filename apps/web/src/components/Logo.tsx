interface LogoProps {
    size?: number;
    className?: string;
}

export function Logo({ size = 40, className }: LogoProps) {
    return (
        <img
            src="/favicon.svg"
            width={size}
            height={size}
            className={className}
            alt=""
            aria-hidden="true"
            draggable={false}
        />
    );
}
