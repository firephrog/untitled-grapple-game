// ── client/src/PerformanceMonitor.js ───────────────────────────────────────────
// Real-time performance metrics display.
// Monitors FPS, memory usage, geometry count, and render time.
// ─────────────────────────────────────────────────────────────────────────────

export class PerformanceMonitor {
  constructor(scene, renderer) {
    this._scene = scene;
    this._renderer = renderer;
    this._frameCount = 0;
    this._lastTime = performance.now();
    this._fps = 0;
    this._frameTimes = [];
    this._enabled = false;
    this._panelEl = null;
    
    this._setupPanel();
  }

  _setupPanel() {
    // Create performance stats panel
    const panel = document.createElement('div');
    panel.id = 'perf-monitor';
    panel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #0f0;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      padding: 10px;
      border: 1px solid #0f0;
      border-radius: 4px;
      z-index: 9999;
      pointer-events: none;
      display: none;
      min-width: 180px;
      line-height: 1.4;
    `;
    panel.innerHTML = `
      <div id="perf-fps">FPS: 0</div>
      <div id="perf-memory">Memory: 0 MB</div>
      <div id="perf-geom">Geometries: 0</div>
      <div id="perf-textures">Textures: 0</div>
      <div id="perf-calls">Draw calls: 0</div>
    `;
    document.body.appendChild(panel);
    this._panelEl = panel;

    // Toggle with keyboard shortcut (Ctrl+Alt+P)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.altKey && e.code === 'KeyP') {
        this.toggle();
      }
    });
  }

  toggle() {
    this._enabled = !this._enabled;
    if (this._panelEl) {
      this._panelEl.style.display = this._enabled ? 'block' : 'none';
    }
  }

  update() {
    if (!this._enabled) return;

    const now = performance.now();
    const dt = now - this._lastTime;
    this._lastTime = now;

    // FPS calculation
    this._frameCount++;
    if (dt >= 1000) {
      this._fps = Math.round((this._frameCount * 1000) / dt);
      this._frameCount = 0;
      this._lastTime = now;
    }

    // Update panel
    if (this._panelEl) {
      document.getElementById('perf-fps').textContent = `FPS: ${this._fps}`;

      // Memory usage (if available)
      if (performance.memory) {
        const memMB = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
        document.getElementById('perf-memory').textContent = `Memory: ${memMB} MB`;
      }

      // Geometry count
      let geometryCount = 0;
      this._scene.traverse((obj) => {
        if (obj.isMesh && obj.geometry) geometryCount++;
      });
      document.getElementById('perf-geom').textContent = `Geometries: ${geometryCount}`;

      // Texture count
      const textureMemory = this._renderer.info.memory.textures || 0;
      document.getElementById('perf-textures').textContent = `Textures: ${textureMemory}`;

      // Draw calls
      const renderCalls = this._renderer.info.render.calls || 0;
      document.getElementById('perf-calls').textContent = `Draw calls: ${renderCalls}`;
    }
  }

  // Expose render info
  getRenderInfo() {
    return {
      fps: this._fps,
      calls: this._renderer.info.render.calls || 0,
      triangles: this._renderer.info.render.triangles || 0,
      geometries: this._renderer.info.memory.geometries || 0,
      textures: this._renderer.info.memory.textures || 0,
    };
  }
}
