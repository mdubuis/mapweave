# Era map snapshots

Each "type: era" wiki entity under `wiki/eras/` names a `map_file` (e.g. `founding.map`). Drop the
real `.map` file FMG exports (Menu → Save) for that era right here, under the same name, and the
era switcher (top of the map screen) will load it via `?maplink=`.

The two files this seed content expects — `founding.map` and `post-war.map` — are not included:
generating a legitimate one means actually building out that era's map in the app. Until they
exist, selecting that era in the switcher will just fail to load with FMG's normal "invalid map
link" message, which is expected, not a bug.
