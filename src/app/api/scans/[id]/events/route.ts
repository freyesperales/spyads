import { getScan } from "@/lib/db";
import { isClosed, subscribe, type BusEvent } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function format(ev: BusEvent): string {
  return `event: ${ev.kind}\ndata: ${JSON.stringify(ev.data)}\n\n`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const row = getScan(id);
  if (!row) {
    return new Response("scan not found", { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (ev: BusEvent): void => {
        try {
          controller.enqueue(enc.encode(format(ev)));
        } catch {
          /* socket already gone */
        }
      };

      // Hello frame keeps proxies (nginx etc.) from buffering.
      controller.enqueue(enc.encode(": connected\n\n"));

      // If the scan already finished before this listener arrived (e.g. on
      // page reload), emit a synthetic terminal event derived from the row.
      if (row.status === "done" || row.status === "error") {
        const terminal: BusEvent =
          row.status === "done"
            ? { kind: "done", data: { resultCount: row.result_count } }
            : {
                kind: "error",
                data: { message: row.error ?? "scan failed" },
              };
        send(terminal);
        controller.close();
        return;
      }

      const sub = subscribe(id, send, { replay: true });

      if (isClosed(id)) {
        controller.close();
        return;
      }

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, 15000);

      const cleanup = (): void => {
        clearInterval(keepalive);
        sub.unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // close the stream when terminal events flow through
      const terminalListener = (ev: BusEvent): void => {
        if (ev.kind === "done" || ev.kind === "error") {
          setTimeout(cleanup, 100);
        }
      };
      const termSub = subscribe(id, terminalListener, { replay: false });

      // wire abort
      _req.signal?.addEventListener("abort", () => {
        termSub.unsubscribe();
        cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
