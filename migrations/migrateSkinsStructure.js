'use strict';

/**
 * Migration: Convert old cosmetics structure to new nested structure
 * 
 * Old format:
 *   equippedSkin, unlockedSkins
 *   equippedGrapple, unlockedGrapples
 * 
 * New format:
 *   skins.player[id] = { unlocked, equipped }
 *   skins.grapples[id] = { unlocked, equipped }
 *   skins.bombs[id] = { unlocked, equipped }
 */

const mongoose = require('mongoose');

// Import User model - adjust path as needed
const User = require('../models/User');

async function migrateSkinsStructure() {
  // try {
  //   console.log('[Migration] Starting skins structure migration...');
    
  //   const users = await User.find({});
  //   console.log(`[Migration] Found ${users.length} users to process`);
    
  //   let migratedCount = 0;
  //   let skippedCount = 0;
    
  //   for (const user of users) {
  //     try {
  //       let needsUpdate = false;
        
  //       // Ensure skins object exists
  //       if (!user.skins) {
  //         user.skins = {};
  //       }
        
  //       // ── Migrate Player Skins ──────────────────────────────
  //       // Detect if user has legacy skin data that hasn't been fully converted
  //       const hasLegacySkins = user.unlockedSkins && user.unlockedSkins.length > 0;
  //       const playerSkinCount = user.skins?.player ? Object.keys(user.skins.player).length : 0;
  //       const needsPlayerSkinMigration = hasLegacySkins && playerSkinCount <= 1;
        
  //       if (needsPlayerSkinMigration) {
  //         console.log(`  → Converting player skins for: ${user.username} (had: ${user.unlockedSkins.join(', ')})`);
  //         user.skins.player = {};
          
  //         // Migrate each unlocked skin
  //         for (const skinId of user.unlockedSkins) {
  //           user.skins.player[skinId] = {
  //             unlocked: true,
  //             equipped: skinId === user.equippedSkin
  //           };
  //         }
          
  //         // Ensure default exists if not already
  //         if (!user.skins.player.default) {
  //           user.skins.player.default = {
  //             unlocked: true,
  //             equipped: !user.equippedSkin || user.equippedSkin === 'default'
  //           };
  //         }
          
  //         needsUpdate = true;
  //       }
        
  //       // ── Migrate Grapples ──────────────────────────────────
  //       const hasLegacyGrapples = user.unlockedGrapples && user.unlockedGrapples.length > 0;
  //       const grappleSkinCount = user.skins?.grapples ? Object.keys(user.skins.grapples).length : 0;
  //       const needsGrappleMigration = hasLegacyGrapples && grappleSkinCount <= 1;
        
  //       if (needsGrappleMigration) {
  //         console.log(`  → Converting grapples for: ${user.username} (had: ${user.unlockedGrapples.join(', ')})`);
  //         user.skins.grapples = {};
          
  //         // Migrate each unlocked grapple
  //         for (const grappleId of user.unlockedGrapples) {
  //           user.skins.grapples[grappleId] = {
  //             unlocked: true,
  //             equipped: grappleId === user.equippedGrapple
  //           };
  //         }
          
  //         // Ensure default exists if not already
  //         if (!user.skins.grapples.default) {
  //           user.skins.grapples.default = {
  //             unlocked: true,
  //             equipped: !user.equippedGrapple || user.equippedGrapple === 'default'
  //           };
  //         }
          
  //         needsUpdate = true;
  //       }
        
  //       // ── Ensure Bombs ────────────────────────────────────
  //       if (!user.skins.bombs || Object.keys(user.skins.bombs).length === 0) {
  //         console.log(`  → Initializing bombs for: ${user.username}`);
  //         user.skins.bombs = {
  //           default: { unlocked: true, equipped: true }
  //         };
  //         needsUpdate = true;
  //       }
        
  //       // Save user if any changes were made
  //       if (needsUpdate) {
  //         await user.save();
  //         migratedCount++;
  //         console.log(`[Migration] ✓ Updated: ${user.username}`);
  //       } else {
  //         skippedCount++;
  //       }
  //     } catch (err) {
  //       console.error(`[Migration] ✗ Error with user ${user.username}:`, err.message);
  //     }
  //   }
    
  //   console.log(`[Migration] Complete!`);
  //   console.log(`  Migrated: ${migratedCount}`);
  //   console.log(`  Already migrated/up-to-date: ${skippedCount}`);
  //   return { migratedCount, skippedCount };
  // } catch (err) {
  //   console.error('[Migration] Fatal error:', err);
  //   throw err;
  // }
}

// Export for use in other files
module.exports = { migrateSkinsStructure };

// Run directly if executed as script
if (require.main === module) {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ugg-game';
  
  mongoose
    .connect(mongoUri)
    .then(() => {
      return migrateSkinsStructure();
    })
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
