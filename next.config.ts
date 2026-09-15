import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	/**
	 * Cloud Run serves this from a container, and the authoritative FEMA layer
	 * is the reason it has to. `hazards.fema.gov` resets the TLS handshake from
	 * every non-US egress tried, so the deployment has to originate its requests
	 * in a US region for the flood card to reach the layer it names first.
	 *
	 * `standalone` emits `.next/standalone/server.js` with only the modules that
	 * are actually reachable, so the runtime image carries no build toolchain
	 * and no dev dependency. It does not change `.next/static`, which is what
	 * `tests/unit/app/privacy.test.ts` scans for credentials.
	 */
	output: "standalone",
};

export default nextConfig;
