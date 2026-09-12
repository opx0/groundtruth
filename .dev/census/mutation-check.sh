#!/usr/bin/env bash
# Proves the kernel's guards actually fail when violated, rather than being
# decorative. Each mutation is applied, checked, and reverted.
# Run from the repo root: bash .dev/census/mutation-check.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
pass=0; fail=0

try() { # name, file, sed-expr, checker
	local name="$1" file="$2" expr="$3" check="$4"
	cp "$file" "/tmp/mut.bak"
	sed -i "$expr" "$file"
	if $check >/dev/null 2>&1; then
		echo "  NOT CAUGHT  $name"; fail=$((fail+1))
	else
		echo "  caught      $name"; pass=$((pass+1))
	fi
	cp "/tmp/mut.bak" "$file"
}

tc() { pnpm exec tsc --noEmit; }
vt() { pnpm exec vitest run tests/unit/evidence/render.test.ts; }

echo "mutating the kernel to prove the guards bite:"
try "wrong-kind field now allowed"      tests/unit/evidence/types.test.ts '0,/@ts-expect-error -- zoneCode/s|// @ts-expect-error -- zoneCode.*|//|' tc
try "prose-only clause now allowed"     tests/unit/evidence/types.test.ts 's|// @ts-expect-error -- a factual sentence.*|//|' tc
try "string interpolation now allowed"  tests/unit/evidence/types.test.ts 's|// @ts-expect-error -- a string is not a field.*|//|' tc
try "adapter may write distanceMeters"  tests/unit/evidence/types.test.ts 's|// @ts-expect-error -- distanceMeters is kernel-owned.*|//|' tc
try "rendered sentence text changed"    lib/templates/sems.ts 's|Status: |Statuz: |' vt
try "distance unit swapped"             lib/evidence/sentence.ts 's| km`| mi`|' vt

# The section scope added Reported, a second category of value beside Sourced,
# for facts no agency returned: counts, boundaries, failure causes. It has no
# exported constructor, so a template cannot mint one and smuggle prose past the
# provenance guard. This proves that, rather than trusting the reading.
probe() {
	cat > lib/__probe.ts <<'PROBE'
import { defineTemplate, sentence } from "@/lib/evidence/templates";
export const smuggle = defineTemplate("section", "section/smuggle@1", () => [
	sentence`${{ reported: "this home is safe", provenance: [] }}`,
]);
PROBE
	local out; out=$(pnpm exec tsc --noEmit 2>&1 | grep -c "__probe" || true)
	rm -f lib/__probe.ts
	[ "$out" -gt 0 ] && return 1 || return 0
}
if probe; then
	echo "  NOT CAUGHT  a template minted a Reported and smuggled prose"; fail=$((fail+1))
else
	echo "  caught      a template minted a Reported and smuggled prose"; pass=$((pass+1))
fi

echo
echo "guards that bit: $pass   guards that did not: $fail"
[ "$fail" -eq 0 ] || exit 1
