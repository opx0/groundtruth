/**
 * Consuming the report route's NDJSON stream, in the browser.
 *
 * The route emits one JSON object per line as each source settles
 * (`app/api/report/handler.ts`), and the whole point of it being a stream is
 * that a card is on screen the moment its source answers: five cards land in
 * about 120 ms while ECHO's budget runs to 45 seconds. So nothing here waits
 * for the body. `readReportEvents` yields an event per line as the bytes
 * arrive, and a consumer that renders on each yield renders in settle order
 * because that is the order the lines were written in.
 *
 * TWO THINGS THIS FILE REFUSES TO DO.
 *
 * **It does not repair a line.** Every line is parsed through
 * `ReportEventSchema`, the same schema the server parsed it through on the way
 * out, and a line that fails throws. docs/BRIEF.md B10 gives a malformed
 * response one outcome -- unavailable, with a retry -- and a screen that
 * skipped a bad line would instead show a report missing a card it could not
 * name. The throw reaches `ReportScreen`'s effect, which is where that outcome
 * lives.
 *
 * **It does not hold the report.** No accumulation, no cache, no copy of the
 * events. The reducer in `app/lib/report-flow.ts` holds what has arrived, in
 * component state, and docs/BRIEF.md B9 step 7 -- the report lives in browser
 * memory and disappears with the page session -- stays true of a generator
 * that keeps only the tail of a partial line.
 *
 * The request body is the confirmed coordinate and nothing else. It is parsed
 * through `ReportRequestSchema` here, before it is sent, so a caller that
 * assembled something larger fails in the browser rather than being refused by
 * a route that is strict about exactly this.
 */

import {
	NDJSON_CONTENT_TYPE,
	ReportEventSchema,
	ReportRequestSchema,
	type ReportEvent,
	type ReportRequest,
} from "@/app/lib/report-contract";

/**
 * One line, or null for the empty string a trailing newline leaves behind.
 *
 * `JSON.parse` returns `any`, so its result is taken as `unknown` and given a
 * type only by the schema -- the same move `requestGeocode` makes in
 * `app/components/search-flow.tsx`.
 */
function eventOf(line: string): ReportEvent | null {
	if (line.trim() === "") return null;
	const json: unknown = JSON.parse(line);
	return ReportEventSchema.parse(json);
}

/**
 * Every event on the stream, yielded as its line completes.
 *
 * A chunk can split a line anywhere, including inside a multi-byte character,
 * so the decoder is a streaming one and the tail of a partial line is carried
 * to the next chunk.
 */
export async function* readReportEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ReportEvent, void, void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			buffered += decoder.decode(chunk.value, { stream: true });
			let newline = buffered.indexOf("\n");
			while (newline !== -1) {
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				const event = eventOf(line);
				if (event !== null) yield event;
				newline = buffered.indexOf("\n");
			}
		}
		// A last line the server never terminated, and whatever the decoder was
		// still holding.
		const last = eventOf(buffered + decoder.decode());
		if (last !== null) yield last;
	} finally {
		// The consumer stopping early -- the reader navigating away, a throw --
		// has to reach the server as a disconnect, because the route checks for
		// one before it builds another event.
		try {
			await reader.cancel();
		} catch {
			// Already closed or already errored. There is nothing left to cancel.
		}
	}
}

/**
 * Opens the report stream for one confirmed point.
 *
 * POST, because docs/BRIEF.md B9 forbids the coordinate reaching a request
 * URL. Every failure here is one thrown error with a fixed message: the
 * coordinate is in scope at this call site and must not reach an error the
 * screen might one day print.
 */
export async function requestReport(point: ReportRequest, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
	const response = await fetch("/api/report", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(ReportRequestSchema.parse(point)),
		...(signal === undefined ? {} : { signal }),
	});
	const body = response.body;
	if (!response.ok || body === null) throw new Error("report: the stream did not open");
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.startsWith(NDJSON_CONTENT_TYPE)) {
		// Something between the browser and the route answered instead of the
		// route: a proxy's error page, a captive portal. Not a report.
		throw new Error("report: the response was not the report stream");
	}
	return body;
}
