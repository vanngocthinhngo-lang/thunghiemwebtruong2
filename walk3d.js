/* UTE Campus - 3D walk & multiplayer combat renderer
 * Uses Three.js r160. The original canvas remains available for map/aerial modes.
 */
(() => {
  'use strict';
  const THREE = window.THREE;
  const api = window.campusBridge;
  const canvas = document.getElementById('walkScene');
  if (!THREE || !api || !canvas) {
    console.warn('[UTE 3D] Three.js chưa tải được; giữ chế độ bản đồ cũ.');
    return;
  }

  const S = CAMPUS.scale, SX = 1.12, SZ = 1.08;
  const world = p => [(p[0] - 700) * S * SX, (p[1] - 650) * S * SZ];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbad5e5);
  scene.fog = new THREE.Fog(0xbad5e5, 65, 220);
  const camera = new THREE.PerspectiveCamera(67, innerWidth / innerHeight, 0.08, 320);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const mat = (color, roughness = .82, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const materials = {
    grass: mat(0x66865b), lawn: mat(0x78956a), concrete: mat(0xc7c9bd), road: mat(0x858f91), roadEdge: mat(0xb5b7ad),
    wall: mat(0xe5e1d3), trim: mat(0xd0d2c6), window: new THREE.MeshStandardMaterial({ color: 0x557b83, roughness: .25, metalness: .12 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x91b7bd, roughness: .2, metalness: .08 }),
    bark: mat(0x77553b), leaf1: mat(0x47734b), leaf2: mat(0x5b8755), leaf3: mat(0x73965c),
    dark: mat(0x222a2c, .5), rubber: mat(0x171c20, .95), skin: mat(0xc88f6d), shoe: mat(0x252a2d, .75),
    white: mat(0xe9e9dc), gold: mat(0xd4a54d, .5, .25), red: mat(0xb84b3d, .7),
  };

  const hemi = new THREE.HemisphereLight(0xe7f5ff, 0x63724f, 1.65); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffedcf, 2.2);
  sun.position.set(-42, 62, 38); sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -75; sun.shadow.camera.right = 75;
  sun.shadow.camera.top = 75; sun.shadow.camera.bottom = -75;
  sun.shadow.bias = -.00025; sun.shadow.normalBias = .025;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xb6d8ff, .48); fill.position.set(35, 24, -45); scene.add(fill);

  function addMesh(geometry, material, parent = scene, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  function flatShape(points, y, material, parent = scene) {
    if (!points || points.length < 3) return null;
    const s = new THREE.Shape();
    const p0 = points[0]; s.moveTo(p0[0], -p0[1]);
    for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], -points[i][1]);
    s.closePath();
    const geo = new THREE.ShapeGeometry(s); geo.rotateX(-Math.PI / 2);
    const mesh = addMesh(geo, material, parent, 0, y, 0); mesh.castShadow = false; return mesh;
  }
  function lineXZ(a, b, width, y, material, parent = scene) {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < .01) return;
    const m = addMesh(new THREE.BoxGeometry(len, .025, width), material, parent, (a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
    m.rotation.y = -Math.atan2(dz, dx); m.castShadow = false;
  }
  function segment(parent, a, b, radius, material, radial = 9) {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), d = bv.clone().sub(av);
    const mesh = addMesh(new THREE.CylinderGeometry(radius * .92, radius, d.length(), radial), material, parent);
    mesh.position.copy(av.add(bv).multiplyScalar(.5)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const jointA = addMesh(new THREE.SphereGeometry(radius, 10, 8), material, parent, ...a);
    const jointB = addMesh(new THREE.SphereGeometry(radius * .95, 10, 8), material, parent, ...b);
    return [mesh, jointA, jointB];
  }
  function makeBox(parent, size, position, material, rotation = null) {
    const m = addMesh(new THREE.BoxGeometry(...size), material, parent, ...position);
    if (rotation) m.rotation.set(...rotation); return m;
  }

  // Real campus massing: low-rise walls, roofs, window bands and road surfaces.
  const ground = addMesh(new THREE.PlaneGeometry(460, 460), materials.grass, scene, 0, -.18, 0);
  ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
  const boundary = CAMPUS.boundary.map(world);
  flatShape(boundary, -.10, materials.lawn);
  CAMPUS.roads.forEach(r => {
    const pts = r.points.map(world), width = Math.max(1.25, r.width * S);
    for (let i = 1; i < pts.length; i++) {
      lineXZ(pts[i - 1], pts[i], width + .7, -.075, materials.roadEdge);
      lineXZ(pts[i - 1], pts[i], width, -.05, materials.road);
    }
  });
  // Walkable campus yards and the sports court.
  flatShape([[365,398],[607,289],[741,486],[444,587]].map(world), .005, mat(0x527a4e));
  flatShape([[579,714],[793,603],[1000,951],[920,1051],[698,899]].map(world), .012, mat(0xb8bdb4));
  flatShape([[655,806],[765,747],[903,922],[819,981]].map(world), .014, mat(0x8c9e76));
  flatShape([[593,601],[745,521],[779,552],[626,640]].map(world), .015, mat(0x9aac83));
  const court = [[405,450],[603,340],[703,480],[482,589]].map(world);
  flatShape(court, .035, mat(0x39744c));
  for (let i = 0; i < 4; i++) lineXZ(court[i], court[(i + 1) % 4], .12, .07, materials.white);
  lineXZ([(court[0][0]+court[3][0])/2,(court[0][1]+court[3][1])/2], [(court[1][0]+court[2][0])/2,(court[1][1]+court[2][1])/2], .1, .07, materials.white);

  const colorFromHex = h => new THREE.Color(h || '#e5e1d3');
  CAMPUS.buildings.forEach((b, index) => {
    if (b.kind === 'area' || !b.poly || b.poly.length < 3) return;
    const poly = b.poly.map(world), center = poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0]);
    const local = poly.map(p => [center[0] + (p[0] - center[0]) * .96, center[1] + (p[1] - center[1]) * .96]);
    const h = Math.max(2.2, b.h || 5.2), wallMat = mat(b.c || (index % 3 ? 0xd8d4c7 : 0xe4dfd2));
    const shape = new THREE.Shape(); shape.moveTo(local[0][0], -local[0][1]);
    local.slice(1).forEach(p => shape.lineTo(p[0], -p[1])); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .025, bevelThickness: .025 });
    geo.rotateX(-Math.PI / 2);
    const body = addMesh(geo, [wallMat, wallMat], scene); body.castShadow = true; body.receiveShadow = true;
    flatShape(local, h + .035, mat(b.roof || 0x8e4c3c));
    // Roof fascia / parapet gives a readable silhouette from the player's height.
    local.forEach((p, i) => {
      const q = local[(i + 1) % local.length];
      lineXZ(p, q, .10, h + .075, mat(b.roof || 0x8e4c3c));
      const dx = q[0] - p[0], dz = q[1] - p[1], length = Math.hypot(dx, dz);
      if (length < 2) return;
      const levels = b.floors || Math.max(1, Math.floor(h / 3.3));
      for (let floor = 0; floor < levels; floor++) {
        const y = (floor + .52) * h / levels;
        const count = Math.max(1, Math.floor(length / 2.8));
        for (let k = 0; k < count; k++) {
          const t = (k + .5) / count;
          const wx = p[0] + dx * t, wz = p[1] + dz * t;
          const width = Math.min(.92, length / count * .48);
          const win = makeBox(scene, [width, .62, .055], [wx, y, wz], materials.window);
          win.rotation.y = -Math.atan2(dz, dx);
          // Slim light-coloured window sill.
          const sill = makeBox(scene, [width + .08, .055, .075], [wx, y - .34, wz], materials.trim);
          sill.rotation.y = -Math.atan2(dz, dx);
        }
      }
    });
    // Entrance blocks and external stairs add scale and depth.
    const p = local[0];
    const door = makeBox(scene, [.95, 1.65, .10], [p[0], .84, p[1]], mat(0x536b69));
    door.rotation.y = 0;
    if (b.colonnade) {
      for (let i = 0; i < local.length; i++) {
        const p1 = local[i], p2 = local[(i + 1) % local.length], dist = Math.hypot(p2[0]-p1[0],p2[1]-p1[1]);
        for (let d = 2; d < dist; d += 3.4) {
          const t = d / dist, x = p1[0] + (p2[0]-p1[0])*t, z = p1[1] + (p2[1]-p1[1])*t;
          addMesh(new THREE.BoxGeometry(.13, h, .13), materials.trim, scene, x, h/2, z);
        }
      }
    }
  });

  // Courtyard trees: trunks, layered crowns, and soft shadows.
  const treePixels = [[287,370],[291,430],[307,684],[345,689],[370,678],[428,710],[531,795],[562,818],[598,842],[659,885],[720,921],[790,951],[817,936],[940,758],[928,712],[916,662],[1020,783],[1100,701],[826,371],[815,322],[660,265],[614,291],[596,256],[561,302],[422,414],[461,437],[511,394],[532,356],[640,772],[676,797],[733,822],[749,749],[793,808],[813,853]];
  treePixels.forEach((tp, i) => {
    const [x, z] = world(tp); const root = new THREE.Group(); root.position.set(x, 0, z); scene.add(root);
    addMesh(new THREE.CylinderGeometry(.10, .16, 2.5, 7), materials.bark, root, 0, 1.25, 0);
    [[1.8,1.25],[2.75,.96],[3.55,.64]].forEach(([y,r],j) => addMesh(new THREE.ConeGeometry(r, 1.85, 7), [materials.leaf1,materials.leaf2,materials.leaf3][(i+j)%3], root, 0, y, 0));
  });

  // Weapon models are built once and reused by pickups, hands and first-person view.
  const gunMetal = mat(0x343c40, .38, .58), gunPolymer = mat(0x20272b, .68, .12), gunAccent = mat(0x94764a, .46, .32);
  function weaponModel(type) {
    const group = new THREE.Group();
    const dims = { pistol: .48, smg: .78, ar: 1.02, lmg: 1.12, shotgun: .98, sniper: 1.35 };
    const L = dims[type] || .85;
    makeBox(group, [.17, .15, L * .66], [0, 0, -L * .12], gunMetal);
    const barrel = addMesh(new THREE.CylinderGeometry(.032, .045, L * .48, 12), gunMetal, group, 0, .015, -L * .55);
    barrel.rotation.x = Math.PI / 2;
    addMesh(new THREE.CylinderGeometry(.052, .052, .045, 12), gunPolymer, group, 0, .015, -L * .79).rotation.x = Math.PI / 2;
    makeBox(group, [.12, .22, .16], [0, -.17, -.01], gunPolymer, [.24, 0, 0]);
    makeBox(group, [.105, .22, .13], [0, -.17, -L * .3], gunPolymer, [.12, 0, 0]);
    makeBox(group, [.18, .08, .09], [0, .10, -L * .24], gunAccent);
    if (type !== 'pistol') {
      makeBox(group, [.20, .13, .40], [0, -.10, L * .29], gunPolymer);
      makeBox(group, [.11, .11, .28], [0, .17, -L * .18], gunMetal);
    }
    if (type === 'sniper') {
      makeBox(group, [.105, .12, .48], [0, .20, -L * .28], gunMetal);
      addMesh(new THREE.CylinderGeometry(.075, .075, .13, 14), gunAccent, group, 0, .20, -L * .22).rotation.x = Math.PI / 2;
      makeBox(group, [.14, .18, .38], [0, -.04, L * .48], gunPolymer);
    }
    if (type === 'shotgun') {
      addMesh(new THREE.CylinderGeometry(.047, .052, .54, 12), gunAccent, group, .07, -.09, -L * .33).rotation.x = Math.PI / 2;
    }
    if (type === 'lmg') makeBox(group, [.18, .30, .20], [0, -.26, -L * .34], gunPolymer);
    const flash = addMesh(new THREE.ConeGeometry(.10, .34, 8), mat(0xffd36c, .3, .15), group, 0, .015, -L * .94);
    flash.rotation.x = -Math.PI / 2; flash.visible = false; group.userData.flash = flash;
    group.userData.length = L;
    return group;
  }

  function makeNameSprite(name, color) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 72;
    const cx = c.getContext('2d'); cx.fillStyle = '#162c2be6'; cx.beginPath();
    const rr = 15; cx.roundRect(4, 4, 312, 64, rr); cx.fill();
    cx.fillStyle = color || '#ffffff'; cx.font = 'bold 30px Arial'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(String(name || 'Người chơi').slice(0, 20), 160, 37);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
    sprite.scale.set(2.2, .5, 1); return sprite;
  }

  function character(color, name, isLocal = false) {
    const root = new THREE.Group();
    const shirt = mat(color || 0x267c65, .72, .02), pants = mat(0x273b4d, .85), skin = materials.skin;
    const torso = addMesh(new THREE.CapsuleGeometry(.255, .48, 4, 10), shirt, root, 0, 1.22, 0);
    makeBox(root, [.43, .22, .29], [0, .92, .005], pants);
    // Neck and head.
    addMesh(new THREE.CylinderGeometry(.075, .085, .16, 10), skin, root, 0, 1.56, 0);
    const head = new THREE.Group(); head.position.set(0, 1.71, 0); root.add(head);
    addMesh(new THREE.SphereGeometry(.145, 18, 14), skin, head, 0, 0, 0);
    const hair = addMesh(new THREE.SphereGeometry(.151, 16, 10, 0, Math.PI * 2, 0, Math.PI * .58), mat(0x30302b), head, 0, .035, .008);
    hair.scale.set(1.04, 1.0, 1.08);
    // Face looks down local -Z.
    [-.052, .052].forEach(x => {
      addMesh(new THREE.SphereGeometry(.014, 8, 7), mat(0x242322), head, x, .005, -.137);
      addMesh(new THREE.BoxGeometry(.04, .014, .018), mat(0x4a3028), head, x, .038, -.132);
    });
    addMesh(new THREE.ConeGeometry(.022, .07, 7), skin, head, 0, -.025, -.153).rotation.x = -Math.PI / 2;
    // Ears, gloves and shoulders.
    [-1, 1].forEach(s => addMesh(new THREE.SphereGeometry(.038, 9, 8), skin, head, s * .145, 0, 0));
    const arms = new THREE.Group(); root.add(arms);
    // Arms are posed forward to hold a weapon, not hanging as rectangular blocks.
    segment(arms, [.31,1.46,.00], [.26,1.29,-.22], .105, shirt);
    segment(arms, [.26,1.29,-.22], [.12,1.28,-.48], .082, shirt);
    segment(arms, [-.31,1.46,.00], [-.29,1.26,-.27], .105, shirt);
    segment(arms, [-.29,1.26,-.27], [-.045,1.29,-.51], .078, shirt);
    addMesh(new THREE.SphereGeometry(.075, 10, 8), mat(0x3b4141), arms, .12, 1.27, -.49);
    addMesh(new THREE.SphereGeometry(.07, 10, 8), mat(0x3b4141), arms, -.045, 1.28, -.52);

    const legs = [];
    [-1, 1].forEach((s, i) => {
      const hip = new THREE.Group(); hip.position.set(s * .135, .88, 0); root.add(hip);
      segment(hip, [0, -.02, 0], [0, -.39, 0], .115, pants);
      addMesh(new THREE.SphereGeometry(.105, 10, 8), pants, hip, 0, -.41, 0);
      segment(hip, [0, -.41, 0], [0, -.75, -.015], .085, pants);
      makeBox(hip, [.19, .12, .32], [0, -.83, -.08], materials.shoe);
      makeBox(hip, [.20, .028, .26], [0, -.895, -.10], mat(0xe7e7df));
      legs.push(hip);
    });
    const gunHolder = new THREE.Group(); gunHolder.position.set(.02, 1.29, -.55); root.add(gunHolder);
    const label = makeNameSprite(name, '#ffffff'); label.position.set(0, 2.22, 0); root.add(label);
    root.userData = { legs, gunHolder, label, shirt, name, isLocal, shirtMesh: torso, arms };
    return root;
  }

  const local = character('#267c65', 'Bạn', true); scene.add(local);
  const remote = new Map();
  let firstPersonGun = null, firstPersonWeapon = '';
  function setHeldGun(root, key) {
    const holder = root.userData.gunHolder;
    while (holder.children.length) {
      const child = holder.children[0]; holder.remove(child);
      child.traverse?.(o => { if (o.geometry) o.geometry.dispose(); });
    }
    if (!key) return;
    const gun = weaponModel(key); holder.add(gun);
  }
  function setFirstPersonGun(key) {
    if (firstPersonGun && firstPersonWeapon === key) return;
    if (firstPersonGun) { camera.remove(firstPersonGun); firstPersonGun.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    firstPersonGun = null; firstPersonWeapon = key || '';
    if (!key) return;
    firstPersonGun = new THREE.Group();
    const gun = weaponModel(key); firstPersonGun.add(gun);
    const sleeve = mat(api.currentColor ? api.currentColor() : 0x267c65);
    segment(firstPersonGun, [-.30,-.24,-.22], [-.10,-.19,-.52], .075, sleeve);
    segment(firstPersonGun, [.35,-.31,-.20], [.12,-.19,-.48], .08, sleeve);
    addMesh(new THREE.SphereGeometry(.07, 10, 8), mat(0x343b3d), firstPersonGun, -.10,-.19,-.52);
    addMesh(new THREE.SphereGeometry(.07, 10, 8), mat(0x343b3d), firstPersonGun, .12,-.19,-.48);
    firstPersonGun.position.set(.32, -.28, -.62); firstPersonGun.rotation.set(-.02, -.08, -.015);
    camera.add(firstPersonGun);
  }

  // A translucent ring marks the non-combat safe zone near the main gate.
  const safeCenter = world([525, 803]);
  const safeRing = addMesh(new THREE.RingGeometry(25.7, 26.25, 80), new THREE.MeshBasicMaterial({ color: 0x4fbf8c, transparent: true, opacity: .48, side: THREE.DoubleSide }), scene, safeCenter[0], .045, safeCenter[1]);
  safeRing.rotation.x = -Math.PI / 2; safeRing.castShadow = false;
  // Ground weapon pickups and the ball.
  const pickupRoots = [];
  const pickupRingMat = new THREE.MeshBasicMaterial({ color: 0xffd26b, transparent: true, opacity: .68, side: THREE.DoubleSide });
  let ballMesh = null;
  if (window.campusGame && Array.isArray(campusGame.spawns)) {
    campusGame.spawns.forEach((sp, i) => {
      const root = new THREE.Group(); root.position.set(sp.x, .20, sp.z); scene.add(root);
      const ring = addMesh(new THREE.RingGeometry(.55, .78, 32), pickupRingMat, root, 0, .025, 0); ring.rotation.x = -Math.PI / 2; ring.castShadow = false;
      const gun = weaponModel(sp.w); gun.rotation.x = .22; gun.scale.setScalar(.78); root.add(gun);
      const beam = addMesh(new THREE.CylinderGeometry(.015, .09, .85, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd26b, transparent: true, opacity: .20 }), root, 0, .42, 0); beam.castShadow = false;
      pickupRoots.push({ root, gun, ring, index: i });
    });
  }
  ballMesh = addMesh(new THREE.SphereGeometry(.42, 24, 18), mat(0xf1f2e9, .38), scene, 0, .42, 0);
  const ballSeams = addMesh(new THREE.TorusGeometry(.31, .012, 6, 36), mat(0x343b39), ballMesh, 0, 0, 0); ballSeams.rotation.x = Math.PI / 2;

  // Tracers are short-lived 3D lines, not flat screen-space decorations.
  const tracers = [];
  function addTracer(x1, z1, x2, z2, color = 0xffd477) {
    const points = [new THREE.Vector3(x1, 1.34, z1), new THREE.Vector3(x2, 1.34, z2)];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .95 }));
    scene.add(line); tracers.push({ line, expires: performance.now() + 150 });
  }
  let shotFlashUntil = 0, localHeldWeapon = '', localColor = '';
  local.userData.recoilUntil = 0;
  function flashWeapon(key, mine, from) {
    shotFlashUntil = performance.now() + 90;
    const targets = mine ? [local] : (remote.has(from) ? [remote.get(from).group] : []);
    targets.forEach(g => { const gun = g.userData.gunHolder.children[0]; if (gun?.userData.flash) gun.userData.flash.visible = true; g.userData.recoilUntil = shotFlashUntil; });
    if (mine && firstPersonGun?.children[0]?.userData.flash) { firstPersonGun.children[0].userData.flash.visible = true; firstPersonGun.userData.recoilUntil = shotFlashUntil; }
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7)); renderer.setSize(w, h, false);
  }
  addEventListener('resize', resize);

  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  let lastRender = 0, camReady = false;
  function render() {
    if (!document.body.classList.contains('walking')) return;
    const now = performance.now(), dt = Math.min(.05, (now - (lastRender || now)) / 1000 || .016); lastRender = now;
    const state = api.state ? api.state() : {};
    const p = api.position();
    const yaw = p.yaw || 0;
    const isFirst = !!state.firstPerson;
    const moving = !!state.moving;
    const running = !!state.running;
    const weapon = state.weapon || '';
    local.position.set(p.x, moving ? Math.abs(Math.sin(now / 90)) * .025 : 0, p.z); local.rotation.y = yaw;
    local.visible = !isFirst;
    const newColor = api.currentColor ? api.currentColor() : '#267c65';
    if (localColor !== newColor) { localColor = newColor; local.userData.shirtMesh.material.color.set(newColor); }
    local.userData.legs.forEach((leg, i) => { leg.rotation.x = moving ? Math.sin(now / (running ? 85 : 130) + i * Math.PI) * (running ? .64 : .42) : THREE.MathUtils.damp(leg.rotation.x, 0, 10, dt); });
    if (localHeldWeapon !== weapon) { setHeldGun(local, weapon); localHeldWeapon = weapon; }
    const kickback = local.userData.recoilUntil > now ? Math.sin((local.userData.recoilUntil - now) / 90 * Math.PI) * .10 : 0;
    local.userData.gunHolder.position.z = -.55 + kickback; local.userData.gunHolder.rotation.x = -kickback * 1.4;
    setFirstPersonGun(isFirst ? weapon : '');
    if (firstPersonGun) { const fpKick = firstPersonGun.userData.recoilUntil > now ? .12 : 0; firstPersonGun.position.z = -.62 + fpKick; }

    // Smoothly follow the local player, with a proper first-person aim direction.
    const pitch = clamp(state.pitch || 0, -.16, .45);
    if (isFirst) {
      camera.position.set(p.x, 1.62, p.z);
      const dir = v3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      camera.lookAt(camera.position.clone().add(dir.multiplyScalar(18)));
    } else {
      const follow = v3(p.x + Math.sin(yaw) * 5.1, 2.55 + pitch * 1.8, p.z + Math.cos(yaw) * 5.1);
      const target = v3(p.x, 1.18, p.z);
      if (!camReady) { camera.position.copy(follow); camReady = true; }
      camera.position.lerp(follow, 1 - Math.exp(-7 * dt));
      camera.lookAt(target);
    }

    // Other players are real independent avatars, interpolated by Supabase Realtime.
    const peers = api.peerList ? api.peerList() : [];
    const liveIds = new Set();
    peers.forEach(peer => {
      if (!peer || !peer.id) return;
      liveIds.add(peer.id);
      let entry = remote.get(peer.id);
      if (!entry) { const group = character(peer.color, peer.name, false); scene.add(group); entry = { group, weapon: '' }; remote.set(peer.id, entry); }
      const g = entry.group;
      g.position.set(peer.x, 0, peer.z); g.rotation.y = peer.yaw || 0;
      g.visible = true; g.userData.label.material.opacity = 1;
      const color = peer.color || '#267c65';
      if (entry.color !== color) {
        entry.color = color;
        g.userData.shirtMesh.material.color.set(color);
      }
      if (entry.name !== peer.name) {
        entry.name = peer.name;
        const label = makeNameSprite(peer.name, '#ffffff'); label.position.copy(g.userData.label.position);
        g.remove(g.userData.label); g.userData.label.material.map.dispose(); g.userData.label.material.dispose(); g.userData.label = label; g.add(label);
      }
      if (entry.weapon !== (peer.weapon || '')) { entry.weapon = peer.weapon || ''; setHeldGun(g, entry.weapon); }
      const recoil = g.userData.recoilUntil > now ? .08 : 0; g.userData.gunHolder.position.z = -.55 + recoil;
      const walkPhase = peer.moving ? Math.sin(now / 115) * .38 : 0;
      g.userData.legs.forEach((leg, i) => { leg.rotation.x = walkPhase * (i ? -1 : 1); });
    });
    for (const [id, entry] of remote) if (!liveIds.has(id)) { scene.remove(entry.group); remote.delete(id); }

    // Pickup availability, bobbing and the shared ball position.
    const game = window.campusGame && campusGame.renderState ? campusGame.renderState() : null;
    if (game) {
      pickupRoots.forEach((item, i) => {
        const available = !game.taken[i]; item.root.visible = !!available;
        if (available) { item.root.position.y = .20 + Math.sin(now / 420 + i) * .07; item.root.rotation.y = Math.sin(now / 1200 + i) * .4; }
      });
      if (game.ball) { ballMesh.visible = game.ball.visible; ballMesh.position.set(game.ball.x, .42 + Math.abs(Math.sin(now / 180)) * Math.min(.55, game.ball.speed * .02), game.ball.z); ballMesh.rotation.x += dt * game.ball.speed * .7; ballMesh.rotation.z += dt * game.ball.speed * .4; }
    }
    for (let i = tracers.length - 1; i >= 0; i--) {
      if (now >= tracers[i].expires) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); tracers[i].line.material.dispose(); tracers.splice(i, 1); }
    }
    if (now > shotFlashUntil) {
      [local, ...Array.from(remote.values(), v => v.group)].forEach(g => { const w = g.userData.gunHolder.children[0]; if (w?.userData.flash) w.userData.flash.visible = false; });
      if (firstPersonGun?.children[0]?.userData.flash) firstPersonGun.children[0].userData.flash.visible = false;
    }
    renderer.render(scene, camera);
  }

  api.state = () => {
    const p = api.position();
    return { ...p, firstPerson: api.firstPerson ? api.firstPerson() : false,
      moving: api.moving ? api.moving() : false, running: api.running(), pitch: api.lookPitch ? api.lookPitch() : 0,
      weapon: window.campusGame?.state?.().weapon || '' };
  };
  api.addTracer = addTracer;
  api.fireVisual = flashWeapon;
  api.peerList = () => api.getPeers ? api.getPeers() : [];
  api.peerCount = () => remote.size;
  window.uteWalk3D = { ready: true, render, addTracer, fireVisual: flashWeapon, scene, camera, renderer };
  document.body.classList.add('walk3d-ready');
  resize();
  // Expose render loop only for walking mode; app.js continues drawing the aerial map.
  const animate = () => { requestAnimationFrame(animate); render(); };
  animate();
})();
