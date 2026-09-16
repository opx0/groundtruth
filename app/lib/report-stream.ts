import {
	NDJSON_CONTENT_TYPE,
	ReportEventSchema,
	ReportRequestSchema,
	type ReportEvent,
	type ReportRequest,
} from "@/app/lib/report-contract";

function eventOf(line: string): ReportEvent | null {
	if (line.trim() === "") return null;
	const json: unknown = JSON.parse(line);
	return ReportEventSchema.parse(json);
}

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
		const last = eventOf(buffered + decoder.decode());
		if (last !== null) yield last;
	} finally {
		try {
			await reader.cancel();
		} catch {
		}
	}
}

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
		throw new Error("report: the response was not the report stream");
	}
	return body;
}
