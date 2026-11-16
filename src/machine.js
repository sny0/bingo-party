import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from '../vendor/three/examples/jsm/environments/RoomEnvironment.js';

const DRUM_TURNS = 8;
const BALL_RADIUS = 0.087;
const BALL_COLORS = { B: '#2585d1', I: '#d14354', N: '#d6a52a', G: '#27a561', O: '#9263cf' };
const modelUrl = new URL('../assets/garagara.glb?v=1.3.10', import.meta.url);

function makeNumberSurface() {
  const image = document.createElement('canvas');
  image.width = image.height = 256;
  const ink = image.getContext('2d');
  const texture = new THREE.CanvasTexture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(BALL_RADIUS * 1.39, BALL_RADIUS * 1.39, 16, 16);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    positions.setZ(i, Math.sqrt(BALL_RADIUS ** 2 - x ** 2 - y ** 2) + 0.001);
  }
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    paint(number, letter, color) {
      ink.clearRect(0, 0, 256, 256);
      ink.beginPath();
      ink.arc(128, 128, 123, 0, Math.PI * 2);
      ink.fillStyle = color;
      ink.fill();
      ink.beginPath();
      ink.arc(128, 128, 105, 0, Math.PI * 2);
      ink.fillStyle = '#fff8e5';
      ink.fill();
      ink.fillStyle = '#102942';
      ink.textAlign = 'center';
      ink.textBaseline = 'middle';
      ink.font = '800 47px Arial, sans-serif';
      ink.fillText(letter, 128, 69);
      ink.font = '900 128px Arial, sans-serif';
      ink.fillText(String(number), 128, 148, 171);
      texture.needsUpdate = true;
    },
  };
}

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
  const bandImage = document.createElement('canvas');
  bandImage.width = 256;
  bandImage.height = 128;
  const band = bandImage.getContext('2d');
  const bandTexture = new THREE.CanvasTexture(bandImage);
  bandTexture.colorSpace = THREE.SRGBColorSpace;
  const revealedBallMaterial = new THREE.MeshStandardMaterial({ map: bandTexture, roughness: 0.29 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 40, 30), ballMaterial);
  ball.castShadow = true;
  const numberSurface = makeNumberSurface();
  ball.add(numberSurface.mesh);
  scene.add(ball);

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 36);
  const cameraTarget = new THREE.Vector3();
  const ballShotTarget = new THREE.Vector3();
  const foregroundBall = new THREE.Vector3();
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

  function render(spin, drop, reveal = 0) {
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
    const revealWide = THREE.MathUtils.smoothstep(reveal, 0.08, 0.82);
    const fall = drop ?? 0;
    const fallTravel = fall ** 1.65;
    camera.aspect = width / height;
    const machineHeight = Math.max(3.95, 3.65 / camera.aspect) * (0.40 + pullback * 0.60);
    const ballShotHeight = Math.max(0.91, 0.87 / camera.aspect);
    const revealHeight = THREE.MathUtils.lerp(ballShotHeight, machineHeight * 0.92, revealWide);
    const distance = THREE.MathUtils.lerp(machineHeight, revealHeight, pushIn) / (2 * halfFovTangent);
    const azimuth = THREE.MathUtils.lerp(0.63 - 0.29 * pullback, 0.16 + 0.18 * revealWide, pushIn);
    const elevation = THREE.MathUtils.lerp(0.05 + 0.23 * pullback, 0.39 + 0.12 * fallTravel - 0.23 * revealWide, pushIn);
    const horizontalDistance = distance * Math.cos(elevation);
    ballShotTarget.lerpVectors(exit, rest, fallTravel);
    ballShotTarget.y += 0.015;
    ballShotTarget.x *= 1 - revealWide;
    ballShotTarget.y = THREE.MathUtils.lerp(ballShotTarget.y, 1.27, revealWide);
    ballShotTarget.z = THREE.MathUtils.lerp(ballShotTarget.z, 0.15, revealWide);
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
      const numbered = drop === 1;
      ball.position.lerpVectors(exit, rest, fallTravel);
      ball.quaternion.copy(camera.quaternion);
      ball.material = numbered ? revealedBallMaterial : ballMaterial;
      numberSurface.mesh.visible = numbered;
      if (numbered) {
        // Resolve on the tray first, then bring the numbered ball toward the audience.
        const lift = THREE.MathUtils.smoothstep(reveal, 0, 0.72);
        const overshoot = Math.sin(Math.PI * THREE.MathUtils.smoothstep(reveal, 0.44, 1)) * 0.035;
        const distanceToFitWidth = BALL_RADIUS / (halfFovTangent * camera.aspect * 0.80);
        const foregroundDistance = Math.max(0.68, distanceToFitWidth) - overshoot;
        camera.getWorldDirection(foregroundBall).multiplyScalar(foregroundDistance).add(camera.position);
        ball.position.lerp(foregroundBall, lift);
        ball.position.y += Math.sin(Math.PI * lift) * 0.09;
        ball.rotateZ(Math.sin(Math.PI * reveal) * -0.21);
        ball.castShadow = reveal === 0;
      } else {
        ball.castShadow = true;
      }
    }
    renderer.render(scene, camera);
  }

  function drawFrame(spin, drop, reveal) {
    try { render(spin, drop, reveal); } catch { fail(); }
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
    start(number, letter, duration) {
      if (!ready) return false;
      stop();
      const color = BALL_COLORS[letter];
      numberSurface.paint(number, letter, color);
      band.fillStyle = '#fff8e5';
      band.fillRect(0, 0, 256, 128);
      band.fillStyle = color;
      band.fillRect(0, 35, 256, 58);
      bandTexture.needsUpdate = true;
      drawFrame(0);
      animate(duration, spin => drawFrame(spin));
      return ready;
    },
    release(duration) {
      stop();
      if (!ready) return;
      drawFrame(1, 0);
      // The app draws contact and reveals the result together after the fall.
      animate(duration, progress => {
        if (progress < 1) drawFrame(1, progress);
      });
    },
    land() {
      stop();
      if (!ready) return;
      drawFrame(1, 1);
      animate(520, progress => drawFrame(1, 1, progress));
    },
    stop,
  };
}
