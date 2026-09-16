#!/usr/bin/env bash
#
# Records ECHO and FEMA NFHL responses that cannot be reached from every
# network. Run from the repo root on a US-reachable host, or on this machine
# with a US VPN active:
#
#   bash scripts/capture-us-fixtures.sh
#
# Writes only into tests/fixtures/echo and tests/fixtures/fema.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
mkdir -p tests/fixtures/echo tests/fixtures/fema

# The demo address from .dev/BRIEF.md A6. A public industrial block, not a home.
LAT=29.720659
LON=-95.261996
ok=0
fail=0

get() { # label, outfile, url
  local label="$1" out="$2" url="$3" code
  code=$(curl -sS --max-time 120 --retry 2 --retry-delay 3 -o "$out" -w '%{http_code}' "$url" || echo 000)
  if [[ "$code" == "200" && -s "$out" ]] && ! head -c 400 "$out" | grep -qi '"error"'; then
    printf '  ok    %-42s %8s bytes\n' "$label" "$(wc -c <"$out" | tr -d ' ')"
    ok=$((ok + 1))
  else
    printf '  FAIL  %-42s http=%s\n' "$label" "$code"
    rm -f "$out"
    fail=$((fail + 1))
  fi
}

echo "capturing ECHO:"
ECHO_BASE="https://echodata.epa.gov/echo/echo_rest_services"

# ECHO omits FacLong from the default response even though FAC_LONG is column
# 18 of its own metadata. Facilities then arrive with a latitude and no
# longitude and no distance can be computed. These IDs request it explicitly
# along with the compliance and enforcement columns the report renders.
COLS="1,2,3,4,5,6,9,15,16,17,18,34,35,36,37,38,39,40,43,55,56,61,62,63,95,96"

get "facilities within 5 miles" \
    tests/fixtures/echo/facilities-5mi-houston.json \
    "${ECHO_BASE}.get_facilities?output=JSON&p_lat=${LAT}&p_long=${LON}&p_radius=5&qcolumns=${COLS}"

# The paged result needs the QueryID from the call above.
QID=$(python3 -c "
import json,sys
try:
    print(json.load(open('tests/fixtures/echo/facilities-5mi-houston.json'))['Results'].get('QueryID',''))
except Exception:
    print('')
" 2>/dev/null)

if [[ -n "$QID" ]]; then
  get "page 1 of that result set" \
      tests/fixtures/echo/facilities-page-1.json \
      "${ECHO_BASE}.get_qid?output=JSON&qid=${QID}&pageno=1&qcolumns=${COLS}"
else
  printf '  skip  %-42s no QueryID to page with\n' "page 1 of that result set"
fi

get "column metadata" \
    tests/fixtures/echo/metadata.json \
    "${ECHO_BASE}.metadata?output=JSON"

get "detailed facility report" \
    tests/fixtures/echo/facility-detail.json \
    "https://echodata.epa.gov/echo/dfr_rest_services.get_dfr?output=JSON&p_id=110000460885"

get "no facilities, remote Nevada" \
    tests/fixtures/echo/facilities-none-nevada.json \
    "${ECHO_BASE}.get_facilities?output=JSON&p_lat=40.5&p_long=-117.0&p_radius=1"

echo
echo "capturing FEMA NFHL:"
NFHL="https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query"
FIELDS="FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID,FLD_AR_ID,STATIC_BFE,SOURCE_CIT"

get "zone AE, Pasadena TX" \
    tests/fixtures/fema/nfhl-zone-ae-pasadena.json \
    "${NFHL}?geometry=-95.219950,29.717476&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${FIELDS}&returnGeometry=false&f=json"

# The point that matters most. The Esri fallback drops unshaded X entirely, so
# only the authoritative layer can tell "minimal hazard" from "not mapped".
get "minimal hazard, Houston ship channel" \
    tests/fixtures/fema/nfhl-minimal-hazard.json \
    "${NFHL}?geometry=${LON},${LAT}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${FIELDS}&returnGeometry=false&f=json"

get "layer definition" \
    tests/fixtures/fema/nfhl-layer-28.json \
    "${NFHL%/query}?f=json"

echo
echo "captured $ok, failed $fail"
if (( fail > 0 )); then
  echo
  echo "A failure here usually means this host cannot reach the endpoint either."
  echo "Check with: curl -sS -o /dev/null -w '%{http_code}\n' https://echodata.epa.gov/"
  exit 1
fi
