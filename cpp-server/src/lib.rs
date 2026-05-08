//! Rapier3D physics bridge exposed to C++ via cxx.
//!
//! Build with `cargo build --release`; the generated header lands at
//! `target/cxxbridge/rapier-bridge/src/lib.rs.h`.

use rapier3d::prelude::*;
use std::collections::HashMap;

// ── cxx bridge declaration ────────────────────────────────────────────────────

#[cxx::bridge(namespace = "rapier_bridge")]
pub mod ffi {
    /// 3-component float vector (shared POD type, zero-copy across FFI).
    struct Vec3f {
        x: f32,
        y: f32,
        z: f32,
    }

    /// Quaternion (shared POD type).
    struct Quat4f {
        x: f32,
        y: f32,
        z: f32,
        w: f32,
    }

    /// Result of a raycast query.
    struct RayHit {
        hit:     bool,
        toi:     f32,
        nx:      f32,
        ny:      f32,
        nz:      f32,
        body_id: u64,  // 0 = terrain / no body
    }

    extern "Rust" {
        type PhysicsWorld;

        /// Allocate and return a new physics world on the heap.
        fn new_world(gravity_y: f32) -> Box<PhysicsWorld>;

        // ── simulation ────────────────────────────────────────────────────────

        /// Advance the simulation by `dt` seconds.
        fn step_world(self: &mut PhysicsWorld, dt: f32);

        /// Replace the static collision mesh (called once after map load).
        /// `vertices` is a flat xyz array; `indices` is a flat triangle array.
        fn load_trimesh(self: &mut PhysicsWorld, vertices: &[f32], indices: &[u32]);

        // ── body management ───────────────────────────────────────────────────

        fn create_player_body(self: &mut PhysicsWorld, x: f32, y: f32, z: f32) -> u64;
        fn create_bomb_body(
            self: &mut PhysicsWorld,
            x: f32, y: f32, z: f32,
            ix: f32, iy: f32, iz: f32,
        ) -> u64;
        fn remove_body(self: &mut PhysicsWorld, id: u64);

        // ── getters ───────────────────────────────────────────────────────────

        fn get_pos(self: &PhysicsWorld, id: u64) -> Vec3f;
        fn get_vel(self: &PhysicsWorld, id: u64) -> Vec3f;
        fn get_rot(self: &PhysicsWorld, id: u64) -> Quat4f;

        // ── setters ───────────────────────────────────────────────────────────

        fn set_pos(self: &mut PhysicsWorld, id: u64, x: f32, y: f32, z: f32);
        fn set_vel(self: &mut PhysicsWorld, id: u64, x: f32, y: f32, z: f32);
        fn add_force(self: &mut PhysicsWorld, id: u64, x: f32, y: f32, z: f32);
        fn apply_impulse(self: &mut PhysicsWorld, id: u64, x: f32, y: f32, z: f32);
        fn reset_forces(self: &mut PhysicsWorld, id: u64);

        // ── queries ───────────────────────────────────────────────────────────

        /// True if `id` body has ground within 0.6 units below it.
        fn is_grounded(self: &PhysicsWorld, id: u64) -> bool;

        /// Cast a ray; exclude the body with `exclude_id` (pass 0 to skip).
        fn cast_ray(
            self: &PhysicsWorld,
            ox: f32, oy: f32, oz: f32,
            dx: f32, dy: f32, dz: f32,
            max_toi: f32,
            exclude_id: u64,
        ) -> RayHit;

        /// True if any of 6-axis probe rays around `hook_pos` hit geometry
        /// (excluding the player body `player_id`).
        fn hook_hits_geometry(
            self: &PhysicsWorld,
            hx: f32, hy: f32, hz: f32,
            player_id: u64,
        ) -> bool;

        /// Collect all dynamic body IDs within `radius` of centre.
        fn bodies_in_sphere(
            self: &PhysicsWorld,
            cx: f32, cy: f32, cz: f32,
            radius: f32,
        ) -> Vec<u64>;
    }
}

// ── PhysicsWorld implementation ───────────────────────────────────────────────

pub struct PhysicsWorld {
    gravity:            Vector<f32>,
    integration_params: IntegrationParameters,
    physics_pipeline:   PhysicsPipeline,
    island_manager:     IslandManager,
    broad_phase:        DefaultBroadPhase,
    narrow_phase:       NarrowPhase,
    bodies:             RigidBodySet,
    colliders:          ColliderSet,
    impulse_joints:     ImpulseJointSet,
    multibody_joints:   MultibodyJointSet,
    ccd_solver:         CCDSolver,
    query_pipeline:     QueryPipeline,

    // stable u64 IDs exposed across the FFI boundary
    next_id:       u64,
    id_to_handle:  HashMap<u64, RigidBodyHandle>,
    handle_to_id:  HashMap<RigidBodyHandle, u64>,

    // handles for static scene bodies (may need removal on map reload)
    static_bodies: Vec<RigidBodyHandle>,
}

// SAFETY: each GameRoom owns exactly one PhysicsWorld and accesses it from
// a single dedicated thread; no sharing across threads occurs.
unsafe impl Send for PhysicsWorld {}

pub fn new_world(gravity_y: f32) -> Box<PhysicsWorld> {
    Box::new(PhysicsWorld {
        gravity:            vector![0.0, gravity_y, 0.0],
        integration_params: IntegrationParameters::default(),
        physics_pipeline:   PhysicsPipeline::new(),
        island_manager:     IslandManager::new(),
        broad_phase:        DefaultBroadPhase::new(),
        narrow_phase:       NarrowPhase::new(),
        bodies:             RigidBodySet::new(),
        colliders:          ColliderSet::new(),
        impulse_joints:     ImpulseJointSet::new(),
        multibody_joints:   MultibodyJointSet::new(),
        ccd_solver:         CCDSolver::new(),
        query_pipeline:     QueryPipeline::new(),

        next_id:       1,
        id_to_handle:  HashMap::new(),
        handle_to_id:  HashMap::new(),
        static_bodies: Vec::new(),
    })
}

impl PhysicsWorld {
    pub fn step_world(&mut self, dt: f32) {
        self.integration_params.dt = dt;
        self.physics_pipeline.step(
            &self.gravity,
            &self.integration_params,
            &mut self.island_manager,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.bodies,
            &mut self.colliders,
            &mut self.impulse_joints,
            &mut self.multibody_joints,
            &mut self.ccd_solver,
            Some(&mut self.query_pipeline),
            &(),
            &(),
        );
        self.query_pipeline.update(&self.colliders);
    }

    pub fn load_trimesh(&mut self, vertices: &[f32], indices: &[u32]) {
        // Remove previous static mesh bodies
        for h in self.static_bodies.drain(..) {
            self.bodies.remove(
                h,
                &mut self.island_manager,
                &mut self.colliders,
                &mut self.impulse_joints,
                &mut self.multibody_joints,
                true,
            );
        }

        let points: Vec<Point<f32>> = vertices
            .chunks_exact(3)
            .map(|v| Point::new(v[0], v[1], v[2]))
            .collect();
        let triangles: Vec<[u32; 3]> = indices
            .chunks_exact(3)
            .map(|t| [t[0], t[1], t[2]])
            .collect();

        let body = RigidBodyBuilder::fixed().build();
        let handle = self.bodies.insert(body);
        let collider = ColliderBuilder::trimesh(points, triangles)
            .friction(0.0)
            .build();
        self.colliders
            .insert_with_parent(collider, handle, &mut self.bodies);
        self.static_bodies.push(handle);
    }

    pub fn create_player_body(&mut self, x: f32, y: f32, z: f32) -> u64 {
        let body = RigidBodyBuilder::dynamic()
            .translation(vector![x, y, z])
            .linear_damping(0.1)
            .lock_rotations()
            .ccd_enabled(true)
            .build();
        let handle = self.bodies.insert(body);

        let collider = ColliderBuilder::ball(1.0) // PLAYER_RADIUS
            .restitution(0.0)
            .friction(0.0)
            .build();
        self.colliders
            .insert_with_parent(collider, handle, &mut self.bodies);

        self.register(handle)
    }

    pub fn create_bomb_body(
        &mut self,
        x: f32, y: f32, z: f32,
        ix: f32, iy: f32, iz: f32,
    ) -> u64 {
        let body = RigidBodyBuilder::dynamic()
            .translation(vector![x, y, z])
            .ccd_enabled(true)
            .build();
        let handle = self.bodies.insert(body);

        let collider = ColliderBuilder::ball(0.5) // BOMB_RADIUS
            .restitution(0.3)
            .build();
        self.colliders
            .insert_with_parent(collider, handle, &mut self.bodies);

        if let Some(b) = self.bodies.get_mut(handle) {
            b.apply_impulse(vector![ix, iy, iz], true);
        }

        self.register(handle)
    }

    pub fn remove_body(&mut self, id: u64) {
        if let Some(handle) = self.id_to_handle.remove(&id) {
            self.handle_to_id.remove(&handle);
            self.bodies.remove(
                handle,
                &mut self.island_manager,
                &mut self.colliders,
                &mut self.impulse_joints,
                &mut self.multibody_joints,
                true,
            );
        }
    }

    pub fn get_pos(&self, id: u64) -> ffi::Vec3f {
        self.with_body(id, |b| {
            let t = b.translation();
            ffi::Vec3f { x: t.x, y: t.y, z: t.z }
        })
        .unwrap_or(ffi::Vec3f { x: 0.0, y: 0.0, z: 0.0 })
    }

    pub fn get_vel(&self, id: u64) -> ffi::Vec3f {
        self.with_body(id, |b| {
            let v = b.linvel();
            ffi::Vec3f { x: v.x, y: v.y, z: v.z }
        })
        .unwrap_or(ffi::Vec3f { x: 0.0, y: 0.0, z: 0.0 })
    }

    pub fn get_rot(&self, id: u64) -> ffi::Quat4f {
        self.with_body(id, |b| {
            let r = b.rotation();
            ffi::Quat4f { x: r.i, y: r.j, z: r.k, w: r.w }
        })
        .unwrap_or(ffi::Quat4f { x: 0.0, y: 0.0, z: 0.0, w: 1.0 })
    }

    pub fn set_pos(&mut self, id: u64, x: f32, y: f32, z: f32) {
        self.with_body_mut(id, |b| {
            b.set_translation(vector![x, y, z], true);
        });
    }

    pub fn set_vel(&mut self, id: u64, x: f32, y: f32, z: f32) {
        self.with_body_mut(id, |b| {
            b.set_linvel(vector![x, y, z], true);
        });
    }

    pub fn add_force(&mut self, id: u64, x: f32, y: f32, z: f32) {
        self.with_body_mut(id, |b| {
            b.add_force(vector![x, y, z], true);
        });
    }

    pub fn apply_impulse(&mut self, id: u64, x: f32, y: f32, z: f32) {
        self.with_body_mut(id, |b| {
            b.apply_impulse(vector![x, y, z], true);
        });
    }

    pub fn reset_forces(&mut self, id: u64) {
        self.with_body_mut(id, |b| {
            b.reset_forces(true);
        });
    }

    pub fn is_grounded(&self, id: u64) -> bool {
        let handle = match self.id_to_handle.get(&id) {
            Some(&h) => h,
            None => return false,
        };
        let body = match self.bodies.get(handle) {
            Some(b) => b,
            None => return false,
        };
        let pos = body.translation();
        let ray = Ray::new(
            Point::new(pos.x, pos.y - 0.5, pos.z),
            vector![0.0, -1.0, 0.0],
        );
        // Only hit static map geometry — exclude the player's own body AND all
        // other dynamic bodies (players), preventing "standing on players" jump bug.
        let filter = QueryFilter::exclude_dynamic()
            .exclude_rigid_body(handle)
            .exclude_sensors();
        self.query_pipeline
            .cast_ray(&self.bodies, &self.colliders, &ray, 0.6, true, filter)
            .is_some()
    }

    pub fn cast_ray(
        &self,
        ox: f32, oy: f32, oz: f32,
        dx: f32, dy: f32, dz: f32,
        max_toi: f32,
        exclude_id: u64,
    ) -> ffi::RayHit {
        let ray = Ray::new(Point::new(ox, oy, oz), vector![dx, dy, dz]);
        let mut filter = QueryFilter::default().exclude_sensors();
        if exclude_id != 0 {
            if let Some(&h) = self.id_to_handle.get(&exclude_id) {
                filter = filter.exclude_rigid_body(h);
            }
        }

        match self.query_pipeline.cast_ray_and_get_normal(
            &self.bodies,
            &self.colliders,
            &ray,
            max_toi,
            true,
            filter,
        ) {
            Some((collider_handle, intersection)) => {
                let rb_handle = self
                    .colliders
                    .get(collider_handle)
                    .and_then(|c| c.parent())
                    .unwrap_or(RigidBodyHandle::invalid());
                let body_id = self
                    .handle_to_id
                    .get(&rb_handle)
                    .copied()
                    .unwrap_or(0);
                ffi::RayHit {
                    hit:     true,
                    toi:     intersection.time_of_impact,
                    nx:      intersection.normal.x,
                    ny:      intersection.normal.y,
                    nz:      intersection.normal.z,
                    body_id,
                }
            }
            None => ffi::RayHit { hit: false, toi: 0.0, nx: 0.0, ny: 0.0, nz: 0.0, body_id: 0 },
        }
    }

    pub fn hook_hits_geometry(&self, hx: f32, hy: f32, hz: f32, player_id: u64) -> bool {
        const DIRS: [[f32; 3]; 6] = [
            [1.0, 0.0, 0.0], [-1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0], [0.0, -1.0, 0.0],
            [0.0, 0.0, 1.0], [0.0, 0.0, -1.0],
        ];
        let exclude_handle = self.id_to_handle.get(&player_id).copied();
        let mut filter = QueryFilter::default().exclude_sensors();
        if let Some(h) = exclude_handle {
            filter = filter.exclude_rigid_body(h);
        }
        for [dx, dy, dz] in &DIRS {
            let ray = Ray::new(Point::new(hx, hy, hz), vector![*dx, *dy, *dz]);
            if self
                .query_pipeline
                .cast_ray(&self.bodies, &self.colliders, &ray, 0.3, true, filter)
                .is_some()
            {
                return true;
            }
        }
        false
    }

    pub fn bodies_in_sphere(&self, cx: f32, cy: f32, cz: f32, radius: f32) -> Vec<u64> {
        let shape = Ball::new(radius);
        let shape_pos = Isometry::translation(cx, cy, cz);
        let filter = QueryFilter::default().exclude_sensors();
        let mut result: Vec<u64> = Vec::new();

        self.query_pipeline.intersections_with_shape(
            &self.bodies,
            &self.colliders,
            &shape_pos,
            &shape,
            filter,
            |collider_handle| {
                if let Some(c) = self.colliders.get(collider_handle) {
                    if let Some(rb_handle) = c.parent() {
                        if let Some(&id) = self.handle_to_id.get(&rb_handle) {
                            result.push(id);
                        }
                    }
                }
                true // keep iterating
            },
        );
        result
    }

    // ── private helpers ───────────────────────────────────────────────────────

    fn register(&mut self, handle: RigidBodyHandle) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.id_to_handle.insert(id, handle);
        self.handle_to_id.insert(handle, id);
        id
    }

    fn with_body<T, F: FnOnce(&RigidBody) -> T>(&self, id: u64, f: F) -> Option<T> {
        let &handle = self.id_to_handle.get(&id)?;
        let body = self.bodies.get(handle)?;
        Some(f(body))
    }

    fn with_body_mut<F: FnOnce(&mut RigidBody)>(&mut self, id: u64, f: F) {
        if let Some(&handle) = self.id_to_handle.get(&id) {
            if let Some(body) = self.bodies.get_mut(handle) {
                f(body);
            }
        }
    }
}
