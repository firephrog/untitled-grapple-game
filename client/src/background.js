import * as THREE from 'three';

let renderer, scene, camera;

export function initBackground() {
  // Create a second canvas behind everything
  const canvas = document.createElement('canvas');
  canvas.id = 'bgCanvas';
  canvas.style.cssText = `
    position: fixed; inset: 0;
    width: 100%; height: 100%;
    z-index: 0; display: block;
  `;
  document.body.prepend(canvas);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);

  loadCubemap('default');

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  let yaw = 0, pitch = 0;
  animate();

  function animate() {
    requestAnimationFrame(animate);
    yaw += 0.0003; // slow auto-rotate
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    renderer.render(scene, camera);
  }
}

export function loadCubemap(name) {
  const loader = new THREE.CubeTextureLoader();
  loader.setPath(`/cubemaps/${name}/`);
  const texture = loader.load(['px.png','nx.png','py.png','ny.png','pz.png','nz.png']);
  scene.background = texture;
}

export function showBackground()  { document.getElementById('bgCanvas').style.display = 'block'; }
export function hideBackground()  { document.getElementById('bgCanvas').style.display = 'none'; }