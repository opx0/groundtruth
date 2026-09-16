import { createFetchSourceIo } from "@/lib/io/fetch-source-io";
import { createGeocodeHandler } from "./handler";

export const runtime = "nodejs";

export const POST = createGeocodeHandler(createFetchSourceIo());
