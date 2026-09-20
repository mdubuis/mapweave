# Mapweave

Mapweave is a worldbuilding platform: a generated fantasy map and a cross-linked lore wiki, all in
one app, for writers, game masters, and cartographers.

Repository: [github.com/mdubuis/mapweave](https://github.com/mdubuis/mapweave). See `LAUNCH.md` for
how to run it and `MAPWEAVE.md` for the project's vision and phase history.

This project is a fork of Azgaar's Fantasy Map Generator, evolving the original map-generation
engine into a worldbuilding platform with a wiki, bidirectional map↔lore links, and a timeline.

_Inspiration for the underlying map generation:_

- Martin O'Leary's [_Generating fantasy maps_](https://mewo2.com/notes/terrain)
- Amit Patel's [_Polygonal Map Generation for Games_](http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation)
- Scott Turner's [_Here Dragons Abound_](https://heredragonsabound.blogspot.com)

## Contribution

Pull requests are welcome. See `docs/architecture/architecture.md` and
`docs/architecture/data-model.md` before contributing.

The codebase is gradually transitioning from **vanilla JavaScript to TypeScript** while maintaining
compatibility with the existing generation pipeline and old `.map` user files.

The architecture is based on a separation between **world data**, **procedural generation**,
**interactive editing**, and **rendering**. The application is conceptually divided into four main
layers: world data and styles (state), generators (model), editors (controllers), renderers (view).

Flow:
settings → generators → world data → renderer
UI → editors → world data → renderer.

The data layer must contain no logic and no rendering code. Generators implement the procedural
world simulation. Editors implement interactive editing tools used by the user. They perform
controlled mutations of the world state. Editors can be viewed as interactive generators. The
renderer converts the world state into SVG or WebGL graphics. Renderer must be pure visualization
step and not modify world data.
