/**
 * POST only, for the same reason the geocode route is: a GET would put the
 * confirmed coordinate in the request URL, where it reaches server access logs,
 * browser history and proxy caches without this file ever touching it.
 * `docs/BRIEF.md` B9 forbids exactly that.
 *
 * Thin, like the geocode one. See `handler.ts` for the privacy obligations this
 * route holds and for why the origin sentences are not among them.
 */

import { createCacheSourceIo } from "@/lib/io/cache-source-io";
import { createFetchSourceIo } from "@/lib/io/fetch-source-io";
import { createReportHandler } from "./handler";

export const runtime = "nodejs";

/**
 * The stream is what makes the report usable: ECHO's five-mile query needs a
 * 45-second timeout and SEMS answers in about a second, so a report that waited
 * for both would show nothing for 45 seconds. Nothing here may be cached or
 * pre-rendered -- every card is a live answer about one point.
 */
export const dynamic = "force-dynamic";

/**
 * The B9 cache wraps the fetch io here and nowhere else. It is created once per
 * process, holds one `Map` that dies with the process, and keys on a digest of
 * the URL an adapter asked for -- never on anything about who asked, which is
 * not in scope at that seam. `app/api/geocode/route.ts` does not wrap its io,
 * so the one request that carries an address is never cached; see
 * `lib/io/cache-source-io.ts` for the lifetimes and for what a heap dump shows.
 */
export const POST = createReportHandler(createCacheSourceIo(createFetchSourceIo()));
