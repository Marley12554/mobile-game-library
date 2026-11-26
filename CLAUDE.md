# Mobile game library

An ad-free collection of mobile web games based on the genres in mobile game ads. Each game is the game the ad shows, not the bait-and-switch.

## Layout

- `games/<name>/` one folder per game, each with its own `CLAUDE.md` brief. Read it before working on that game.
- `games/shooter/` Zombie Gate Shooter, the first game and the only one in scope right now.
- `engine/` deterministic 2D physics and rule graph, copied from the ball-sim repo. Read `engine/SOURCE.md` before touching it: it is not edited here.
- `scripts/` build helpers.

## Build and deploy

- TypeScript, Vite, Canvas 2D, Vitest. `npm run dev`, `npm test`, `npm run build`.
- Pushing to `main` runs the tests, builds, and publishes `dist/` to the `gh-pages` branch. Each game is served from its own folder: https://marley12554.github.io/mobile-game-library/shooter/
- No shared collection shell (game picker, shared menus, cross-game saves) until the second game starts. Keep menu, settings and save code separate from gameplay code so it can be pulled out then.

## Working with the user

- The user is a CS + math student and builds side projects with Claude doing most of the coding. The game ideas are theirs.
- When a message mixes questions and change requests, answer the questions first, then implement, narrating each step. If they say not to code yet, only answer.
- Be direct and push back when something is actually wrong, in proportion to the problem.
- Push work when a step is done.
