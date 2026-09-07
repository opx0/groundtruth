# Data tests — 2026-09-15 (live, reproducible)

Question: can free global data tell a person whether a specific address floods?
Test set: Bangalore streets with a known 2022 flood record vs dry controls.

## 1. Optical water history (JRC Global Surface Water, Landsat 1984–2021, 30 m)
Tile: occurrence_70E_20Nv1_4_2021.tif (49 MB, public GCS, no key)

| Point | Occurrence max within 250 m |
|---|---|
| Bellandur Lake centre (control, is a lake) | 66 % |
| Rainbow Drive Layout (flooded 2022, deaths) | 0 % |
| Epsilon / Yemalur (flooded 2022) | 0 % |
| Silk Board (floods every monsoon) | 0 % |
| Indiranagar 100ft Rd (dry) | 0 % |

Verdict: FAILS for streets. Landsat revisit + monsoon cloud never captures a 6-hour urban flood.
Only useful for "this plot used to be a lake" (change layer shows lost water pixels around Bellandur).
Do NOT pitch "see every time it was underwater since 1984". That claim is false.

## 2. Terrain: height above nearest drainage (Copernicus DEM GLO-30, free on AWS, no key)
Computed with pysheds: fill → flowdir → accumulation → HAND, drainage = cells with >0.9 km² upstream.

| Point | HAND (min within 100 m) | Known outcome |
|---|---|---|
| Rainbow Drive Layout | 0.0 m | flooded 4 monsoons running, 5–6 ft |
| Silk Board junction | 0.0 m | floods yearly |
| Epsilon / Yemalur | 5.0 m | flooded 2022 |
| Koramangala 4th block | 2.6 m | floods occasionally |
| Indiranagar 100ft Rd | 10.5 m | dry |
| Jayanagar 4th block | 10.9 m | dry |

Verdict: PASSES. Every known flood point ≤ 5 m; every dry control ≥ 10 m. Global coverage, one 40 MB tile per 1°.
Caveat: GLO-30 is a surface model (includes buildings). Good enough for a verdict, not for engineering.

## 3. Reported record (web search, Claude-driven)
"Rainbow Drive Layout flood" → dated deaths (30 Aug 2022), causal explanation (kaluve ends at the layout,
main road raised 3 ft above valley floor), 4 consecutive monsoons, demolition notices for 13 villas.
"Indiranagar 100 ft road flooding" → generic city-wide waterlogging, nothing street-specific.
Verdict: PASSES and discriminates. This is the layer that gives the "why", with citations.

## Conclusion
Credible verdict per address = terrain (HAND) + reported record (search with citations) + lake-loss (JRC change).
Data is fungible under the hood; the product claim is "will this address flood, and why", not "satellite history".

Scripts: scratchpad readpix.py, relief.py, hand.py, readchg.py (session 5292abf6).
Sources: https://citizenmatters.in/rainbow-drive-layout-or-lake-bengaluru-flood-prone-neighbourhoods/ ,
https://thesouthfirst.com/karnataka/three-years-on-rainbow-drive-in-bengaluru-still-awaits-a-permanent-solution-to-the-flooding-problem/ ,
https://scroll.in/article/1032186/at-bengalurus-rainbow-drive-a-snapshot-of-the-citys-man-made-flood-challenges
