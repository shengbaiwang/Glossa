import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type TestRequest = {
  messages?: Array<{ role?: string; content?: string }>;
};

const corsHeaders = {
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * Test-only local SSE endpoint for the native-WebView Glossa integration test.
 * It is unavailable unless the harness explicitly opts in and never proxies a
 * real provider or reads credentials.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env['NODE_ENV'] === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = (await request.json()) as TestRequest;
  const current = body.messages?.at(-1)?.content;
  let sourceId = '';
  try {
    const parsed = JSON.parse(current ?? '') as {
      contextPack?: { excerpts?: Array<{ sourceId?: string }> };
    };
    sourceId = parsed.contextPack?.excerpts?.[0]?.sourceId ?? '';
  } catch {
    return NextResponse.json({ error: 'invalid test request' }, { status: 400 });
  }
  const answer = JSON.stringify({
    status: 'answered',
    paragraphs: [
      {
        text: 'The local test service confirmed the selected reading evidence.',
        sourceIds: [sourceId],
        basis: 'document',
      },
    ],
    followups: [],
  });
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(': local test keep-alive\n\n'));
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: 'stop' }] })}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
  });
}
