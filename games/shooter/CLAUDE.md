# Zombie Gate Shooter: project brief

Handoff from a planning chat. This file is the source of truth for scope and early decisions until the user says otherwise. It lives at games/shooter/CLAUDE.md.

## What this is

The first game in an ad-free collection of mobile games based on the genres in mobile game ads. The goal is to build the game the ad actually shows, not the bait-and-switch players get after installing.

- No ads, no paywalls, no pay-to-skip, no boosts, no energy timers.
- It can be genuinely hard. Difficulty comes from real tension and smart level design, not from friction meant to sell things.

Only this game is in scope for now. Other genres come later (see "The collection"). Parking jam is excluded: the user already has a game like it (Circuit Jam).

## Core gameplay

- The player is a squad leader on a horizontal track at the bottom of the screen. Dragging left/right moves them along the track. They fire constantly on their own. There is no aim or fire button.
- Gates sit in lanes ahead of the player and scroll toward them. Shooting or passing through a gate changes the squad: +N soldiers, xN soldiers, fire rate, damage, weapon type. Some gates are negative.
- A big prize, like a mech or heavy weapon frozen in ice, has a huge HP bar and only unlocks after the squad pours a lot of bullets into it.
- A zombie horde keeps rushing in.
- **The core tension:** every bullet spent on a gate or the frozen prize is a bullet not spent on zombies. Most of the design and tuning work is about making that tradeoff hurt.

## Progression philosophy (the most important section)

The problem being avoided: in most games of this genre, difficulty barely changes. Each new weapon just raises enemy HP, so the player is "further along" but playing the same thing on repeat. **Progress must change what the player has to decide, not just the numbers.**

Rules:

1. **Run power vs permanent power.** Most power comes from inside a level (gates, the frozen prize, pickups) and resets when the level ends. Permanent progress mostly unlocks *options* (weapons, abilities, soldier types), not bigger stats. The user's lean: almost everything resets, with a small permanent stat layer so long-term progress is still felt. Confirm the size of that layer with the user before building it.
2. **New problems, not bigger versions of old ones.** Each enemy type needs a different response. Examples:
   - armored front-liners that need piercing
   - splitters that punish explosive weapons against tight packs
   - fast runners that come down one lane and force movement
   - shielded enemies that can only be hit from an angle or after a trigger
   - gate thieves that walk through a gate and flip it negative
3. **Weapons are tradeoffs, not upgrades.** Spread, piercing, explosive and slowing beam are each strong against some threats and weak against others. A new weapon opens a new tactic. Never add a weapon that is strictly better than an existing one.
4. **Gates are real decisions.** Use:
   - gates with costs (x3 fire rate, -50% damage)
   - negative gates that can be shot until they flip positive, which costs attention
   - moving and timed gates
   - lane risk, where the best gate sits in the lane the horde is coming down
   Going for the frozen prize should be a real gamble that can lose the level.
5. **Hand-made levels.** Track forks, chokepoints, staged waves, bosses with learnable patterns. Difficulty comes from decision density and how little slack the player has, not enemy HP.

**Test for every level:** it must ask for something the previous three didn't.

## Structure

- **Levels, not endless runs.** The player needs pauses. A level is a short, designed run with a clear end (survive to the end / kill the boss).
- **Worlds** of about 8 to 10 levels. Each world introduces one new enemy, one new gate type and maybe one new weapon, and ends with a boss that tests them together. Later worlds combine earlier mechanics.
- **Between levels:** loadout choice (weapon, soldier types, ability) and any small permanent unlocks.
- **Target size:** a finite campaign of about 40 to 60 levels. A modifier or challenge mode can come later. Don't try to make the campaign scale forever: the input is one-dimensional (left/right), which limits depth, and a well-made finite campaign beats an infinite repetitive one.
- Levels are data (JSON or similar: waves, gates, track layout, boss), not code, so they're quick to make and tune.

## Visual direction

The bright, punchy mobile-ad look, on purpose. The sim project in this repo goes the other way (clean gallery) because it is a simulation site, not a game. Don't mix the two looks.

- **Characters:** the blobby stickmen from these ads. Rounded, simple, faceless figures. **Blue blobs are the player's squad, red blobs are the enemies.** No realistic soldiers or zombies. Zombies are red blobs with a lurching walk and maybe a darker tint or simple features to tell them apart from other red enemies.
- **Gates:** big readable panels with huge numbers (+10, x3, -5), colored by value (blue/green good, red bad).
- **Juice:** squads visibly growing and shrinking, crowds spilling across the track, hit flashes, chunky number pops, screen shake on big moments, ice cracking as the frozen prize takes damage, a satisfying burst when it breaks.
- **Readability first.** With hundreds of units on screen, the player must always be able to tell where the threats are, which gate is which, and where their squad is.
- Don't invent or copy any specific game's characters, logos or branding. Keep to the generic genre look.

## Technical setup

- **Platform:** web (TypeScript + canvas), built for phones (touch drag, portrait), deployed on GitHub Pages.
- **Repo layout:** this game lives in games/shooter of the mobile-game-library repo, deployed at https://marley12554.github.io/mobile-game-library/shooter/. The repo is separate from ball-sim on purpose.
- **Engine:** /engine is a copy of the engine from the ball-sim repo (see engine/SOURCE.md). Reuse its physics world for crowds, the spatial hash, Rng/dmath/Runner and the rule system:
  - a gate is "on bullet hit -> modify squad"
  - the frozen prize is "on hit -> lose HP, at 0 -> unlock"
  Hand-written level data should use a compact gate format that compiles to rule triggers at load time, not raw node graphs (the graph format is built for ball-sim's visual editor).
- **Engine ownership:** the ball-sim project owns the engine. Don't edit the copy here. If an engine change is needed, describe it to the user so it can be made in ball-sim and copied over. Game-specific needs (bullets, steering, rendering, input) are game code.
- Push work when a step is done.

### Engine review (step 1, done)

- Reusable as-is: body-body crowd physics (horde and squad bunching), layer/mask teams, `frozen` for parking off-screen units, standalone `SpatialHash`, `Rng`, `dmath`, `Runner`, `Registry`/`Dispatcher` for gate and prize effects.
- Game-side: bullets as a pooled array tested against a SpatialHash of enemies (not world bodies), steering by setting velocities each step, renderer, touch input, camera/scroll, audio.
- No engine changes needed so far.

## Build order

1. Read the engine and its README. Report what's reusable and what's missing for a shooter. Don't edit the engine.
2. Core feel prototype: drag movement, auto-fire, a simple horde, a handful of gates. One test level. The user plays this before anything else is built. If moving and shooting don't feel good, nothing else matters.
3. The frozen prize and the bullets-on-prize vs bullets-on-horde tension. Tune it until committing feels like a real gamble.
4. Level data format and a level loader. Rebuild the test level as data.
5. World 1: about 8 levels and a boss, introducing the first enemy types and gate types.
6. Between-level screen: loadout choice, permanent unlocks.
7. Visual juice pass across everything built so far.
8. Later worlds, each following the "one new enemy, one new gate, maybe one weapon" rule.

## The collection (later, not now)

This game is the first of a collection of ad-genre games, all ad-free. Other games may be endless, level-based, or both. That's decided per game.

- **Don't build the collection shell** (game picker, shared menus, settings, cross-game progress) yet. Build this game as a real standalone game first. Pull out the shared shell when the second game starts.
- Keep menus, settings and save code reasonably separate from shooter code so pulling the shell out later is easy.

## Working with the user

- The user is a CS + math student and builds side projects with Claude doing most of the coding.
- When a message mixes questions and change requests: answer the questions first, then implement, narrating each step as it happens. If the user says not to code yet, only answer.
- Be direct, and push back when something is actually wrong, in proportion to the problem. Don't overstate scope: this is a 2D mobile game.
