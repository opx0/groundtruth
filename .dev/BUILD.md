# Build notes

What got built, what's still open, and the things that went wrong along the
way. `BRIEF.md` next to this is the spec. This is the log.

## Where it is

```
bun run verify  695 tests, 38 files
bun run e2e     14 paths
mutation        8 of 8
bun run build   compiles standalone
```

Running on Cloud Run in `us-central1`, from the bun image the `Dockerfile`
builds:

    https://ground-truth-946486142611.us-central1.run.app

A live report across all six sources takes about eleven seconds, most of it
waiting on government APIs. The three keys are set on the service; nothing is
baked into the image. The Compute Engine box that used to serve this on port
8300 is gone, and with it the Caddy route it never got.

## The five kernel decisions

Code cites these by number, so the numbers are stuck.

1. **A claim's subject isn't always a record.** Five scopes: record, section,
   source, origin, group. This is why rendering is a pure read of the store,
   and why deleting a record deletes its sentence.
2. **Three source outcomes, not two.** `ok`, `no-data`, `unavailable`. A source
   nobody could ask hasn't answered with nothing.
3. **Adapters can't write a distance.** It's the kernel's haversine from the
   mapped point, never a number a source sent.
4. **Payloads are plural.** A record built from two responses cites both.
5. **The brand needs a lint rule.** `Sourced` dies to `x as unknown as
   Sourced<T>`, so assertions are banned under `lib/evidence` and
   `lib/adapters`.

## Things worth knowing before you touch it

Templates can't branch. Two wordings means two templates and the policy picks.
A missing slot drops its clause and the rest of the sentence survives.

Change a rendered sentence and five to eleven files go red. That's the design
working, not a problem. Update them; don't loosen an assertion to a substring.

`mutation-check.sh` has to say 8 of 8 after any kernel change. It breaks each
guarantee on purpose and checks the suite notices. Don't run it while anything
else is editing the repo — it mutates files in place.

The unit suite strips the three air keys before it runs. Four files assume this
deployment has none, and without that a shell holding real keys fails eight
tests with messages that never mention a credential.

Check port 3000 is free before `bun run e2e`. A stale server serves an old build
and the failures make no sense.

## Still open

Three queue items, all deliberate:

- **ArcGIS query dedup.** Declined. Three small copies that haven't drifted;
  closing it means writing the abstraction it exists to avoid.
- **An unmapped SFHA letter.** FEMA doesn't send one for these points. The
  layer answers now, so it isn't a reachability problem any more.
- **A slot-to-slot requirement arm.** No caller.

`SectionSpec.query` used to be the fourth and the only real one. It is closed:
`runSource` watches the io, and a count, a boundary and a "no matching records"
note now open on the request the adapter issued, the way a record sentence
opens on a raw field.

## What went wrong, and what it taught

**The air keys arrived and four guesses turned out wrong.** AQS's envelope was
`Data` not `Body`, two column names were wrong, and AirNow's `Category` was an
object where a guess would have said string. Each was found in minutes because
every guess had been written down as a caveat the recording could contradict. A
derived fixture is a bet; saying so out loud is how you collect.

**FEMA's layer wasn't refusing us, it was refusing the continent.** Same request
reset from India in 0.59s, reset from Singapore in 0.46s, answered from Iowa in
0.26s. Two days of assuming, ten minutes of measuring.

**Three committed tests couldn't fail.** Including both tests of an ordering you
could have deleted entirely with the suite green.

**Cancellation was a tenth of the predicted work.** The plan said every looping
adapter would need to honour a new signal. None did — adapters call `get` on
whatever io they're handed, so binding the signal to the io covered all of them.

**And measuring beat reading.** After that fix, one request still escaped every
run. It was the flood fallback, which asked Esri whenever the first leg failed
and never asked *why* it failed, so a cancelled leg looked like a refused one.

**The first request is not the first timestamp.** The section query started out
reading the earliest payload by `retrievedAt`, the way `complete` orders a
record's payloads. Every leg of a stub run shares one clock, so the tiebreak
fell to whichever URL sorted first, and SEMS cited an Envirofacts join instead
of the layer query that carried the boundary. Real clocks tie inside a second
too. The slot is taken when `get` is called now, not when it answers. Found by
a test written for a different reason -- that the request a section names is
redacted like any other -- which is the second time a leak assertion has caught
something that was not a leak.

**Run the suite somewhere other than your laptop.** On the deployment host with
real keys exported, eight tests failed that pass here.

## Blocked on someone else

FEMA's NFHL host refuses non-US traffic. It answers from `us-central1` and three
fixtures plus a live test are recorded from there. Nothing else is blocked.
