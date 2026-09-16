import { createCacheSourceIo } from "@/lib/io/cache-source-io";
import { createFetchSourceIo } from "@/lib/io/fetch-source-io";
import { createReportHandler } from "./handler";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const POST = createReportHandler(createCacheSourceIo(createFetchSourceIo()));
