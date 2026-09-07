#!/usr/bin/env bash
# Session and phase clock. Appends to .dev/session.tsv.
# usage: .dev/session.sh start <unit> <label> | .dev/session.sh end <unit> <result>
set -euo pipefail
F="$(dirname "$0")/session.tsv"
[ -f "$F" ] || printf 'ts\tevent\tunit\tdetail\telapsed_s\n' > "$F"
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
case "${1:-}" in
  start) printf '%s\tstart\t%s\t%s\t\n' "$now" "$2" "${3:-}" >> "$F" ;;
  end)
    s=$(awk -F'\t' -v u="$2" '$2=="start" && $3==u {t=$1} END{print t}' "$F")
    e=$(( $(date -u -d "$now" +%s) - $(date -u -d "${s:-$now}" +%s) ))
    printf '%s\tend\t%s\t%s\t%s\n' "$now" "$2" "${3:-}" "$e" >> "$F" ;;
  report)
    awk -F'\t' 'NR>1 && $2=="end"{t+=$5; n++; printf "  %-22s %6ds  %s\n",$3,$5,$4} END{printf "  %-22s %6ds  across %d units\n","TOTAL",t,n}' "$F" ;;
  *) echo "usage: session.sh {start|end|report}" >&2; exit 1 ;;
esac
