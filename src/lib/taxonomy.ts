export const KINDS = [
  { id: "post", label: "Posts", singular: "Post" },
  { id: "article", label: "Articles", singular: "Article" },
  { id: "video", label: "Videos", singular: "Video" },
  { id: "image", label: "Images", singular: "Image" },
  { id: "audio", label: "Audio", singular: "Audio" },
  { id: "link", label: "Links", singular: "Link" },
  { id: "note", label: "Notes", singular: "Note" },
] as const;

export type Kind = (typeof KINDS)[number]["id"];

export const TOPICS = [
  { id: "tech", label: "Tech & Code", color: "#3b82f6" },
  { id: "ai", label: "AI", color: "#8b5cf6" },
  { id: "design", label: "Design & Art", color: "#ec4899" },
  { id: "business", label: "Business & Money", color: "#10b981" },
  { id: "science", label: "Science", color: "#06b6d4" },
  { id: "news", label: "News & Politics", color: "#64748b" },
  { id: "food", label: "Food & Recipes", color: "#f97316" },
  { id: "travel", label: "Travel & Places", color: "#14b8a6" },
  { id: "health", label: "Health & Fitness", color: "#22c55e" },
  { id: "music", label: "Music", color: "#a855f7" },
  { id: "film", label: "Movies & TV", color: "#ef4444" },
  { id: "books", label: "Books & Writing", color: "#b45309" },
  { id: "gaming", label: "Gaming", color: "#6366f1" },
  { id: "sports", label: "Sports", color: "#0ea5e9" },
  { id: "shopping", label: "Shopping & Products", color: "#eab308" },
  { id: "home", label: "Home & DIY", color: "#84cc16" },
  { id: "style", label: "Style & Beauty", color: "#f43f5e" },
  { id: "fun", label: "Fun & Memes", color: "#facc15" },
  { id: "personal", label: "Personal & To-dos", color: "#78716c" },
  { id: "other", label: "Everything else", color: "#a1a1aa" },
] as const;

export type Topic = (typeof TOPICS)[number]["id"];

export const TOPIC_IDS = TOPICS.map((t) => t.id) as Topic[];
export const KIND_IDS = KINDS.map((k) => k.id) as Kind[];

export function isTopic(v: unknown): v is Topic {
  return typeof v === "string" && (TOPIC_IDS as string[]).includes(v);
}

export function isKind(v: unknown): v is Kind {
  return typeof v === "string" && (KIND_IDS as string[]).includes(v);
}

export function topicMeta(id: string) {
  return TOPICS.find((t) => t.id === id) ?? TOPICS[TOPICS.length - 1];
}

export function kindMeta(id: string) {
  return KINDS.find((k) => k.id === id) ?? KINDS[KINDS.length - 2];
}
