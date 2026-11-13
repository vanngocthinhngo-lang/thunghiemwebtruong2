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
  function noiseMap(base, speck, density = 2200, seed = 7) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d'); ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
    let n = seed >>> 0; const rnd = () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; };
    for (let i = 0; i < density; i++) { const a = .035 + rnd() * .12; ctx.globalAlpha = a; ctx.fillStyle = speck; const r = .35 + rnd() * 1.5; ctx.fillRect(rnd() * 256, rnd() * 256, r, r); }
    ctx.globalAlpha = 1; const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return tex;
  }
  const grassMap = noiseMap('#718a61', '#344b32', 4300, 11); grassMap.repeat.set(34, 34);
  const concreteMap = noiseMap('#c7c8be', '#747b76', 1600, 17); concreteMap.repeat.set(12, 12);
  const wallMap = noiseMap('#e3dfd2', '#8d8a7c', 950, 23); wallMap.repeat.set(4, 4);
  const roofMap = noiseMap('#86675b', '#392e2a', 850, 31); roofMap.repeat.set(5, 5);
  const grassMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: grassMap, roughness: 1 });
  const concreteMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: concreteMap, bumpMap: concreteMap, bumpScale: .025, roughness: .96 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: wallMap, bumpMap: wallMap, bumpScale: .035, roughness: .92 });
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
  const ground = addMesh(new THREE.PlaneGeometry(460, 460), grassMaterial, scene, 0, -.18, 0);
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
  flatShape([[579,714],[793,603],[1000,951],[920,1051],[698,899]].map(world), .012, concreteMaterial);
  flatShape([[655,806],[765,747],[903,922],[819,981]].map(world), .014, mat(0x8c9e76));
  flatShape([[593,601],[745,521],[779,552],[626,640]].map(world), .015, mat(0x9aac83));
  const rawCourt = [[405,450],[603,340],[703,480],[482,589]].map(world);
  const courtCenter = rawCourt.reduce((s,p)=>[s[0]+p[0]/rawCourt.length,s[1]+p[1]/rawCourt.length],[0,0]);
  const court = rawCourt.map(p=>[courtCenter[0]+(p[0]-courtCenter[0])*.62,courtCenter[1]+(p[1]-courtCenter[1])*.62]);
  flatShape(court, .035, new THREE.MeshStandardMaterial({ color: 0xffffff, map: grassMap, roughness: .96 }));
  for (let i = 0; i < 4; i++) lineXZ(court[i], court[(i + 1) % 4], .12, .07, materials.white);
  lineXZ([(court[0][0]+court[3][0])/2,(court[0][1]+court[3][1])/2], [(court[1][0]+court[2][0])/2,(court[1][1]+court[2][1])/2], .1, .07, materials.white);
  // Pitch markings, penalty areas and twin goals.
  const goalA = [(court[3][0]+court[0][0])/2,(court[3][1]+court[0][1])/2];
  const goalB = [(court[1][0]+court[2][0])/2,(court[1][1]+court[2][1])/2];
  const pitchCenter = [(goalA[0]+goalB[0])/2,(goalA[1]+goalB[1])/2];
  const longAxis = new THREE.Vector2(goalB[0]-goalA[0],goalB[1]-goalA[1]).normalize();
  const shortAxis = new THREE.Vector2(-longAxis.y,longAxis.x);
  const halfLength = new THREE.Vector2(goalB[0]-goalA[0],goalB[1]-goalA[1]).length()/2;
  const halfWidth = new THREE.Vector2(court[0][0]-court[3][0],court[0][1]-court[3][1]).length()/2;
  const pitchPoint = (u,v) => [pitchCenter[0]+longAxis.x*u+shortAxis.x*v,pitchCenter[1]+longAxis.y*u+shortAxis.y*v];
  const centerCircle = addMesh(new THREE.RingGeometry(2.05,2.16,64), new THREE.MeshBasicMaterial({color:0xecefe1,side:THREE.DoubleSide}), scene, pitchCenter[0], .085, pitchCenter[1]); centerCircle.rotation.x=-Math.PI/2; centerCircle.castShadow=false;
  [-1,1].forEach(side=>{
    const u=side*(halfLength-7.2), a=pitchPoint(u,-halfWidth*.53), b=pitchPoint(u,halfWidth*.53);
    lineXZ(a,b,.09,.085,materials.white);
    const boxA=pitchPoint(side*(halfLength-13),-halfWidth*.53),boxB=pitchPoint(side*halfLength,-halfWidth*.53),boxC=pitchPoint(side*halfLength,halfWidth*.53),boxD=pitchPoint(side*(halfLength-13),halfWidth*.53);
    [[boxA,boxB],[boxB,boxC],[boxC,boxD]].forEach(v=>lineXZ(v[0],v[1],.09,.085,materials.white));
    const gCenter=pitchPoint(side*halfLength,0), outward=[longAxis.x*side,longAxis.y*side], goalWidth=5.4, goalHeight=2.05, depth=1.35;
    const postMaterial=mat(0xf4f4e9,.34,.12), postA=[gCenter[0]-shortAxis.x*goalWidth/2,gCenter[1]-shortAxis.y*goalWidth/2], postB=[gCenter[0]+shortAxis.x*goalWidth/2,gCenter[1]+shortAxis.y*goalWidth/2];
    [postA,postB].forEach(pos=>addMesh(new THREE.CylinderGeometry(.095,.11,goalHeight,12),postMaterial,scene,pos[0],goalHeight/2+.08,pos[1]));
    const bar=addMesh(new THREE.CylinderGeometry(.095,.095,goalWidth,12),postMaterial,scene,gCenter[0],goalHeight+.08,gCenter[1]); bar.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(shortAxis.x,0,shortAxis.y).normalize());
    const back=[gCenter[0]+outward[0]*depth,gCenter[1]+outward[1]*depth];
    const netMaterial=new THREE.MeshBasicMaterial({color:0xe6ede4,wireframe:true,transparent:true,opacity:.34,side:THREE.DoubleSide});
    const netPlane=addMesh(new THREE.PlaneGeometry(goalWidth,goalHeight,12,7),netMaterial,scene,back[0],goalHeight/2+.08,back[1]); netPlane.rotation.y=Math.atan2(outward[0],outward[1]); netPlane.castShadow=false;
    [-1,1].forEach(sideV=>{const x1=gCenter[0]+shortAxis.x*sideV*goalWidth/2,z1=gCenter[1]+shortAxis.y*sideV*goalWidth/2;const x2=x1+outward[0]*depth,z2=z1+outward[1]*depth;lineXZ([x1,z1],[x2,z2],.055,.10,postMaterial);});
  });

  const colorFromHex = h => new THREE.Color(h || '#e5e1d3');
  CAMPUS.buildings.forEach((b, index) => {
    if (b.kind === 'area' || !b.poly || b.poly.length < 3) return;
    const poly = b.poly.map(world), center = poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0]);
    const local = poly.map(p => [center[0] + (p[0] - center[0]) * .96, center[1] + (p[1] - center[1]) * .96]);
    const h = Math.max(2.2, b.h || 5.2), wallMat = new THREE.MeshStandardMaterial({ color: colorFromHex(b.c || (index % 3 ? 0xd8d4c7 : 0xe4dfd2)), map: wallMap, bumpMap: wallMap, bumpScale: .028, roughness: .9 });
    const shape = new THREE.Shape(); shape.moveTo(local[0][0], -local[0][1]);
    local.slice(1).forEach(p => shape.lineTo(p[0], -p[1])); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .025, bevelThickness: .025 });
    geo.rotateX(-Math.PI / 2);
    const body = addMesh(geo, [wallMat, wallMat], scene); body.castShadow = true; body.receiveShadow = true;
    flatShape(local, h + .035, new THREE.MeshStandardMaterial({ color: b.roof || 0x8e4c3c, map: roofMap, bumpMap: roofMap, bumpScale: .045, roughness: .84 }));
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
          const lintel = makeBox(scene, [width + .08,.045,.07],[wx,y+.34,wz],materials.trim); lintel.rotation.y=-Math.atan2(dz,dx);
          [-1,1].forEach(side=>{const jamb=makeBox(scene,[.045,.70,.075],[wx+side*(width/2+.02),y,wz],materials.trim);jamb.rotation.y=-Math.atan2(dz,dx);});
          if(k%2===0){const mullion=makeBox(scene,[.035,.62,.08],[wx,y,wz],materials.trim);mullion.rotation.y=-Math.atan2(dz,dx);}
          // Selected upper-floor windows receive shallow balconies and handrails.
          if ((b.floors || 0) >= 3 && floor > 0 && k % 3 === 1 && length > 4.2) {
            const outward = [wx - center[0], wz - center[1]], olen = Math.hypot(outward[0], outward[1]) || 1;
            const nx = outward[0] / olen, nz = outward[1] / olen, angle = -Math.atan2(dz, dx);
            const bw = Math.max(.72, width * .92), bx = wx + nx * .23, bz = wz + nz * .23;
            const slab = makeBox(scene, [bw, .085, .56], [bx, y - .39, bz], materials.trim); slab.rotation.y = angle;
            const rail = makeBox(scene, [bw, .055, .055], [wx + nx * .50, y - .13, wz + nz * .50], materials.glass); rail.rotation.y = angle;
            [-1, 1].forEach(side => {
              const px = wx + dx / length * side * (bw / 2 - .03) + nx * .34;
              const pz = wz + dz / length * side * (bw / 2 - .03) + nz * .34;
              const post = makeBox(scene, [.045, .28, .045], [px, y - .25, pz], materials.trim); post.rotation.y = angle;
            });
            const lower = makeBox(scene, [bw, .035, .05], [wx + nx * .49, y - .34, wz + nz * .49], materials.trim); lower.rotation.y = angle;
          }
        }
      }
    });
    // Subtle floor slabs, corner columns, window frames and rooftop service details.
    const levels = b.floors || Math.max(1, Math.floor(h / 3.3));
    for (let floor = 1; floor < levels; floor++) {
      const y = floor * h / levels;
      for (let i = 0; i < local.length; i++) {
        const p1 = local[i], p2 = local[(i+1)%local.length];
        lineXZ(p1,p2,.055,y,materials.trim);
      }
    }
    local.forEach((v,i)=>{
      addMesh(new THREE.BoxGeometry(.16,h+.10,.16),materials.trim,scene,v[0],h/2,v[1]);
      const q=local[(i+1)%local.length],dx=q[0]-v[0],dz=q[1]-v[1],length=Math.hypot(dx,dz);
      if(length>5){const canopy=makeBox(scene,[Math.min(2.4,length*.35),.10,.8],[v[0]+dx*.5,.32,v[1]+dz*.5],materials.trim);canopy.rotation.y=-Math.atan2(dz,dx);}
    });
    // Low-rise rooftop HVAC boxes, skylights and parapet shadows make each block less toy-like.
    for(let k=0;k<Math.min(3,Math.max(1,Math.floor(local.length/2)));k++){
      const v=local[k],q=local[(k+1)%local.length],x=(v[0]+q[0])/2,z=(v[1]+q[1])/2;
      const unit=makeBox(scene,[.85,.42,.62],[x,h+.28,z],mat(0x969a91,.9));
      unit.rotation.y=-Math.atan2(q[1]-v[1],q[0]-v[0]);
      makeBox(scene,[.9,.06,.66],[x,h+.52,z],materials.trim).rotation.y=unit.rotation.y;
    }
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
    // Clustered broadleaf crowns look more like campus shade trees than stacked cones.
    const crowns = [[0,2.55,0,1.02],[.62,2.38,.12,.76],[-.55,2.42,-.16,.78],[.12,3.05,-.10,.74],[.05,1.98,.10,.66]];
    crowns.forEach(([cx,cy,cz,r],j) => {
      const crown = addMesh(new THREE.IcosahedronGeometry(r, 1), [materials.leaf1,materials.leaf2,materials.leaf3][(i+j)%3], root, cx, cy, cz);
      crown.scale.set(1.12,.86,.98);
    });
  });

  // Campus path lights add scale and believable depth along the main walkways.
  const lampMetal = mat(0x485451, .56, .42), lampGlass = new THREE.MeshStandardMaterial({ color: 0xffedbd, emissive: 0x6a5229, emissiveIntensity: .34, roughness: .28 });
  [[330,492],[470,628],[705,690],[920,764],[1090,615],[835,370]].forEach(([px,pz],i)=>{
    const [x,z]=world([px,pz]),pole=addMesh(new THREE.CylinderGeometry(.045,.075,4.3,9),lampMetal,scene,x,2.15,z);
    pole.castShadow=true;
    addMesh(new THREE.CylinderGeometry(.30,.24,.12,12),lampMetal,scene,x,4.27,z);
    addMesh(new THREE.SphereGeometry(.16,12,9),lampGlass,scene,x,4.16,z);
    const arm=makeBox(scene,[.08,.08,.72],[x,.0,z],lampMetal);arm.position.y=4.0;arm.rotation.y=(i%2?-.5:.5);
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
    const makeArmPair = (parent, holding) => {
      const pivots=[];
      [-1,1].forEach(side=>{
        const pivot=new THREE.Group();pivot.position.set(side*.305,1.44,0);parent.add(pivot);
        addMesh(new THREE.SphereGeometry(.115,14,11),shirt,pivot,0,-.015,0);
        const elbow=holding?[side*-.035,-.23,-.20]:[side*.10,-.31,.035];
        const wrist=holding?[side*-.155,-.17,-.52]:[side*.16,-.61,.075];
        segment(pivot,[0,0,0],elbow,.092,shirt,12);
        segment(pivot,elbow,wrist,.073,shirt,12);
        addMesh(new THREE.SphereGeometry(.073,14,10),skin,pivot,wrist[0],wrist[1],wrist[2]);
        addMesh(new THREE.CapsuleGeometry(.022,.055,3,7),skin,pivot,wrist[0]+side*.035,wrist[1]+.012,wrist[2]-.018).rotation.z=side*.35;
        pivots.push(pivot);
      });
      return pivots;
    };
    const armsHold=new THREE.Group();root.add(armsHold);const holdArms=makeArmPair(armsHold,true);
    const armsIdle=new THREE.Group();root.add(armsIdle);const idleArms=makeArmPair(armsIdle,false);
    armsHold.visible=false;armsIdle.visible=true;
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
    const label = makeNameSprite(name, '#ffffff'); label.position.set(0, 2.22, 0); label.visible=!isLocal; root.add(label);
    root.userData = { legs, gunHolder, label, shirt, name, isLocal, shirtMesh: torso, armsHold, armsIdle, idleArms, holdArms, head };
    return root;
  }

  const local = character('#267c65', 'Bạn', true); scene.add(local);
  const remote = new Map();
  let firstPersonGun = null, firstPersonWeapon = '';
  function setHeldGun(root, key) {
    const holder = root.userData.gunHolder;
    if(root.userData.armsHold)root.userData.armsHold.visible=!!key;
    if(root.userData.armsIdle)root.userData.armsIdle.visible=!key;
    while (holder.children.length) {
      const child = holder.children[0]; holder.remove(child);
      child.traverse?.(o => { if (o.geometry) o.geometry.dispose(); });
    }
    if (!key) return;
    const gun = weaponModel(key); holder.add(gun);
  }
  let firstPersonHandsMode = '';
  function setFirstPersonGun(key, active) {
    const mode = (active ? 'active:' : 'hidden:') + (key || 'empty');
    if (firstPersonGun && firstPersonHandsMode === mode) return;
    if (firstPersonGun) { camera.remove(firstPersonGun); firstPersonGun.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    firstPersonGun = null; firstPersonWeapon = key || ''; firstPersonHandsMode = mode;
    if (!active) return;
    firstPersonGun = new THREE.Group();
    const sleeve = mat(api.currentColor ? api.currentColor() : 0x267c65);
    if (key) firstPersonGun.add(weaponModel(key));
    // Bare hands remain visible when the player switches the weapon mode off.
    segment(firstPersonGun, [-.30,-.24,-.22], [-.10,-.19,-.52], .075, sleeve);
    segment(firstPersonGun, [.35,-.31,-.20], [.12,-.19,-.48], .08, sleeve);
    addMesh(new THREE.SphereGeometry(.07, 10, 8), mat(0xc88f6d), firstPersonGun, -.10,-.19,-.52);
    addMesh(new THREE.SphereGeometry(.07, 10, 8), mat(0xc88f6d), firstPersonGun, .12,-.19,-.48);
    if (key) { firstPersonGun.position.set(.32, -.28, -.62); firstPersonGun.rotation.set(-.02, -.08, -.015); }
    else { firstPersonGun.position.set(.10,-.23,-.56); firstPersonGun.rotation.set(.08,0,0); }
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
  const ballPatchMat=mat(0x30383a,.82); [[0,.40,0],[.32,.18,.14],[-.28,.18,-.20],[.16,-.26,.25],[-.22,-.24,.23]].forEach(v=>addMesh(new THREE.DodecahedronGeometry(.095,0),ballPatchMat,ballMesh,...v));

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
    const weapon = state.fight ? (state.weapon || '') : '';
    // When combat is switched off, forcibly clear both weapon meshes and muzzle effects.
    if (!state.fight && localHeldWeapon) { setHeldGun(local, ''); localHeldWeapon = ''; }
    const jumpY=api.jumpHeight?api.jumpHeight():0;
    local.position.set(p.x,jumpY+(moving ? Math.abs(Math.sin(now / 175)) * .045 : 0),p.z); local.rotation.y = yaw;
    local.visible = !isFirst;
    const newColor = api.currentColor ? api.currentColor() : '#267c65';
    if (localColor !== newColor) { localColor = newColor; local.userData.shirtMesh.material.color.set(newColor); }
    const phase=now/(running?112:178),stride=moving?Math.sin(phase):0;
    local.userData.legs.forEach((leg,i)=>{leg.rotation.x=moving?Math.sin(phase+i*Math.PI)*(running?.72:.52):THREE.MathUtils.damp(leg.rotation.x,0,9,dt);});
    if(local.userData.holdArms)local.userData.holdArms.forEach(arm=>{arm.rotation.x=THREE.MathUtils.damp(arm.rotation.x,moving?stride*.10:0,7,dt);});
    if(local.userData.idleArms)local.userData.idleArms.forEach((arm,i)=>{arm.rotation.x=THREE.MathUtils.damp(arm.rotation.x,moving?(i===0?stride*.55:-stride*.55):0,8,dt);arm.rotation.z=THREE.MathUtils.damp(arm.rotation.z,moving?(i===0?-.035:.035):0,8,dt);});
    local.userData.shirtMesh.position.y=THREE.MathUtils.damp(local.userData.shirtMesh.position.y,1.22+(moving?Math.abs(stride)*.035:0),9,dt);
    if(local.userData.head)local.userData.head.rotation.z=THREE.MathUtils.damp(local.userData.head.rotation.z,moving?Math.sin(now/300)*.025:0,6,dt);
    local.rotation.z=THREE.MathUtils.damp(local.rotation.z,moving?Math.sin(phase)*.022:0,7,dt);
    if (localHeldWeapon !== weapon) { setHeldGun(local, weapon); localHeldWeapon = weapon; }
    const kickback = local.userData.recoilUntil > now ? Math.sin((local.userData.recoilUntil - now) / 90 * Math.PI) * .10 : 0;
    local.userData.gunHolder.position.z = -.55 + kickback; local.userData.gunHolder.rotation.x = -kickback * 1.4;
    setFirstPersonGun(isFirst ? weapon : '', isFirst);
    if (firstPersonGun) { const fpKick = firstPersonGun.userData.recoilUntil > now ? .12 : 0; firstPersonGun.position.z = -.62 + fpKick; }

    // Smoothly follow the local player, with a proper first-person aim direction.
    const pitch = clamp(state.pitch || 0, -.16, .45);
    if (isFirst) {
      camera.position.set(p.x, 1.62, p.z);
      const dir = v3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      camera.lookAt(camera.position.clone().add(dir.multiplyScalar(18)));
    } else {
      const shoulderX=Math.cos(yaw)*.88,shoulderZ=-Math.sin(yaw)*.88;
      const follow=v3(p.x+Math.sin(yaw)*4.8+shoulderX,2.55+pitch*1.8+jumpY,p.z+Math.cos(yaw)*4.8+shoulderZ);
      const target=v3(p.x-Math.sin(yaw)*8.0,1.35+jumpY,p.z-Math.cos(yaw)*8.0);
      if (!camReady) { camera.position.copy(follow); camReady = true; }
      camera.position.lerp(follow, 1 - Math.exp(-7 * dt));
      camera.lookAt(target);
    }

    // Other players are real independent avatars, interpolated by Supabase Realtime.
    const peers = api.peerList ? api.peerList().filter(v=>v.id!=='ute-campus-bot') : [];
    const botPeer = window.campusGame?.botPlayer?.(); if(botPeer)peers.push(botPeer);
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
      const peerWeapon = (peer.fighting || peer.f) ? (peer.weapon || '') : '';
      if (entry.weapon !== peerWeapon) { entry.weapon = peerWeapon; setHeldGun(g, entry.weapon); }
      const recoil = g.userData.recoilUntil > now ? .08 : 0; g.userData.gunHolder.position.z = -.55 + recoil;
      const walkPhase=peer.moving?Math.sin(now/175)*.48:0;
      g.userData.legs.forEach((leg,i)=>{leg.rotation.x=walkPhase*(i?-1:1);});
      if(g.userData.idleArms)g.userData.idleArms.forEach((arm,i)=>{arm.rotation.x=THREE.MathUtils.damp(arm.rotation.x,peer.moving?(i===0?walkPhase:-walkPhase):0,8,dt);});
      if(g.userData.holdArms)g.userData.holdArms.forEach(arm=>{arm.rotation.x=THREE.MathUtils.damp(arm.rotation.x,peer.moving?walkPhase*.08:0,8,dt);});
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
      fight: !!window.campusGame?.isFighting?.(), moving: api.moving ? api.moving() : false, running: api.running(), pitch: api.lookPitch ? api.lookPitch() : 0,
      weapon: window.campusGame?.state?.().weapon || '' };
  };
  api.addTracer = addTracer;
  api.aimRay = () => {const dir=new THREE.Vector3();camera.getWorldDirection(dir);const player=api.position(),originX=player.x-Math.sin(player.yaw)*.62,originZ=player.z-Math.cos(player.yaw)*.62,focus=camera.position.clone().add(dir.multiplyScalar(24));return {x:originX,z:originZ,yaw:Math.atan2(focus.z-originZ,focus.x-originX)};};
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
