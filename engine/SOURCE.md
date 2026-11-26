# Where this engine comes from

`engine/` is a copy of `/engine` from [Marley12554/ball-sim](https://github.com/Marley12554/ball-sim). The ball-sim project owns it.

Copied from ball-sim commit `8189c929512d0efd769770db805253dca803e847` (2026-11-25).

Rules:

- Don't edit files here directly. A fix or feature goes into ball-sim's engine first, then gets copied over.
- To update: copy `engine/src`, `engine/test`, `engine/bench` and `engine/README.md` from ball-sim's main branch, run `npm test`, and update the commit above.
- Game-specific code (bullets, steering, rendering, input) lives in the game's folder, never in here.
