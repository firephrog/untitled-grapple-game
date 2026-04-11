import * as THREE from 'three';

let renderer, scene, camera;

let isBackgroundVisible = true;
let animationFrameId = null;

export function initBackground() {
  // Create background canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'bgCanvas';
  canvas.style.cssText = `
    position: fixed; inset: 0;
    width: 100%; height: 100%;
    z-index: 0; display: block;
    pointer-events: none;
  `;
  document.body.prepend(canvas);

  // Use device pixel ratio for crisp rendering (full resolution)
  const dpr = window.devicePixelRatio || 1;
  const targetRatio = Math.min(dpr, 2.0);  // Cap at 2.0 for balance between quality and performance
  
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  renderer.setPixelRatio(targetRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0); // transparent background

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
      animate();
    }
  });

  let yaw = 0, pitch = 0;
  
  function animate() {
    if (!document.hidden && isBackgroundVisible) {
      animationFrameId = requestAnimationFrame(animate);
      yaw += 0.0003; // slow auto-rotate
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      renderer.render(scene, camera);
    } else if (isBackgroundVisible) {
      animationFrameId = requestAnimationFrame(animate);
    }
  }
  
  animate();
}

export function loadCubemap(name) {
  const loader = new THREE.CubeTextureLoader();
  loader.setPath(`/cubemaps/${name}/`);
  const texture = loader.load(['px.png','nx.png','py.png','ny.png','pz.png','nz.png']);
  scene.background = texture;
}

export function showBackground()  { 
  isBackgroundVisible = true;
  const canvas = document.getElementById('bgCanvas');
  if (canvas) canvas.style.display = 'block';
}

export function hideBackground()  { 
  isBackgroundVisible = false;
  const canvas = document.getElementById('bgCanvas');
  if (canvas) canvas.style.display = 'none';
}
