UNTIL ZOMBIES COME ONLINE v3.3 — EXPLOSIVE PARTICLES + LESS BLOOD

Based on working v3.2.

CHANGES
- Particle upgrades on ANY weapon trigger a visible red blast ring on impact, starting at Particle 1.
- Explosion area and damage scale by Particle level:
  Particle 1: radius 90 px, damage 95
  Particle 2: radius 120 px, damage 145
  Particle 3: radius 155 px, damage 210
- Bigg Bos doubles explosive damage.
- Shotgun triggers one explosion per shot (rather than six) to avoid performance spikes.
- New Less Blood perk: €1500, raises maximum HP from 100 to 150 and instantly restores 50 HP.
- MEDKIT €250 now heals up to the player's current maximum HP.
- Existing guns, doors, party system and admin login are preserved.

INSTALL
1. Unzip.
2. In GitHub, replace server.js and public/index.html with these versions.
3. Commit changes; wait for Render deployment to show Live.
4. Reload the site with Ctrl+F5.

TEST
- Buy Particle 1 on Pistol, shoot a zombie and confirm red blast ring and nearby zombie damage.
- Test Particle 2 and 3 on another gun.
- Buy Less Blood and check HP becomes 150 max, then heal with MEDKIT.
- Test in a party with 2 players.

NOTE: JavaScript syntax checked, but full live multiplayer behavior requires testing on Render.
