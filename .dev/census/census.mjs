#!/usr/bin/env node
// Counts the factual claims the report must render, by the scope of the thing
// each claim is about. Rerun after editing claims.tsv:
//   node .dev/census/census.mjs
import { readFileSync } from "node:fs";

const rows = readFileSync(new URL("./claims.tsv", import.meta.url), "utf8")
	.trim()
	.split("\n")
	.slice(1)
	.map((line) => {
		const [claim, rule, scope] = line.split("\t");
		return { claim, rule, scope };
	});

const tally = new Map();
for (const r of rows) tally.set(r.scope, (tally.get(r.scope) ?? 0) + 1);

const total = rows.length;
const ranked = [...tally].sort((a, b) => b[1] - a[1]);

console.log(`claims the report must render: ${total}\n`);
for (const [scope, n] of ranked) {
	const pct = Math.round((n / total) * 100);
	console.log(`  ${scope.padEnd(8)} ${String(n).padStart(3)}  ${pct}%  ${"#".repeat(n)}`);
}

const recordScoped = tally.get("record") ?? 0;
console.log(`\nrecord-scoped: ${recordScoped} of ${total} (${Math.round((recordScoped / total) * 100)}%)`);
console.log(
	recordScoped / total > 0.5
		? "premise holds: most claims are about one record"
		: "premise fails: most claims are about something other than one record",
);
