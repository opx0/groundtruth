import { NextResponse } from "next/server";
import { geocode } from "@/lib/adapters/census";
import { emptyStore, render, SourceFailure } from "@/lib/evidence";
import type { GeocodeMatch, SourceIo } from "@/lib/evidence";
import { sentenceView } from "@/lib/report/sentence-view";
import type { SentenceView } from "@/lib/report/sentence-view";
import { originTemplates } from "@/lib/templates/origin";
import {
	GeocodeApiResponseSchema,
	GeocodeRequestSchema,
	type GeocodeApiResponse,
	type GeocodeMatchView,
	type OriginSentence,
} from "@/app/lib/geocode-contract";

const NO_RECORDS = emptyStore;

function toOriginSentence(view: SentenceView): OriginSentence {
	const { templateId, spans, trace } = view;
	if (trace === null) return { templateId, spans, trace: null };
	if (trace.scope !== "origin") {
		throw new Error("geocode handler: an origin sentence produced a trace of another scope");
	}
	return { templateId, spans, trace: { scope: trace.scope, origin: trace.origin, values: trace.values } };
}

function originSentences(match: GeocodeMatch): readonly OriginSentence[] {
	const out: OriginSentence[] = [];
	for (const template of originTemplates) {
		const sentence = render(NO_RECORDS, { scope: "origin", match, template });
		if (sentence === null) continue;
		out.push(toOriginSentence(sentenceView(NO_RECORDS, sentence)));
	}
	return out;
}

function toMatchView(match: GeocodeMatch): GeocodeMatchView {
	return {
		matchedAddress: match.matchedAddress.value,
		latitude: match.point.latitude.value,
		longitude: match.point.longitude.value,
		origin: originSentences(match),
	};
}

function respond(body: GeocodeApiResponse, init?: ResponseInit): Response {
	return NextResponse.json(GeocodeApiResponseSchema.parse(body), init);
}

function failureReason(error: unknown): string {
	return error instanceof SourceFailure ? error.reason : "unknown";
}

export function createGeocodeHandler(io: SourceIo) {
	return async function POST(request: Request): Promise<Response> {
		let address: string;
		try {
			const json: unknown = await request.json();
			({ address } = GeocodeRequestSchema.parse(json));
		} catch {
			return respond({ status: "invalid" }, { status: 400 });
		}

		try {
			const outcome = await geocode(address, io);
			if (outcome.status === "matched") {
				return respond({ status: "matched", match: toMatchView(outcome.match) });
			}
			if (outcome.status === "ambiguous") {
				const [first, second, ...rest] = outcome.candidates.map(toMatchView);
				if (first === undefined || second === undefined) {
					throw new Error("geocode handler: an ambiguous outcome lost its tuple shape");
				}
				return respond({ status: "ambiguous", candidates: [first, second, ...rest] });
			}
			return respond({ status: "no-match" });
		} catch (error) {
			console.error("geocode: source unavailable", { reason: failureReason(error) });
			return respond({ status: "unavailable" }, { status: 503 });
		}
	};
}
