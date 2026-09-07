#!/usr/bin/env bash
# Decision trail. usage: .dev/log.sh <phase> <decision> <why> <evidence> <result>
set -euo pipefail
F="$(dirname "$0")/decisions.tsv"
[ -f "$F" ] || printf 'ts\tphase\tdecision\twhy\tevidence\tresult\n' > "$F"
clean(){ printf '%s' "$1" | tr '\t\n' '  ' | sed 's/^[=+@-]/'"'"'&/'; }
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(clean "$1")" "$(clean "$2")" "$(clean "$3")" "$(clean "$4")" "$(clean "$5")" >> "$F"
