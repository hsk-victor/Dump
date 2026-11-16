import { NextResponse, type NextRequest } from "next/server";
import { deleteTopic, listTopics, TopicError, updateTopic } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const patch: { label?: string; color?: string; description?: string } = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.color === "string") patch.color = body.color;
    if (typeof body.description === "string") patch.description = body.description;
    const topic = updateTopic(id, patch);
    if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ topic, topics: listTopics() });
  } catch (err) {
    if (err instanceof TopicError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const result = deleteTopic(id);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...result, topics: listTopics() });
  } catch (err) {
    if (err instanceof TopicError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
