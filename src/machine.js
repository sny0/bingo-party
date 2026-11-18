import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from '../vendor/three/examples/jsm/environments/RoomEnvironment.js';

const DRUM_TURNS = 8;
const BALL_RADIUS = 0.087;
const modelUrl = new URL('../assets/garagara.glb?v=1.6.1', import.meta.url);

export async function createMachine(host, onUnavailable) {
  const { scene: model } = await new GLTFLoader().loadAsync(modelUrl.href);
  const drum = model.getObjectByName('Drum');
  const crank = model.getObjectByName('Crank');
  const exit = model.getObjectByName('BallExit')?.getWorldPosition(new THREE.Vector3());
  const rest = model.getObjectByName('BallRest')?.getWorldPosition(new THREE.Vector3());
  if (!drum || !crank || !exit || !rest) throw new Error('Incomplete draw machine model');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const studio = new RoomEnvironment();
  const reflections = new THREE.PMREMGenerator(renderer);
  scene.environment = reflections.fromScene(studio, 0.1).texture;
  scene.environmentIntensity = 0.56;
  reflections.dispose();
  studio.dispose();

  model.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  scene.add(model);

  const key = new THREE.DirectionalLight(0xffead4, 2.7);
  key.position.set(-3.2, 6.7, 4.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -3.5;
  key.shadow.camera.right = key.shadow.camera.top = 3.5;
  key.shadow.camera.far = 14;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 3;
  const rim = new THREE.DirectionalLight(0xffb895, 1.15);
  rim.position.set(1.6, 4.4, -3);
  scene.add(key, rim, new THREE.HemisphereLight(0xe7e3ff, 0x896168, 0.54));

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.11 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xf7ecd6, roughness: 0.34 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 40, 30), ballMaterial);
  ball.castShadow = true;
  scene.add(ball);

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 36);
  const cameraTarget = new THREE.Vector3();
  const ballShotTarget = new THREE.Vector3();
  const halfFovTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const canvas = renderer.domElement;
  host.append(canvas);

  let frame = null;
  let ready = true;
  let width = 0;
  let height = 0;

  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function fail() {
    ready = false;
    stop();
    onUnavailable();
  }

  canvas.addEventListener('webglcontextlost', fail);

  function render(spin, drop) {
    const viewWidth = host.clientWidth;
    const viewHeight = host.clientHeight;
    if (viewWidth === 0 || viewHeight === 0) return;
    if (width !== viewWidth || height !== viewHeight) {
      width = viewWidth;
      height = viewHeight;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height, false);
    }

    const turns = THREE.MathUtils.smoothstep(spin, 0, 1) * DRUM_TURNS;
    drum.rotation.z = crank.rotation.z = -turns * Math.PI * 2;

    // Pull back during the spin, then dive toward the ball exit just before release.
    const pullback = THREE.MathUtils.smoothstep(spin, 0.17, 0.65);
    const pushIn = THREE.MathUtils.smoothstep(spin, 0.77, 1);
    const fall = drop ?? 0;
    const fallTravel = fall ** 1.65;
    camera.aspect = width / height;
    const machineHeight = Math.max(3.95, 3.65 / camera.aspect) * (0.40 + pullback * 0.60);
    const ballShotHeight = Math.max(0.91, 0.87 / camera.aspect);
    const distance = THREE.MathUtils.lerp(machineHeight, ballShotHeight, pushIn) / (2 * halfFovTangent);
    const azimuth = THREE.MathUtils.lerp(0.63 - 0.29 * pullback, 0.16, pushIn);
    const elevation = THREE.MathUtils.lerp(0.05 + 0.23 * pullback, 0.39 + 0.12 * fallTravel, pushIn);
    const horizontalDistance = distance * Math.cos(elevation);
    ballShotTarget.lerpVectors(exit, rest, fallTravel);
    ballShotTarget.y += 0.015;
    cameraTarget.set(-0.11 * (1 - pullback), 1.67 - pullback * 0.31, 0.15).lerp(ballShotTarget, pushIn);
    camera.position.set(
      cameraTarget.x + Math.sin(azimuth) * horizontalDistance,
      cameraTarget.y + Math.sin(elevation) * distance,
      cameraTarget.z + Math.cos(azimuth) * horizontalDistance,
    );
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();

    ball.visible = drop !== undefined;
    if (ball.visible) {
      ball.position.lerpVectors(exit, rest, fallTravel);
    }
    renderer.render(scene, camera);
  }

  function drawFrame(spin, drop) {
    try { render(spin, drop); } catch { fail(); }
  }

  function animate(duration, renderProgress) {
    const start = performance.now();
    const step = now => {
      frame = null;
      const progress = THREE.MathUtils.clamp((now - start) / duration, 0, 1);
      renderProgress(progress);
      if (ready && progress < 1) frame = requestAnimationFrame(step);
    };
    if (ready) frame = requestAnimationFrame(step);
  }

  return {
    start(duration) {
      if (!ready) return false;
      stop();
      drawFrame(0);
      animate(duration, spin => drawFrame(spin));
      return ready;
    },
    release(duration) {
      stop();
      if (!ready) return;
      drawFrame(1, 0);
      animate(duration, progress => drawFrame(1, progress));
    },
    stop,
  };
}
