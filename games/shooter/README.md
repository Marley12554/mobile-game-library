# Zombie Gates

The gate shooter from the mobile ads, built as the actual game. No ads, no timers, no paywalls.

Play: https://marley12554.github.io/mobile-game-library/shooter/

Drag left and right. Your squad fires on its own. Run through gates to grow, shoot gates to raise them, and decide whether the frozen prize is worth the bullets. 40 levels over 5 worlds, each world adding one new enemy, one new gate type and one new weapon, and ending in a boss.

```bash
npm run dev       # from the repo root
npm test
npx vite-node -c vitest.config.ts scripts/tune.ts 2-   # bot tuning report for world 2
```

Levels are JSON in `levels/`. See `CLAUDE.md` for the design rules and the code map.
