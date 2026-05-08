import * as THREE from 'three';

let renderer, scene, camera;
let backgroundCanvas = null;
let initialized = false;

let isBackgroundVisible = true;
let animationFrameId = null;
let animateBackground = null;
let activeCubemapName = 'default';

export function initBackground() {
  if (initialized) return;

  // Remove any duplicate background canvases from hot reload/re-init paths.
  const dupes = document.querySelectorAll('#bgCanvas');
  dupes.forEach((el, i) => {
    if (i > 0) el.remove();
  });

  // Create background canvas
  backgroundCanvas = document.getElementById('bgCanvas');
  if (!backgroundCanvas) {
    backgroundCanvas = document.createElement('canvas');
    backgroundCanvas.id = 'bgCanvas';
    document.body.prepend(backgroundCanvas);
  }

  backgroundCanvas.style.cssText = `
    position: fixed; inset: 0;
    width: 100%; height: 100%;
    z-index: 0; display: block;
    pointer-events: none;
  `;

  // Use device pixel ratio for crisp rendering (full resolution)
  const dpr = window.devicePixelRatio || 1;
  const targetRatio = Math.min(dpr, 2.0);  // Cap at 2.0 for balance between quality and performance
  
  renderer = new THREE.WebGLRenderer({ canvas: backgroundCanvas, antialias: false, alpha: true });
  renderer.setPixelRatio(targetRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0); // transparent background

  backgroundCanvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  });

  backgroundCanvas.addEventListener('webglcontextrestored', () => {
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
    renderer.setSize(window.innerWidth, window.innerHeight);
    loadCubemap(activeCubemapName);
    if (isBackgroundVisible && !animationFrameId && typeof animateBackground === 'function') {
      animateBackground();
    }
  });

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);

  loadCubemap('default');

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // Stop rendering when page is not visible (tab switched)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    } else {
      if (isBackgroundVisible && !animationFrameId && typeof animateBackground === 'function') {
        animateBackground();
      }
    }
  });

  let yaw = 0, pitch = 0;

  animateBackground = function animate() {
    if (!document.hidden && isBackgroundVisible) {
      animationFrameId = requestAnimationFrame(animateBackground);
      yaw += 0.0003; // slow auto-rotate
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      renderer.render(scene, camera);
    } else if (isBackgroundVisible) {
      animationFrameId = requestAnimationFrame(animateBackground);
    } else {
      animationFrameId = null;
    }
  };
  
  animateBackground();
  initialized = true;
}

export function loadCubemap(name) {
  activeCubemapName = name || 'default';
  const loader = new THREE.CubeTextureLoader();
  loader.setPath(`/cubemaps/${activeCubemapName}/`);
  const texture = loader.load(['px.png','nx.png','py.png','ny.png','pz.png','nz.png']);
  scene.background = texture;
}

export function showBackground()  { 
  isBackgroundVisible = true;
  const canvas = backgroundCanvas || document.getElementById('bgCanvas');
  if (canvas) {
    canvas.style.display = 'block';
    canvas.style.visibility = 'visible';
    canvas.style.opacity = '1';
    canvas.style.zIndex = '0';
  }

  // Restart loop if it was stopped while background was hidden.
  if (!animationFrameId && typeof animateBackground === 'function') {
    animateBackground();
  }
}

export function hideBackground()  { 
  isBackgroundVisible = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  const canvas = backgroundCanvas || document.getElementById('bgCanvas');
  if (canvas) {
    canvas.style.display = 'none';
    canvas.style.visibility = 'hidden';
    canvas.style.opacity = '0';
    canvas.style.zIndex = '-10';
  }
}
