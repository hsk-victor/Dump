"use client";

interface Props {
  total: number;
}

function today() {
  return new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default function Masthead({ total }: Props) {
  const date = today();
  const items = `${total} ${total === 1 ? "item" : "items"}`;
  return (
    <>
      <header className="v-paper mast-paper">
        <div className="mast-strip">
          <span>Vol. I · No. {total}</span>
          <span suppressHydrationWarning>{date}</span>
          <span>Filed automatically</span>
        </div>
        <h1 className="mast-name">The Dump</h1>
        <p className="mast-motto">“All the links that are fit to save.”</p>
      </header>

      <header className="v-zine mast-zine">
        <h1>
          dump<span>.</span>
        </h1>
        <span className="mast-sticker">save anything!</span>
        <p>{items}, sorted for you</p>
      </header>

      <header className="v-night mast-night">
        <h1>
          Dump<em>/</em>
        </h1>
        <div suppressHydrationWarning>
          INDEX — {items.toUpperCase()} — {date.toUpperCase()}
        </div>
      </header>
    </>
  );
}
