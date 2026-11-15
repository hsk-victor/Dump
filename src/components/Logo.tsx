/** The Dump mark: an arrow dropping into a tray — dump anything in. */
export default function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="d-logo">
      <path
        d="M32 8v15M22 17l10 11 10-11"
        fill="none"
        stroke="#ff5a6e"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 34h-7q-2 0-2 2v5c0 7.2 4.8 12 12 12h16c7.2 0 12-4.8 12-12v-5q0-2-2-2h-7a11 9.5 0 0 1-22 0z"
        fill="currentColor"
      />
    </svg>
  );
}
