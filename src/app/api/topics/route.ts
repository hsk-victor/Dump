import { NextResponse, type NextRequest } from "next/server";
import { createTopic, listTopics, TopicError } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ topics: listTopics() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const topic = createTopic({ label: String(body.label ?? ""), color: body.color, description: body.description });
    return NextResponse.json({ topic, topics: listTopics() }, { status: 201 });
  } catch (err) {
    if (err instanceof TopicError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
