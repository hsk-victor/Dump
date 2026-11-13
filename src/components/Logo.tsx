/** A small pile of tilted cards: things dumped on top of each other. */
export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="d-logo">
      <rect x="5" y="4" width="14" height="17" rx="3.5" fill="#ff6b4a" transform="rotate(-20 12 12.5)" />
      <rect x="13" y="4" width="14" height="17" rx="3.5" fill="#4f8cff" transform="rotate(18 20 12.5)" />
      <rect x="8.5" y="11" width="15" height="18" rx="3.5" className="d-logo-front" />
      <rect x="11.5" y="15.5" width="9" height="2.2" rx="1.1" className="d-logo-line" />
      <rect x="11.5" y="20" width="5.5" height="2.2" rx="1.1" className="d-logo-line" />
    </svg>
  );
}
