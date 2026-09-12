/**
 * POST only, on purpose: a GET would put the address in the request URL,
 * where it can end up in server access logs, browser history, and proxy
 * caches without this file ever touching it. See `handler.ts` for the
 * privacy obligations this route holds.
 */

import { createFetchSourceIo } from "@/lib/io/fetch-source-io";
import { createGeocodeHandler } from "./handler";

export const runtime = "nodejs";

export const POST = createGeocodeHandler(createFetchSourceIo());
