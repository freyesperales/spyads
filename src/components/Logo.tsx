export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2 font-semibold text-lg">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <circle cx="16" cy="16" r="14" stroke="url(#g)" strokeWidth="2.5" />
        <circle cx="16" cy="16" r="5" fill="url(#g)" />
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
      </svg>
      <span>
        spy<span className="gradient-text">ads</span>
      </span>
    </div>
  );
}
