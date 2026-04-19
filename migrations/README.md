# Database Migrations

## migrateSkinsStructure.js

Converts user cosmetics data from the old flat structure to the new nested structure.

### Purpose

The game's cosmetics system was restructured to support:
- Multiple categories: player skins, grapple hooks, and bombs
- Nested storage format: `skins[category][id] = { unlocked, equipped }`
- Cleaner data organization and easier to extend for new cosmetic types

### What It Does

**Migrates:**
- `equippedSkin` + `unlockedSkins` → `skins.player[id]`
- `equippedGrapple` + `unlockedGrapples` → `skins.grapples[id]`
- Initializes `skins.bombs` with default bomb skin

**Ensures:**
- All users have a `default` entry (unlocked and equipped) for each category
- Old data fields are preserved for backward compatibility
- No data loss during conversion

### Old Format
```javascript
{
  equippedSkin: "cyan",
  unlockedSkins: ["default", "cyan", "metallic"],
  equippedGrapple: "default",
  unlockedGrapples: ["default", "cyan"]
}
```

### New Format
```javascript
{
  skins: {
    player: {
      default: { unlocked: true, equipped: false },
      cyan: { unlocked: true, equipped: true },
      metallic: { unlocked: true, equipped: false }
    },
    grapples: {
      default: { unlocked: true, equipped: true },
      cyan: { unlocked: true, equipped: false }
    },
    bombs: {
      default: { unlocked: true, equipped: true }
    }
  },
  // Legacy fields still present for backward compatibility
  equippedSkin: "cyan",
  unlockedSkins: ["default", "cyan", "metallic"],
  equippedGrapple: "default",
  unlockedGrapples: ["default", "cyan"]
}
```

### Running the Migration

#### Automatic (Recommended)
The migration runs automatically on server startup:
```bash
npm start
```

Check the console output for:
```
[Migration] Starting skins structure migration...
[Migration] Found X users to migrate
[Migration] Migrated user: username
...
[Migration] Complete! Migrated: X, Already migrated/skipped: Y
```

#### Manual
Run the migration script directly:
```bash
node migrations/migrateSkinsStructure.js
```

Set the MongoDB URI via environment variable if needed:
```bash
MONGODB_URI=mongodb://localhost:27017/ugg-game node migrations/migrateSkinsStructure.js
```

### Rollback

If needed, you can restore the old structure by reverting:
1. User model to old schema
2. Server.js to remove migration call
3. Database snapshots (recommended: keep pre-migration backup)

The old fields are preserved in the database, so manual rollback is possible.

### Backward Compatibility

- Old API endpoints still work (return both old and new formats)
- Existing clients remain functional during transition
- New cosmetics system is forward-compatible for future item types
