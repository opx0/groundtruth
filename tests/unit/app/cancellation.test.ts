/**
 * A disconnected reader stops the requests, not just the events.
 *
 * `app/api/report/handler.ts` carried this as a measured debt. Against the
 * committed fixtures with every source answering 30 ms late, cancelling the
 * reader after the first card:
 *
 *     requests issued when the client cancelled: 3
 *     requests issued 2s later                 : 25
 *
 * Twenty-two requests to EPA hosts after the reader had gone, and an abandoned
 * tab ran until its slowest source spent its whole budget. That is the wrong way
 * round for government infrastructure, and the file said so rather than
 * defending it.
 *
 * WHY THIS STUB HONOURS THE SIGNAL. The io double in
 * `tests/unit/app/report-route.test.ts` ignores the third argument, which is
 * fine for what it tests and useless here: a stub that never checks the signal
 * cannot tell a fixed handler from a broken one, and this test would pass
 * against the defect it exists to catch. So the double below mirrors
 * `lib/io/fetch-source-io.ts` on the one behaviour that matters -- it refuses an
 * aborted signal before doing any work, and abandons a pause already under way.
 */

import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Fetched, JsonValue, PayloadRef, SourceIo } from "@/lib/evidence";
import { SourceFailure } from "@/lib/evidence";
import { createReportHandler } from "@/app/api/report/handler";
import { DEMO, RETRIEVED_AT, type Answer, type Plan } from "./helpers/report-stream-fixtures";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const fixturesDir = fileURLToPath(new URL("../../fixtures/", import.meta.url));

const HOUSTON = { latitude: 29.720658823001, longitude: -95.261995884462 };

/** Long enough that nothing finishes by accident, short enough that the test is not slow. */
const EVERY_SOURCE_ANSWERS_LATE_MS = 30;

/** How long to keep watching after the cancel. Twenty times one answer's delay. */
const WATCH_AFTER_CANCEL_MS = 600;

type Requested = { readonly urls: string[]; readonly io: SourceIo };

function bytesOf(relative: string): Buffer {
	return readFileSync(`${fixturesDir}${relative}`);
}

/** Rejects when the signal fires, so a pause already under way is abandoned rather than waited out. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new SourceFailure("cancelled"));
			},
			{ once: true },
		);
	});
}

function ioOf(answerFor: (url: URL) => Answer): Requested {
	const urls: string[] = [];
	const io: SourceIo = {
		async get<Raw extends JsonValue>(
			url: URL,
			schema: z.ZodType<Raw>,
			signal?: AbortSignal,
		): Promise<Fetched<Raw>> {
			// Before the push, exactly as the real io refuses before its fetch. A
			// request counted here is a request that would have left the machine.
			if (signal?.aborted === true) throw new SourceFailure("cancelled");
			urls.push(url.toString());

			let answer = answerFor(url);
			while ("slow" in answer) {
				await pause(answer.slow, signal);
				answer = answer.then;
			}
			if ("fail" in answer) throw answer.fail;
			const bytes =
				"fixture" in answer ? bytesOf(answer.fixture) : Buffer.from(JSON.stringify(answer.body), "utf8");
			const label = "fixture" in answer ? `fixture:${answer.fixture}` : answer.derived;
			const payload: PayloadRef = {
				url: label,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				retrievedAt: RETRIEVED_AT,
			};
			const parsed = schema.safeParse(JSON.parse(bytes.toString("utf8")));
			if (!parsed.success) throw new SourceFailure("malformed", null);
			return { raw: parsed.data, payload };
		},
		query: (parameter, value, adapterVersion, payload) => ({
			kind: "query",
			parameter,
			value,
			adapterVersion,
			payload,
		}),
		now: () => RETRIEVED_AT,
	};
	return { urls, io };
}

function epaIdOf(url: URL): string {
	const segments = url.pathname.split("/");
	return segments[segments.length - 2] ?? "";
}

function registryIdOf(url: URL): string {
	return /REGISTRY_ID='([^']*)'/.exec(url.searchParams.get("where") ?? "")?.[1] ?? "";
}

/** Every source late by the same amount, so no source finishes before the cancel by luck. */
function slowly(plan: Plan): Requested {
	let echoCalls = 0;
	const late = (answer: Answer): Answer => ({ slow: EVERY_SOURCE_ANSWERS_LATE_MS, then: answer });
	return ioOf((url) => {
		if (url.host === "echodata.epa.gov") {
			echoCalls += 1;
			return late(echoCalls === 1 ? plan.echoSummary : plan.echoPage);
		}
		if (url.host === "data.epa.gov") return late(plan.status(epaIdOf(url)));
		if (url.host === "hazards.fema.gov") return late(plan.nfhl);
		if (url.pathname.includes("FRS_INTERESTS_SEMS")) return late(plan.semsLayer);
		if (url.pathname.includes("/FRS_INTERESTS/")) return late(plan.frs(registryIdOf(url)));
		if (url.pathname.includes("USA_Flood_Hazard_Reduced_Set")) return late(plan.esri);
		// AQS and AirNow are absent by design rather than by omission. The unit
		// suite holds no air credential (`tests/setup/no-ambient-credentials.ts`),
		// so both adapters fail before the network and neither host is ever asked.
		// Routing them would be routing a URL this test can never see.
		throw new Error(`the stub io was asked for an unrouted URL: ${url.host}${url.pathname}`);
	});
}

function rest(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Drives the route, cancels after the first line, and counts requests at the cancel and after it. */
async function cancelAfterFirstCard(): Promise<{ readonly atCancel: number; readonly afterwards: number }> {
	const { urls, io } = slowly(DEMO);
	const response = await createReportHandler(io)(
		new Request("http://localhost/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(HOUSTON),
		}),
	);
	const body = response.body;
	if (body === null) throw new Error("the report route answered with no body");

	const reader = body.getReader();
	await reader.read();
	await reader.cancel();

	const atCancel = urls.length;
	await rest(WATCH_AFTER_CANCEL_MS);
	return { atCancel, afterwards: urls.length };
}

describe("a reader who closes the tab stops the requests, not only the events", () => {
	it("issues no further upstream request after the cancel", async () => {
		const { atCancel, afterwards } = await cancelAfterFirstCard();

		// The number itself is not the assertion and must not become one: it
		// depends on how far the fan-out got in the milliseconds before the
		// cancel, which is a scheduling detail. What is asserted is that it stops
		// growing. Before this was fixed it went from 3 to 25.
		expect(atCancel).toBeGreaterThan(0);
		expect(
			afterwards,
			`${afterwards - atCancel} requests were issued after the reader had gone`,
		).toBe(atCancel);
	});

	it("leaves the whole report uncancelled when nobody disconnects", async () => {
		// The other half of the guarantee. A signal that fired on its own, or an
		// adapter that treated every run as abandoned, would pass the test above
		// and produce an empty report. This is what stops that.
		const { urls, io } = slowly(DEMO);
		const response = await createReportHandler(io)(
			new Request("http://localhost/api/report", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(HOUSTON),
			}),
		);
		const text = await response.text();

		expect(text).toContain('"type":"card"');
		expect(text).toContain('"type":"end"');
		expect(urls.length).toBeGreaterThan(20);
	});
});
