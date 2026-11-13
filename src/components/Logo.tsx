const HEART = "M16 25.6C12.6 23.3 11.6 21.6 11.6 19.9 11.6 18.5 12.6 17.4 14 17.4 14.9 17.4 15.6 17.9 16 18.6 16.4 17.9 17.1 17.4 18 17.4 19.4 17.4 20.4 18.5 20.4 19.9 20.4 21.6 19.4 23.3 16 25.6Z";

/** A trash can overflowing with things you love. */
export default function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="d-logo">
      <g transform="translate(2 3.5) scale(0.88)">
      <path d={HEART} fill="#ff5a6e" transform="translate(15 9.6) rotate(-14) scale(1.15) translate(-16 -21.5)" />
      <path d={HEART} fill="#ff9a3c" transform="translate(22 7.6) rotate(18) scale(0.9) translate(-16 -21.5)" />
      <path d="M8 13H24L22.6 28Q22.4 29.5 21 29.5H11Q9.6 29.5 9.4 28Z" className="d-logo-front" />
      <rect x="12.2" y="16" width="1.6" height="10" rx="0.8" className="d-logo-line" />
      <rect x="15.2" y="16" width="1.6" height="10" rx="0.8" className="d-logo-line" />
      <rect x="18.2" y="16" width="1.6" height="10" rx="0.8" className="d-logo-line" />
      <g transform="rotate(-38 7 11.5) translate(-1.5 -0.5)">
        <rect x="6" y="8.5" width="20" height="2.6" rx="1.3" className="d-logo-front" />
        <path d="M13 8.6V7.2Q13 6 14.2 6H17.8Q19 6 19 7.2V8.6" fill="none" strokeWidth="1.8" className="d-logo-handle" />
      </g>
      </g>
    </svg>
  );
}
