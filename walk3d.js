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
  // Balanced GPU defaults: avoid expensive full-scene shadow maps and cap DPR.
  const lowEndDevice = (navigator.deviceMemory && navigator.deviceMemory <= 6) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 6) || innerWidth < 700;
  const maxRenderDpr = lowEndDevice ? .9 : 1.18;
  let renderDpr = Math.min(devicePixelRatio || 1, maxRenderDpr);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowEndDevice, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(renderDpr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = false; // soft contact shadows are drawn cheaply under avatars
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const mat = (color, roughness = .82, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  function noiseMap(base, speck, density = 2200, seed = 7) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d'); ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
    let n = seed >>> 0; const rnd = () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; };
    for (let i = 0; i < density; i++) { const a = .035 + rnd() * .12; ctx.globalAlpha = a; ctx.fillStyle = speck; const r = .35 + rnd() * 1.5; ctx.fillRect(rnd() * 256, rnd() * 256, r, r); }
    ctx.globalAlpha = 1; const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); return tex;
  }
  const grassMap = noiseMap('#718a61', '#344b32', 4300, 11); grassMap.repeat.set(34, 34);
  const concreteMap = noiseMap('#c7c8be', '#747b76', 1600, 17); concreteMap.repeat.set(12, 12);
  const wallMap = noiseMap('#e3dfd2', '#8d8a7c', 950, 23); wallMap.repeat.set(4, 4);
  const roofMap = noiseMap('#86675b', '#392e2a', 850, 31); roofMap.repeat.set(5, 5);
  const grassMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: grassMap, roughness: 1 });
  const concreteMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: concreteMap, roughness: .96 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: wallMap, roughness: .92 });
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
  sun.position.set(-42, 62, 38); sun.castShadow = false;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xb6d8ff, .48); fill.position.set(35, 24, -45); scene.add(fill);

  function addMesh(geometry, material, parent = scene, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = false; parent.add(m); return m;
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
  const sharedBoxGeometries=new Map();
  function makeBox(parent, size, position, material, rotation = null) {
    const key=size.map(v=>Number(v).toFixed(3)).join('|');let geo=sharedBoxGeometries.get(key);
    if(!geo){geo=new THREE.BoxGeometry(...size);geo.userData.uteShared=true;sharedBoxGeometries.set(key,geo);}
    const m = new THREE.Mesh(geo, material);m.position.set(...position);m.castShadow=false;m.receiveShadow=false;parent.add(m);
    if (rotation) m.rotation.set(...rotation); return m;
  }

  const createLocalFrame = rawPoly => {
    const raw=rawPoly.map(world),rawCenter=raw.reduce((a,p)=>[a[0]+p[0]/raw.length,a[1]+p[1]/raw.length],[0,0]);
    const points=raw.map(p=>[rawCenter[0]+(p[0]-rawCenter[0])*.96,rawCenter[1]+(p[1]-rawCenter[1])*.96]);
    const center=points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]);
    const lenA=Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1]);
    const lenB=Math.hypot(points[2][0]-points[1][0],points[2][1]-points[1][1]);
    const axis=lenA>=lenB?[points[1][0]-points[0][0],points[1][1]-points[0][1]]:[points[2][0]-points[1][0],points[2][1]-points[1][1]];
    const len=Math.hypot(axis[0],axis[1])||1;
    const U=[axis[0]/len,axis[1]/len],V=[-U[1],U[0]];
    const halfU=Math.max(...points.map(q=>Math.abs((q[0]-center[0])*U[0]+(q[1]-center[1])*U[1])))-.45;
    const halfV=Math.max(...points.map(q=>Math.abs((q[0]-center[0])*V[0]+(q[1]-center[1])*V[1])))-.45;
    return {center,U,V,halfU,halfV,toWorld:(u,v)=>[center[0]+u*U[0]+v*V[0],center[1]+u*U[1]+v*V[1]],toLocal:(x,z)=>[(x-center[0])*U[0]+(z-center[1])*U[1],(x-center[0])*V[0]+(z-center[1])*V[1]],angleU:-Math.atan2(U[1],U[0]),angleV:-Math.atan2(V[1],V[0])};
  };
  function localBox(frame,parent,size,u,v,y,material,axis='u'){
    const pos=frame.toWorld(u,v),angle=axis==='u'?frame.angleU:frame.angleV;
    return makeBox(parent,size,[pos[0],y,pos[1]],material,[0,angle,0]);
  }
  function localWallU(frame,parent,u1,u2,v,yBase,height,thickness,material){
    if(u2-u1<.02)return null;return localBox(frame,parent,[u2-u1,height,thickness],(u1+u2)/2,v,yBase+height/2,material,'u');
  }
  function localWallV(frame,parent,u,v1,v2,yBase,height,thickness,material){
    if(v2-v1<.02)return null;return localBox(frame,parent,[v2-v1,height,thickness],u,(v1+v2)/2,yBase+height/2,material,'v');
  }
  function addInstances(geometry,material,items){
    if(!items.length)return null;const mesh=new THREE.InstancedMesh(geometry,material,items.length),obj=new THREE.Object3D();
    items.forEach((it,i)=>{const q=it.pos;obj.position.set(q[0],it.y,q[1]);obj.rotation.y=it.angle||0;obj.scale.set(...(it.scale||[1,1,1]));obj.updateMatrix();mesh.setMatrixAt(i,obj.matrix);});
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=false;mesh.receiveShadow=false;scene.add(mesh);return mesh;
  }
  function signTexture(text,bg='#315b58'){
    const c=document.createElement('canvas');c.width=512;c.height=128;const x=c.getContext('2d');
    x.fillStyle=bg;x.fillRect(0,0,512,128);x.strokeStyle='#dce8df';x.lineWidth=8;x.strokeRect(5,5,502,118);
    x.fillStyle='#f4f5e9';x.font='bold 46px Arial';x.textAlign='center';x.textBaseline='middle';x.fillText(text,256,66);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
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
  const rawGoalA=[(rawCourt[3][0]+rawCourt[0][0])/2,(rawCourt[3][1]+rawCourt[0][1])/2],rawGoalB=[(rawCourt[1][0]+rawCourt[2][0])/2,(rawCourt[1][1]+rawCourt[2][1])/2];
  const rawLongLen=Math.hypot(rawGoalB[0]-rawGoalA[0],rawGoalB[1]-rawGoalA[1]),longAxis=new THREE.Vector2((rawGoalB[0]-rawGoalA[0])/rawLongLen,(rawGoalB[1]-rawGoalA[1])/rawLongLen),shortAxis=new THREE.Vector2(-longAxis.y,longAxis.x);
  const halfLength=rawLongLen*.27,halfWidth=Math.min(...rawCourt.map(p=>Math.abs((p[0]-courtCenter[0])*shortAxis.x+(p[1]-courtCenter[1])*shortAxis.y)))*.54;
  const pitchPoint=(u,v)=>[courtCenter[0]+longAxis.x*u+shortAxis.x*v,courtCenter[1]+longAxis.y*u+shortAxis.y*v];
  const court=[pitchPoint(-halfLength,-halfWidth),pitchPoint(halfLength,-halfWidth),pitchPoint(halfLength,halfWidth),pitchPoint(-halfLength,halfWidth)];
  flatShape(court, .035, new THREE.MeshStandardMaterial({ color: 0xffffff, map: grassMap, roughness: .96 }));
  for (let i = 0; i < 4; i++) lineXZ(court[i], court[(i + 1) % 4], .12, .07, materials.white);
  lineXZ([(court[0][0]+court[3][0])/2,(court[0][1]+court[3][1])/2], [(court[1][0]+court[2][0])/2,(court[1][1]+court[2][1])/2], .1, .07, materials.white);
  // Pitch markings, penalty areas and twin goals.
  const goalA = [(court[3][0]+court[0][0])/2,(court[3][1]+court[0][1])/2];
  const goalB = [(court[1][0]+court[2][0])/2,(court[1][1]+court[2][1])/2];
  const pitchCenter = [(goalA[0]+goalB[0])/2,(goalA[1]+goalB[1])/2];
  // Long/short axes and half extents are shared with app.js and game.js above.
  const centerCircle = addMesh(new THREE.RingGeometry(2.05,2.16,64), new THREE.MeshBasicMaterial({color:0xecefe1,side:THREE.DoubleSide}), scene, pitchCenter[0], .085, pitchCenter[1]); centerCircle.rotation.x=-Math.PI/2; centerCircle.castShadow=false;
  // The halfway line must run across the width of the pitch (perpendicular to the goal-to-goal axis).
  // The old version joined the two goal centres, creating a long diagonal-looking stripe.
  const halfwayA=[(court[0][0]+court[1][0])/2,(court[0][1]+court[1][1])/2];
  const halfwayB=[(court[3][0]+court[2][0])/2,(court[3][1]+court[2][1])/2];
  lineXZ(halfwayA,halfwayB,.11,.085,materials.white);
  [-1,1].forEach(side=>{
    const u=side*(halfLength-7.2), a=pitchPoint(u,-halfWidth*.53), b=pitchPoint(u,halfWidth*.53);
    lineXZ(a,b,.09,.085,materials.white);
    const boxA=pitchPoint(side*(halfLength-13),-halfWidth*.53),boxB=pitchPoint(side*halfLength,-halfWidth*.53),boxC=pitchPoint(side*halfLength,halfWidth*.53),boxD=pitchPoint(side*(halfLength-13),halfWidth*.53);
    [[boxA,boxB],[boxB,boxC],[boxC,boxD]].forEach(v=>lineXZ(v[0],v[1],.09,.085,materials.white));
    const gCenter=pitchPoint(side*halfLength,0), outward=[longAxis.x*side,longAxis.y*side], goalWidth=6.0, goalHeight=2.35, depth=1.65;
    const postMaterial=mat(0xf4f4e9,.34,.12), postA=[gCenter[0]-shortAxis.x*goalWidth/2,gCenter[1]-shortAxis.y*goalWidth/2], postB=[gCenter[0]+shortAxis.x*goalWidth/2,gCenter[1]+shortAxis.y*goalWidth/2];
    [postA,postB].forEach(pos=>addMesh(new THREE.CylinderGeometry(.12,.13,goalHeight,14),postMaterial,scene,pos[0],goalHeight/2+.08,pos[1]));
    const bar=addMesh(new THREE.CylinderGeometry(.12,.12,goalWidth,14),postMaterial,scene,gCenter[0],goalHeight+.08,gCenter[1]); bar.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(shortAxis.x,0,shortAxis.y).normalize());
    const back=[gCenter[0]+outward[0]*depth,gCenter[1]+outward[1]*depth];
    const netMaterial=new THREE.MeshBasicMaterial({color:0xe6ede4,wireframe:true,transparent:true,opacity:.34,side:THREE.DoubleSide});
    const netPlane=addMesh(new THREE.PlaneGeometry(goalWidth,goalHeight,12,7),netMaterial,scene,back[0],goalHeight/2+.08,back[1]); netPlane.rotation.y=Math.atan2(outward[0],outward[1]); netPlane.castShadow=false;
    [-1,1].forEach(sideV=>{const x1=gCenter[0]+shortAxis.x*sideV*goalWidth/2,z1=gCenter[1]+shortAxis.y*sideV*goalWidth/2;const x2=x1+outward[0]*depth,z2=z1+outward[1]*depth;lineXZ([x1,z1],[x2,z2],.075,.10,postMaterial);});
  });

  const colorFromHex = h => new THREE.Color(h || '#e5e1d3');
  const academicMaterials={floor:mat(0xc9c7b9),corridor:mat(0xbebcae),partition:mat(0xd8d4c7),door:mat(0x805d43),wood:mat(0xb78955),metal:mat(0x606b6b,.6,.45),board:mat(0x244d4a),ceiling:mat(0xd9d8ce)};
  const academicFrame=createLocalFrame(CAMPUS.buildings[3].poly);
  const roomStart=-academicFrame.halfU+4.4,roomEnd=academicFrame.halfU-9.2,roomCount=4,roomSpan=(roomEnd-roomStart)/roomCount,storey=3.2,levelCount=3;
  function buildAcademicInterior(){
    const f=academicFrame,U=f.halfU-.35,V=f.halfV-.35;
    const roomCenters=Array.from({length:roomCount},(_,i)=>roomStart+(i+.5)*roomSpan);
    const tableItems=[],tableBaseItems=[],chairSeatItems=[],chairBackItems=[],chairLegItems=[];
    const loungeSeat=mat(0x2864cf),loungeCushion=mat(0x3c77ce),loungeTable=mat(0x8f765d),loungeMetal=mat(0x626c6a,.65,.32);
    const projectDesk=mat(0xb58a56),shelfMat=mat(0x80664d);
    for(let level=0;level<levelCount;level++){
      const base=level*storey;
      localBox(f,scene,[2*U,.18,2*V],0,0,base-.09,academicMaterials.floor,'u');
      // Continuous outer shell, with a wide ground-floor entrance into the student lounge.
      localWallU(f,scene,-U,U,-V,base,storey,.28,materials.wall);
      localWallU(f,scene,-U,U,V,base,storey,.28,materials.wall);
      if(level===0){localWallV(f,scene,-U,-V,-1.65,base,storey,.28,materials.wall);localWallV(f,scene,-U,1.65,V,base,storey,.28,materials.wall);}
      else localWallV(f,scene,-U,-V,V,base,storey,.28,materials.wall);
      localWallV(f,scene,U,-V,V,base,storey,.28,materials.wall);

      // Floor 2 only: separate classrooms along both sides of a central corridor.
      if(level===1){
        [-1,1].forEach(side=>{
          let cursor=-U+.8;const doorHalf=.92;
          roomCenters.forEach(cu=>{
            localWallU(f,scene,cursor,cu-doorHalf,side*1.82,base,2.55,.13,academicMaterials.partition);
            localWallU(f,scene,cu+doorHalf,U-.3,side*1.82,base,2.55,.13,academicMaterials.partition);
            cursor=cu+doorHalf;
          });
          roomCenters.forEach(cu=>{
            localWallU(f,scene,cu-.88,cu+.88,side*1.82,base+2.48,.12,.16,academicMaterials.partition);
            // Slightly open classroom door leaf, not blocking the doorway.
            localBox(f,scene,[.075,2.25,.86],cu-.82,side*1.82,base+1.12,academicMaterials.door,'v');
          });
        });
        for(let i=0;i<=roomCount;i++){
          const u=roomStart+i*roomSpan;
          if(i>0){localWallV(f,scene,u,1.9,V-.25,base,2.65,.13,academicMaterials.partition);localWallV(f,scene,u,-V+.25,-1.9,base,2.65,.13,academicMaterials.partition);}
        }
      }

      // Windows around all levels. Floor 1 remains visually open as the student lounge.
      roomCenters.forEach((cu,i)=>[-1,1].forEach(side=>{
        localBox(f,scene,[Math.min(3.1,roomSpan*.32),1.12,.10],cu,side*(V-.15),base+1.85,materials.glass,'u');
        localBox(f,scene,[Math.min(3.35,roomSpan*.34),.08,.18],cu,side*(V-.15),base+1.25,materials.trim,'u');
        if(level===1){
          const sign=addMesh(new THREE.PlaneGeometry(1.30,.40),new THREE.MeshBasicMaterial({map:signTexture('PHÒNG HỌC '+(i+1+(side===1?0:4))),transparent:false,side:THREE.DoubleSide}),scene);
          const pos=f.toWorld(cu,side*2.0);sign.position.set(pos[0],base+2.20,pos[1]);sign.rotation.y=f.angleU;
          localBox(f,scene,[.09,1.08,2.65],roomStart+i*roomSpan+.75,side*5.35,base+1.78,academicMaterials.board,'v');
        }
      }));

      if(level===0){
        // Student lounge: reception and compact sofa clusters at the edges, central aisle kept clear.
        localBox(f,scene,[3.5,.92,1.05],-U+7.5,-V+1.15,base+.48,loungeSeat,'u');
        localBox(f,scene,[2.9,.12,.82],-U+7.5,-V+1.15,base+.99,loungeCushion,'u');
        for(const cu of [-U+10,-U+20,U-23,U-12])for(const side of [-1,1]){
          const cv=side*Math.max(2.8,V-2.3);
          localBox(f,scene,[2.55,.54,.70],cu,cv,base+.35,loungeSeat,'u');
          localBox(f,scene,[2.25,.13,.56],cu,cv,base+.68,loungeCushion,'u');
          localBox(f,scene,[1.05,.32,.68],cu,cv-side*1.45,base+.22,loungeTable,'u');
        }
        // Notice board and wall benches make the space read as a student common area.
        localBox(f,scene,[.12,1.35,3.0],-U+8,-V+.25,base+1.95,academicMaterials.board,'v');
        localBox(f,scene,[2.4,.14,.46],U-5,0,base+.42,loungeSeat,'u');
      } else if(level===1){
        // Desks and chairs exist only on floor 2 (student classrooms).
        roomCenters.forEach(cu=>[-1,1].forEach(side=>{
          [-.24,.24].forEach(offset=>{
            const du=cu+offset*roomSpan,dv=side*5.15,chairV=side*3.95,pos=f.toWorld(du,dv),chair=f.toWorld(du,chairV);
            tableItems.push({pos,y:base+1.06,angle:f.angleU,scale:[1,1,1]});
            for(const ou of [-.45,.45])for(const ov of [-.24,.24])tableBaseItems.push({pos:f.toWorld(du+ou,dv+ov),y:base+.64,angle:f.angleU,scale:[1,1,1]});
            chairSeatItems.push({pos:chair,y:base+.62,angle:f.angleU,scale:[1,1,1]});chairBackItems.push({pos:chair,y:base+.96,angle:f.angleU,scale:[1,1,1]});
            for(const ou of [-.24,.24])for(const ov of [-.22,.22])chairLegItems.push({pos:f.toWorld(du+ou,chairV+ov),y:base+.30,angle:f.angleU,scale:[1,1,1]});
          });
        }));
      } else {
        // Floor 3: open project / self-study commons, no classroom partitions.
        for(const cu of [-U+13,0,U-19]){
          localBox(f,scene,[3.4,.12,1.45],cu,0,base+.82,projectDesk,'u');
          for(const side of [-1,1])for(const offset of [-1.15,1.15])localBox(f,scene,[.62,.78,.62],cu+offset,side*1.55,base+.40,loungeSeat,'u');
        }
        for(const side of [-1,1]){
          localBox(f,scene,[6.8,1.95,.42],0,side*(V-1.05),base+1.0,shelfMat,'u');
          for(let k=0;k<5;k++)localBox(f,scene,[.06,1.65,.10],-3.0+k*1.5,side*(V-1.05),base+1.0,academicMaterials.metal,'u');
        }
      }

      // Efficient recessed ceiling lights and corridor lighting.
      for(let j=0;j<6;j++){
        const u=-U+5+j*((2*U-10)/5),pos=f.toWorld(u,0);
        localBox(f,scene,[.72,.07,1.15],u,0,base+2.91,materials.trim,'u');
        const lamp=addMesh(new THREE.PlaneGeometry(.55,.82),new THREE.MeshBasicMaterial({color:0xffe9b6}),scene,pos[0],base+2.86,pos[1]);lamp.rotation.x=Math.PI/2;
      }
    }
    localBox(f,scene,[2*U,.22,2*V],0,0,levelCount*storey+.04,academicMaterials.ceiling,'u');
    // Visible stair flights and handrails connect floor 1 -> 2 -> 3.
    for(let level=0;level<levelCount-1;level++){
      const base=level*storey,steps=12,start=U-10.4,run=6.0,rise=storey/steps;
      for(let i=0;i<steps;i++)localBox(f,scene,[run/steps+.08,rise*.42,2.75],start+i*(run/steps),0,base+(i+1)*rise-rise*.21,academicMaterials.floor,'u');
      const p0=f.toWorld(start-.15,-1.45),p1=f.toWorld(start+run,-1.45),p2=f.toWorld(start-.15,1.45),p3=f.toWorld(start+run,1.45);
      segment(scene,[p0[0],base+.45,p0[1]],[p1[0],base+storey+.15,p1[1]],.045,academicMaterials.metal,7);
      segment(scene,[p2[0],base+.45,p2[1]],[p3[0],base+storey+.15,p3[1]],.045,academicMaterials.metal,7);
    }
    const deskGeo=new THREE.BoxGeometry(1.08,.09,.66),baseGeo=new THREE.BoxGeometry(.065,.68,.065),seatGeo=new THREE.BoxGeometry(.66,.09,.62),backGeo=new THREE.BoxGeometry(.66,.55,.075),chairLegGeo=new THREE.BoxGeometry(.065,.58,.065);
    addInstances(deskGeo,academicMaterials.wood,tableItems);addInstances(baseGeo,academicMaterials.metal,tableBaseItems);
    addInstances(seatGeo,academicMaterials.wood,chairSeatItems);addInstances(backGeo,academicMaterials.wood,chairBackItems);addInstances(chairLegGeo,academicMaterials.metal,chairLegItems);
    const signs=[['KHU A · SẢNH SINH VIÊN',0],['KHU A · PHÒNG HỌC TẦNG 2',1],['KHU A · KHÔNG GIAN TỰ HỌC',2]];
    signs.forEach(([label,level])=>{const sign=addMesh(new THREE.PlaneGeometry(3.9,.72),new THREE.MeshBasicMaterial({map:signTexture(label,'#28564d'),side:THREE.DoubleSide}),scene);const pos=f.toWorld(-U-1.1,0);sign.position.set(pos[0],level*storey+2.65,pos[1]);sign.rotation.y=f.angleV;});
  }
  function buildWorkshop(){
    const b=CAMPUS.buildings[10],f=createLocalFrame(b.poly),U=f.halfU-.4,V=f.halfV-.5;
    flatShape(b.poly.map(world),.03,mat(0xbfc4b8));
    const steel=mat(0x718b83,.58,.34),roof=mat(0x9bb9b1,.76,.08),concrete=mat(0xb7b9b0,.95);
    const pale=mat(0xc7d7d0,.82),darkGlass=new THREE.MeshStandardMaterial({color:0x355b5c,roughness:.28,metalness:.08});
    // Long, low practical workshop with repeated pale-green columns and a saw-tooth roof profile.
    const eave=4.25, ridge=5.15, bays=6;
    for(let i=0;i<=bays;i++){
      const u=-U+i*(2*U/bays);
      [-V,V].forEach(v=>localBox(f,scene,[.20,eave,.20],u,v,eave/2,steel,'u'));
      localBox(f,scene,[.13,.13,2*V],u,0,eave-.12,steel,'u');
    }
    // Long front elevation: repeated dark openings, pale pilasters and a continuous covered walkway.
    localBox(f,scene,[2*U,.22,.26],0,-V,.18,steel,'u');
    localBox(f,scene,[2*U,.18,.26],0,-V,2.65,pale,'u');
    for(let i=0;i<bays;i++){
      const u=-U+(i+.5)*(2*U/bays),w=2*U/bays-.38;
      localBox(f,scene,[w,1.28,.10],u,-V+.04,1.65,darkGlass,'u');
      localBox(f,scene,[w,.12,.18],u,-V+.03,2.34,pale,'u');
      localBox(f,scene,[.12,2.55,.30],-U+i*(2*U/bays),-V-.05,1.42,steel,'u');
    }
    // Continuous canopy / veranda along the main entrance elevation.
    localBox(f,scene,[2*U+.6,.14,1.55],0,-V-0.78,3.08,roof,'u');
    for(let i=0;i<=bays;i++){
      const u=-U+i*(2*U/bays);
      localBox(f,scene,[.10,2.95,.10],u,-V-1.38,1.48,steel,'u');
    }
    // Rear wall is mostly solid with high ventilation louvers.
    localWallU(f,scene,-U,U,V,.18,2.35,.18,materials.wall);
    for(let i=0;i<12;i++){
      const u=-U+.8+i*((2*U-1.6)/11);
      localBox(f,scene,[.78,.09,.16],u,V-.03,2.78,steel,'u');
      localBox(f,scene,[.78,.07,.16],u,V-.03,3.02,pale,'u');
    }
    // Repeating saw-tooth roof strips, with narrow glazed clerestories at every rise.
    for(let i=0;i<6;i++){
      const u0=-U+i*(2*U/6),u1=-U+(i+1)*(2*U/6);
      const a=f.toWorld(u0,-V),b=f.toWorld(u1,-V),c=f.toWorld(u1,V),d=f.toWorld(u0,V);
      const vertices=[a[0],eave,a[1],b[0],ridge,b[1],c[0],ridge,c[1],d[0],eave,d[1]];
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex([0,1,2,0,2,3]);geo.computeVertexNormals();
      addMesh(geo,new THREE.MeshStandardMaterial({color:0x8eaaa1,roughness:.76,side:THREE.DoubleSide}),scene);
      if(i<5){
        localBox(f,scene,[.10,ridge-eave,2*V],u1,0,(ridge+eave)/2,darkGlass,'u');
        localBox(f,scene,[.15,.12,2*V],u1,0,ridge+.05,steel,'u');
      }
    }
    // Long work floor, benches and equipment visible through the openings.
    localBox(f,scene,[2*U-.8,.10,2*V-.8],0,0,.12,concrete,'u');
    for(let i=0;i<5;i++){
      const u=-U+2.2+i*((2*U-4.4)/4),v=(i%2?1:-1)*2.55;
      localBox(f,scene,[2.15,.13,.88],u,v,1.02,academicMaterials.wood,'u');
      for(const dx of [-.88,.88])localBox(f,scene,[.12,.92,.12],u+dx,v,.48,steel,'u');
      localBox(f,scene,[.74,1.05,.68],u+.28,v+.85,.70,mat(i%2?0x697e80:0x858d85),'u');
      localBox(f,scene,[.48,.18,.48],u+.28,v+.85,1.30,mat(0x303b3c),'u');
    }

  }
  CAMPUS.buildings.forEach((b, index) => {
    if (b.kind === 'area' || !b.poly || b.poly.length < 3) return;
    if(index===3){buildAcademicInterior();return;}
    if(index===10){buildWorkshop();return;}
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
        const count = Math.max(1, Math.floor(length / 4.2));
        for (let k = 0; k < count; k++) {
          const t = (k + .5) / count;
          const wx = p[0] + dx * t, wz = p[1] + dz * t;
          const width = Math.min(.92, length / count * .48);
          const win = makeBox(scene, [width, .72, .055], [wx, y, wz], materials.window);
          win.rotation.y = -Math.atan2(dz, dx);
          if(k%2===0){const sill=makeBox(scene,[width+.08,.06,.075],[wx,y-.39,wz],materials.trim);sill.rotation.y=-Math.atan2(dz,dx);}
          // Selected upper-floor windows receive shallow balconies and handrails.
          if ((b.floors || 0) >= 3 && floor > 0 && k % 5 === 2 && length > 6.0) {
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

  const AVATAR_BLUE = '#2864cf';
  function character(color, name, isLocal = false) {
    const root = new THREE.Group();
    // Compact rounded campus avatar based on the user's reference image.
    root.scale.setScalar(.88);
    const shirt = mat(color || AVATAR_BLUE, .72, .01), pants = mat(0x26394b, .88), skin = mat(0xd8a681, .9);
    const hairMat = mat(0x302a27, .92), eyeMat = mat(0x202323, .65);

    // Rounded torso and slightly protruding belly; shorter and broader than the previous model.
    const torso = addMesh(new THREE.CapsuleGeometry(.315, .30, 8, 20), shirt, root, 0, .985, 0);
    torso.scale.set(1.13, .96, 1.0);
    addMesh(new THREE.SphereGeometry(.245, 18, 14), shirt, root, 0, .755, .015).scale.set(1.13, .72, .94);
    addMesh(new THREE.CylinderGeometry(.083, .09, .105, 14), skin, root, 0, 1.335, 0);

    // Larger rounded head, simple dark fringe and visible facial features.
    const head = new THREE.Group(); head.position.set(0, 1.49, 0); root.add(head);
    addMesh(new THREE.SphereGeometry(.285, 28, 20), skin, head, 0, 0, 0).scale.set(1.0, 1.04, .98);
    const cap = addMesh(new THREE.SphereGeometry(.291, 28, 18, 0, Math.PI * 2, 0, Math.PI * .56), hairMat, head, 0, .065, .012);
    cap.scale.set(1.04, .92, 1.06);
    addMesh(new THREE.SphereGeometry(.13, 16, 10, 0, Math.PI, 0, Math.PI * .48), hairMat, head, 0, .027, -.174).scale.set(1.3, .60, .52);
    [-.078, .078].forEach(x => {
      addMesh(new THREE.SphereGeometry(.016, 10, 8), eyeMat, head, x, -.018, -.232);
      addMesh(new THREE.BoxGeometry(.052, .012, .012), hairMat, head, x, .031, -.219);
    });
    addMesh(new THREE.SphereGeometry(.022, 10, 8), skin, head, 0, -.075, -.232);
    [-1, 1].forEach(side => addMesh(new THREE.SphereGeometry(.047, 12, 9), skin, head, side * .239, -.005, 0));

    const buildArms = (parent, holding) => {
      const pivots = [], elbows = [];
      [-1, 1].forEach(side => {
        const pivot = new THREE.Group(); pivot.position.set(side * .325, 1.19, 0); parent.add(pivot);
        addMesh(new THREE.SphereGeometry(.108, 14, 11), shirt, pivot, 0, -.025, 0);
        const upperEnd = holding ? [-side * .135, -.13, -.16] : [side * .025, -.205, .012];
        segment(pivot, [0, -.015, 0], upperEnd, .087, shirt, 12);
        const elbow = new THREE.Group(); elbow.position.set(...upperEnd); pivot.add(elbow);
        addMesh(new THREE.SphereGeometry(.071, 12, 10), shirt, elbow, 0, 0, 0);
        const foreEnd = holding ? [-side * .065, -.065, -.205] : [side * .012, -.205, .006];
        segment(elbow, [0, 0, 0], foreEnd, .075, shirt, 11);
        addMesh(new THREE.SphereGeometry(.073, 14, 11), skin, elbow, ...foreEnd);
        addMesh(new THREE.CapsuleGeometry(.022, .045, 3, 7), skin, elbow,
          foreEnd[0] + side * .034, foreEnd[1] + .015, foreEnd[2] - .016).rotation.z = side * .25;
        pivots.push(pivot); elbows.push(elbow);
      });
      return { pivots, elbows };
    };
    const armsHold = new THREE.Group(); root.add(armsHold); const hold = buildArms(armsHold, true);
    const armsIdle = new THREE.Group(); root.add(armsIdle); const idle = buildArms(armsIdle, false);
    armsHold.visible = false; armsIdle.visible = true;

    // Shorter legs, rounded knees and simple dark trainers.
    const legs = [], knees = [];
    [-1, 1].forEach(side => {
      const hip = new THREE.Group(); hip.position.set(side * .135, .635, 0); root.add(hip);
      addMesh(new THREE.SphereGeometry(.105, 12, 9), pants, hip, 0, 0, 0);
      segment(hip, [0, 0, 0], [0, -.235, 0], .098, pants, 12);
      const knee = new THREE.Group(); knee.position.set(0, -.235, 0); hip.add(knee);
      addMesh(new THREE.SphereGeometry(.081, 12, 9), pants, knee, 0, 0, 0);
      segment(knee, [0, 0, 0], [0, -.225, -.012], .079, pants, 11);
      makeBox(knee, [.205, .125, .305], [0, -.238, -.065], materials.shoe);
      legs.push(hip); knees.push(knee);
    });

    // A flat translucent contact shadow replaces costly real-time shadow mapping.
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(.43, 20),
      new THREE.MeshBasicMaterial({ color: 0x17231d, transparent: true, opacity: .19, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .018; shadow.renderOrder = 1; root.add(shadow);

    const gunHolder = new THREE.Group(); gunHolder.position.set(.015, 1.13, -.47); root.add(gunHolder);
    const label = makeNameSprite(name, '#ffffff'); label.position.set(0, 2.04, 0); label.visible = !isLocal; root.add(label);
    root.userData = { legs, knees, gunHolder, label, shirt, name, isLocal, shirtMesh: torso,
      armsHold, armsIdle, idleArms: idle.pivots, holdArms: hold.pivots,
      idleElbows: idle.elbows, holdElbows: hold.elbows, head, shadow };
    return root;
  }
  const local = character('#2864cf', 'Bạn', true); scene.add(local);
  const remote = new Map();
  let firstPersonGun = null, firstPersonWeapon = '';
  function setHeldGun(root, key) {
    const holder = root.userData.gunHolder;
    if(root.userData.armsHold)root.userData.armsHold.visible=!!key;
    if(root.userData.armsIdle)root.userData.armsIdle.visible=!key;
    while (holder.children.length) {
      const child = holder.children[0]; holder.remove(child);
      child.traverse?.(o => { if (o.geometry && !o.geometry.userData?.uteShared) o.geometry.dispose(); });
    }
    if (!key) return;
    const gun = weaponModel(key); holder.add(gun);
  }
  let firstPersonHandsMode = '';
  function setFirstPersonGun(key, active) {
    const mode = (active ? 'active:' : 'hidden:') + (key || 'empty');
    if (firstPersonGun && firstPersonHandsMode === mode) return;
    if (firstPersonGun) { camera.remove(firstPersonGun); firstPersonGun.traverse(o => { if (o.geometry) if(!o.geometry.userData?.uteShared)o.geometry.dispose(); }); }
    firstPersonGun = null; firstPersonWeapon = key || ''; firstPersonHandsMode = mode;
    if (!active) return;
    firstPersonGun = new THREE.Group();
    const sleeve = mat(AVATAR_BLUE);
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
  // A real soccer-ball panel layout: 12 black pentagons + 20 white hexagons.
  // The smooth white sphere beneath the panels keeps the overall silhouette round.
  const BALL_RADIUS=.18;
  ballMesh=new THREE.Group();
  const ballCore=addMesh(new THREE.SphereGeometry(BALL_RADIUS,40,28),new THREE.MeshStandardMaterial({color:0xf3f2ea,roughness:.72,metalness:0}),ballMesh,0,0,0);
  const phi=(1+Math.sqrt(5))/2;
  const ico=[[-1,phi,0],[1,phi,0],[-1,-phi,0],[1,-phi,0],[0,-1,phi],[0,1,phi],[0,-1,-phi],[0,1,-phi],[phi,0,-1],[phi,0,1],[-phi,0,-1],[-phi,0,1]].map(v=>new THREE.Vector3(...v).normalize());
  const icoFaces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const neighborSets=ico.map(()=>new Set());
  icoFaces.forEach(face=>face.forEach((v,i)=>{neighborSets[v].add(face[(i+1)%3]);neighborSets[v].add(face[(i+2)%3]);}));
  const truncated=(i,j)=>ico[i].clone().multiplyScalar(2).add(ico[j]).normalize().multiplyScalar(BALL_RADIUS*1.018);
  const orientPoly=(points)=>{const c=points.reduce((a,p)=>a.add(p),new THREE.Vector3()).multiplyScalar(1/points.length),n=c.clone().normalize();let t=n.clone().cross(new THREE.Vector3(0,1,0));if(t.lengthSq()<.001)t=n.clone().cross(new THREE.Vector3(1,0,0));t.normalize();const b=n.clone().cross(t).normalize();return points.slice().sort((p,q)=>Math.atan2(p.clone().sub(c).dot(b),p.clone().sub(c).dot(t))-Math.atan2(q.clone().sub(c).dot(b),q.clone().sub(c).dot(t)));};
  const pentagons=ico.map((v,i)=>{let t=v.clone().cross(new THREE.Vector3(0,1,0));if(t.lengthSq()<.001)t=v.clone().cross(new THREE.Vector3(1,0,0));t.normalize();const b=v.clone().cross(t).normalize();const ns=[...neighborSets[i]];ns.sort((a,c)=>{const pa=truncated(i,a).sub(v),pc=truncated(i,c).sub(v);return Math.atan2(pa.dot(b),pa.dot(t))-Math.atan2(pc.dot(b),pc.dot(t));});return ns.map(j=>truncated(i,j));});
  const hexagons=icoFaces.map(([i,j,k])=>[truncated(i,j),truncated(j,i),truncated(j,k),truncated(k,j),truncated(k,i),truncated(i,k)]);
  const blackPositions=[],edgePositions=[],edgeSet=new Set();
  const addFaceTriangles=poly=>{const ordered=orientPoly(poly),center=ordered.reduce((a,p)=>a.add(p),new THREE.Vector3()).multiplyScalar(1/ordered.length).normalize().multiplyScalar(BALL_RADIUS*1.021);for(let i=0;i<ordered.length;i++){const a=ordered[i],b=ordered[(i+1)%ordered.length];blackPositions.push(...center.toArray(),...a.toArray(),...b.toArray());}};
  const edgeKey=v=>v.toArray().map(n=>n.toFixed(5)).join(',');
  [...pentagons,...hexagons].forEach(poly=>{for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ka=edgeKey(a),kb=edgeKey(b),key=ka<kb?ka+'|'+kb:kb+'|'+ka;if(!edgeSet.has(key)){edgeSet.add(key);edgePositions.push(...a.toArray(),...b.toArray());}}});
  pentagons.forEach(addFaceTriangles);
  const panelGeometry=new THREE.BufferGeometry();panelGeometry.setAttribute('position',new THREE.Float32BufferAttribute(blackPositions,3));panelGeometry.computeVertexNormals();
  const blackPanels=addMesh(panelGeometry,new THREE.MeshStandardMaterial({color:0x171d20,roughness:.74,side:THREE.DoubleSide,flatShading:true}),ballMesh);
  const seamGeometry=new THREE.BufferGeometry();seamGeometry.setAttribute('position',new THREE.Float32BufferAttribute(edgePositions,3));
  const seams=new THREE.LineSegments(seamGeometry,new THREE.LineBasicMaterial({color:0x646a68,transparent:true,opacity:.88}));ballMesh.add(seams);scene.add(ballMesh);
    const ballGroundShadow=addMesh(new THREE.CircleGeometry(.19,24),new THREE.MeshBasicMaterial({color:0x182018,transparent:true,opacity:.20,depthWrite:false}),scene,0,.008,0);ballGroundShadow.rotation.x=-Math.PI/2;

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
    renderer.setPixelRatio(renderDpr); renderer.setSize(w, h, false);
  }
  addEventListener('resize', resize);

  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  let lastRender = 0, camReady = false, qualityStart = performance.now(), qualityFrames = 0;
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
    const phase = now / (running ? 190 : 305);
    const walkBob = moving ? Math.abs(Math.sin(phase * 2)) * .026 : 0;
    local.position.set(p.x, (p.y||0) + jumpY + walkBob, p.z); local.rotation.y = yaw;
    local.visible = !isFirst;
    const newColor = AVATAR_BLUE;
    if (localColor !== newColor) { localColor = newColor; local.userData.shirtMesh.material.color.set(newColor); }
    const stride = moving ? Math.sin(phase) : 0;
    local.userData.legs.forEach((leg,i)=>{const swing=moving?Math.sin(phase+i*Math.PI)*(running?.54:.39):0;leg.rotation.x=THREE.MathUtils.damp(leg.rotation.x,swing,9,dt);const knee=local.userData.knees?.[i];if(knee)knee.rotation.x=THREE.MathUtils.damp(knee.rotation.x,moving?Math.max(0,-swing)*.82:0,10,dt);});
    if(local.userData.holdArms)local.userData.holdArms.forEach((arm,i)=>{arm.rotation.x=THREE.MathUtils.damp(arm.rotation.x,moving?(i===0?.035:-.035):0,7,dt);});
    if(local.userData.holdElbows)local.userData.holdElbows.forEach(el=>{el.rotation.x=THREE.MathUtils.damp(el.rotation.x,0,8,dt);});
    if(local.userData.idleArms)local.userData.idleArms.forEach((arm,i)=>{const armSwing=i===0?-stride*.92:stride*.92;arm.rotation.x=THREE.MathUtils.damp(arm.rotation.x,moving?armSwing:0,9,dt);arm.rotation.z=THREE.MathUtils.damp(arm.rotation.z,moving?(i===0?-.065:.065):0,8,dt);});
    if(local.userData.idleElbows)local.userData.idleElbows.forEach((el,i)=>{el.rotation.x=THREE.MathUtils.damp(el.rotation.x,moving?Math.max(0,(i===0?stride:-stride))*.42:0,9,dt);});
    local.userData.shirtMesh.position.y=THREE.MathUtils.damp(local.userData.shirtMesh.position.y,1.02+(moving?Math.abs(stride)*.025:0),9,dt);
    if(local.userData.head)local.userData.head.rotation.z=THREE.MathUtils.damp(local.userData.head.rotation.z,moving?Math.sin(now/300)*.025:0,6,dt);
    local.rotation.z=THREE.MathUtils.damp(local.rotation.z,moving?Math.sin(phase)*.026:0,8,dt);
    local.rotation.x=THREE.MathUtils.damp(local.rotation.x,moving?Math.abs(stride)*.012:0,8,dt);
    if(local.userData.shadow){local.userData.shadow.scale.setScalar(1+jumpY*.28);local.userData.shadow.material.opacity=.19*(1-Math.min(.72,jumpY*.62));}
    if (localHeldWeapon !== weapon) { setHeldGun(local, weapon); localHeldWeapon = weapon; }
    const kickback = local.userData.recoilUntil > now ? Math.sin((local.userData.recoilUntil - now) / 90 * Math.PI) * .10 : 0;
    local.userData.gunHolder.position.z = -.55 + kickback; local.userData.gunHolder.rotation.x = -kickback * 1.4;
    setFirstPersonGun(isFirst ? weapon : '', isFirst);
    if (firstPersonGun) { const fpKick = firstPersonGun.userData.recoilUntil > now ? .12 : 0; firstPersonGun.position.z = -.62 + fpKick; }

    // Smoothly follow the local player, with a proper first-person aim direction.
    const pitch = clamp(state.pitch || 0, -.16, .45);
    if (isFirst) {
      camera.position.set(p.x, (p.y||0) + 1.42, p.z);
      const dir = v3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      camera.lookAt(camera.position.clone().add(dir.multiplyScalar(18)));
    } else {
      const shoulderX=Math.cos(yaw)*.88,shoulderZ=-Math.sin(yaw)*.88;
      const follow=v3(p.x+Math.sin(yaw)*4.8+shoulderX,(p.y||0)+2.35+pitch*1.25+jumpY,p.z+Math.cos(yaw)*4.8+shoulderZ);
      const target=v3(p.x-Math.sin(yaw)*8.0,(p.y||0)+1.10+jumpY,p.z-Math.cos(yaw)*8.0);
      if (!camReady) { camera.position.copy(follow); camReady = true; }
      camera.position.lerp(follow, 1 - Math.exp(-7 * dt));
      camera.lookAt(target);
    }

    // Other players are real independent avatars, interpolated by Supabase Realtime.
    const mePos=api.position();
    const peers = api.peerList ? api.peerList().filter(v=>v.id!=='ute-campus-bot').sort((a,b)=>Math.hypot(a.x-mePos.x,a.z-mePos.z)-Math.hypot(b.x-mePos.x,b.z-mePos.z)).slice(0,10) : [];
    const botPeer = window.campusGame?.botPlayer?.(); if(botPeer)peers.push(botPeer);
    const liveIds = new Set();
    peers.forEach(peer => {
      if (!peer || !peer.id) return;
      liveIds.add(peer.id);
      let entry = remote.get(peer.id);
      if (!entry) { const group = character(peer.color, peer.name, false); scene.add(group); entry = { group, weapon: '' }; remote.set(peer.id, entry); }
      const g = entry.group;
      g.position.set(peer.x, peer.y||0, peer.z); g.rotation.y = peer.yaw || 0;
      g.visible = true; g.userData.label.material.opacity = 1;
      const color = peer.color || '#2864cf';
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
      const walkPhase=peer.moving?Math.sin(now/305)*.39:0;
      g.userData.legs.forEach((leg,i)=>{const swing=walkPhase*(i?-1:1);leg.rotation.x=THREE.MathUtils.damp(leg.rotation.x,swing,8,dt);const knee=g.userData.knees?.[i];if(knee)knee.rotation.x=THREE.MathUtils.damp(knee.rotation.x,peer.moving?Math.max(0,-swing)*.65:0,9,dt);});
      if(g.userData.idleArms)g.userData.idleArms.forEach((arm,i)=>{arm.rotation.x=THREE.MathUtils.damp(arm.rotation.x,peer.moving?(i===0?-walkPhase*.92:walkPhase*.92):0,9,dt);});
      if(g.userData.idleElbows)g.userData.idleElbows.forEach((el,i)=>{el.rotation.x=THREE.MathUtils.damp(el.rotation.x,peer.moving?Math.max(0,i===0?walkPhase:-walkPhase)*.42:0,9,dt);});
      if(g.userData.shadow)g.userData.shadow.material.opacity=.19;
      if(g.userData.holdArms)g.userData.holdArms.forEach(arm=>{arm.rotation.x=THREE.MathUtils.damp(arm.rotation.x,peer.moving?walkPhase*.05:0,8,dt);});
    });
    for (const [id, entry] of remote) if (!liveIds.has(id)) { scene.remove(entry.group); remote.delete(id); }

    // Pickup availability, bobbing and the shared ball position.
    const game = window.campusGame && campusGame.renderState ? campusGame.renderState() : null;
    if (game) {
      pickupRoots.forEach((item, i) => {
        const available = !game.taken[i]; item.root.visible = !!available;
        if (available) { item.root.position.y = .20 + Math.sin(now / 420 + i) * .07; item.root.rotation.y = Math.sin(now / 1200 + i) * .4; }
      });
      if (game.ball) { ballMesh.visible = game.ball.visible; ballMesh.position.set(game.ball.x, BALL_RADIUS + Math.min(.045, game.ball.speed * .004), game.ball.z); ballMesh.rotation.x += dt * game.ball.speed * .7; ballMesh.rotation.z += dt * game.ball.speed * .4;ballGroundShadow.visible=game.ball.visible;ballGroundShadow.position.set(game.ball.x,.009,game.ball.z); }
    }
    for (let i = tracers.length - 1; i >= 0; i--) {
      if (now >= tracers[i].expires) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); tracers[i].line.material.dispose(); tracers.splice(i, 1); }
    }
    if (now > shotFlashUntil) {
      [local, ...Array.from(remote.values(), v => v.group)].forEach(g => { const w = g.userData.gunHolder.children[0]; if (w?.userData.flash) w.userData.flash.visible = false; });
      if (firstPersonGun?.children[0]?.userData.flash) firstPersonGun.children[0].userData.flash.visible = false;
    }
    renderer.render(scene, camera);
    // Dynamic resolution lowers GPU load on laptops/phones if frame rate drops.
    qualityFrames++;
    if (now - qualityStart >= 2400) {
      const fps = qualityFrames * 1000 / Math.max(1, now - qualityStart);
      const nextDpr = fps < 39 ? Math.max(.75, renderDpr - .15) :
        fps > 56 ? Math.min(maxRenderDpr, renderDpr + .05) : renderDpr;
      if (Math.abs(nextDpr - renderDpr) > .01) { renderDpr = nextDpr; resize(); }
      qualityStart = now; qualityFrames = 0;
    }
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
  // Render only while the 3D walk view is visible. This avoids an idle GPU loop in map mode/background tabs.
  let renderRaf = 0;
  function animate() {
    renderRaf = 0;
    if (document.hidden || !document.body.classList.contains('walking')) return;
    render();
    renderRaf = requestAnimationFrame(animate);
  }
  function wakeRender() {
    if (!renderRaf && !document.hidden && document.body.classList.contains('walking'))
      renderRaf = requestAnimationFrame(animate);
  }
  const modeObserver = new MutationObserver(wakeRender);
  modeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && renderRaf) { cancelAnimationFrame(renderRaf); renderRaf = 0; }
    else wakeRender();
  });
  wakeRender();
})();
