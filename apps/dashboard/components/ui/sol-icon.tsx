export function SolIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-label="SOL"
    >
      <circle cx="12" cy="12" r="11" fill="url(#sol-grad)" />
      <defs>
        <linearGradient id="sol-grad" x1="3" y1="3" x2="21" y2="21">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="50%" stopColor="#8752F3" />
          <stop offset="100%" stopColor="#5497D5" />
        </linearGradient>
      </defs>
      <path
        d="M7.2 14.8a.6.6 0 0 1 .4-.16h9.6a.3.3 0 0 1 .24.46l-1.2 1.6a.6.6 0 0 1-.48.24H6.36a.3.3 0 0 1-.24-.46l1.08-1.68Z"
        fill="rgba(255,255,255,0.6)"
      />
      <path
        d="M7.2 9.84a.6.6 0 0 1 .4-.16h9.6a.3.3 0 0 1 .24.46l-1.2 1.6a.6.6 0 0 1-.48.24H6.36a.3.3 0 0 1-.24-.46l1.08-1.68Z"
        fill="rgba(255,255,255,0.4)"
      />
      <path
        d="M7.2 4.88a.6.6 0 0 1 .4-.16h9.6a.3.3 0 0 1 .24.46l-1.2 1.6a.6.6 0 0 1-.48.24H6.36a.3.3 0 0 1-.24-.46l1.08-1.68Z"
        fill="rgba(255,255,255,0.8)"
      />
    </svg>
  );
}
