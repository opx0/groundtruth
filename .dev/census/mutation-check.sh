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
# Retargeted 2026-09-16: the clause this mutated used to read "Status: " and
# now reads "NPL status: " / "Non-NPL status: ", because non_npl_status_name
# was labelled "Status:" while npl_status_name carried no label at all. The
# case is the same one -- change a rendered sentence, watch a test catch it.
try "rendered sentence text changed"    lib/templates/sems.ts 's|NPL status: |NPL statuz: |' vt
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

# Guard 8. A template that speaks about one state of a record now declares it,
# and `assemble` refuses to render otherwise. Before that, the wrong Superfund
# template rendered happily over the right record: `sems-site/registry-only@1`
# said the inventory returned no status row over a site whose row had joined.
# Strip the requirement and the templates go back to overlapping; the test that
# pins which template speaks for which record is what has to notice.
st() { pnpm exec vitest run tests/unit/templates/sems.test.ts; }
try "template requirement removed"      lib/templates/sems.ts 's|{ state: "statusRow", is: "no-row" }|{ state: "statusRow", is: "joined" }|' st

echo
echo "guards that bit: $pass   guards that did not: $fail"
[ "$fail" -eq 0 ] || exit 1
