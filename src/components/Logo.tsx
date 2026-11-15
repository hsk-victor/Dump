/** The Dump mark: a dome-lid bin — dump anything in. */
export default function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="d-logo">
      <path d="M19 21a13 10 0 0 1 26 0v2H19z" fill="currentColor" />
      <rect x="15" y="23" width="34" height="6.5" rx="3.25" fill="currentColor" />
      <path
        d="M17.5 32.5h29l-2.3 18.5c-.4 3.8-2.5 5-6.7 5h-11c-4.2 0-6.3-1.2-6.7-5z"
        fill="currentColor"
      />
      <rect x="25" y="38" width="4" height="13" rx="2" fill="var(--bg)" />
      <rect x="30" y="38" width="4" height="13" rx="2" fill="var(--bg)" />
      <rect x="35" y="38" width="4" height="13" rx="2" fill="var(--bg)" />
    </svg>
  );
}
