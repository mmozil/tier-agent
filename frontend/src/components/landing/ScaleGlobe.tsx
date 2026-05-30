import { useEffect, useRef } from "react";
import * as THREE from "three";

/* ─────────────────────────────────────────────────────────────
   ScaleGlobe — globo de inferência estilo baseten "Scale fast",
   remodelado pro Tier Agent: nós = CANAIS convergindo num nó
   central AGENTE. Three.js puro (sem fiber), cena imperativa,
   lazy-loaded. Dome de pontos + cubos isométricos + linhas
   dashflow + pulsos magenta + labels mono projetados.
   Acentos: verde #00D17E (canais) · azul sky #38BDF8 (pulsos)
   · azul Tier #003083 (nó central).
   ──────────────────────────────────────────────────────────── */

type NodeDef = {
  id: string;
  label: string;
  az: number; // azimute (graus)
  el: number; // elevação (graus)
  central?: boolean;
};

const R = 2.7; // raio do dome
const GREEN = 0x00d17e;
const PULSE = 0x38bdf8; // azul sky on-brand (substitui o magenta off-brand)
const TIER = 0x1f4fd0; // azul Tier um tom mais vivo p/ WebGL
const GRID = 0xc4ccd6;

const NODES: NodeDef[] = [
  { id: "central", label: "AGENTE", az: 0, el: 50, central: true },
  { id: "telegram", label: "TELEGRAM", az: -46, el: 24 },
  { id: "instagram", label: "INSTAGRAM", az: 46, el: 24 },
  { id: "whatsapp", label: "WHATSAPP", az: -102, el: 7 },
  { id: "email", label: "EMAIL", az: 102, el: 7 },
];

// converte (azimute, elevação, raio) → posição cartesiana na superfície do dome
function onDome(azDeg: number, elDeg: number, r = R): THREE.Vector3 {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return new THREE.Vector3(
    r * Math.cos(el) * Math.sin(az),
    r * Math.sin(el),
    r * Math.cos(el) * Math.cos(az),
  );
}

export default function ScaleGlobe() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // refs dos labels (na ordem de NODES)
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 1.15, 7.4);
    camera.lookAt(0, 0.5, 0);

    // luzes (dão o sombreamento das 3 faces dos cubos isométricos)
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 6, 4);
    scene.add(dir);

    const root = new THREE.Group();
    scene.add(root);

    // ── Dome de pontos (hemisfério superior) ───────────────
    const ptsCount = 1500;
    const positions = new Float32Array(ptsCount * 3);
    const alphas = new Float32Array(ptsCount);
    let pi = 0;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < ptsCount * 2 && pi < ptsCount; i++) {
      const y = 1 - (i / (ptsCount * 2 - 1)) * 2; // 1 → -1
      if (y < -0.04) continue; // só hemisfério superior
      const radius = Math.sqrt(1 - y * y);
      const theta = golden * i;
      positions[pi * 3] = Math.cos(theta) * radius * R;
      positions[pi * 3 + 1] = y * R;
      positions[pi * 3 + 2] = Math.sin(theta) * radius * R;
      alphas[pi] = 0.25 + Math.random() * 0.6;
      pi++;
    }
    const domeGeo = new THREE.BufferGeometry();
    domeGeo.setAttribute("position", new THREE.BufferAttribute(positions.slice(0, pi * 3), 3));
    domeGeo.setAttribute("alpha", new THREE.BufferAttribute(alphas.slice(0, pi), 1));
    const domeMat = new THREE.PointsMaterial({ color: GRID, size: 0.032, sizeAttenuation: true, transparent: true, opacity: 0.7 });
    const dome = new THREE.Points(domeGeo, domeMat);
    root.add(dome);

    // arco do horizonte (silhueta do dome)
    const horizonPts: THREE.Vector3[] = [];
    for (let a = 0; a <= 180; a += 2) horizonPts.push(onDome(a * 2 - 180 + 90, 0, R));
    const horizonGeo = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 121 }, (_, k) => {
        const a = (k / 120) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
      }),
    );
    const horizon = new THREE.LineLoop(horizonGeo, new THREE.LineBasicMaterial({ color: GRID, transparent: true, opacity: 0.5 }));
    root.add(horizon);
    void horizonPts;

    // ── Nós (cubos isométricos) ────────────────────────────
    const nodePositions: THREE.Vector3[] = NODES.map((n) => onDome(n.az, n.el));
    NODES.forEach((n, idx) => {
      const p = nodePositions[idx];
      const s = n.central ? 0.34 : 0.26;
      const color = n.central ? TIER : GREEN;
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(s, s, s),
        new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 }),
      );
      cube.position.copy(p);
      cube.rotation.y = Math.PI / 4; // vira a quina pra frente (look isométrico)
      // contorno
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(cube.geometry),
        new THREE.LineBasicMaterial({ color: n.central ? 0x0a2f8c : 0x0a8f5a, transparent: true, opacity: 0.8 }),
      );
      cube.add(edges);
      root.add(cube);
    });

    // ── Conexões canal → central + pulsos ──────────────────
    const center = nodePositions[0];
    type Conn = { curve: THREE.QuadraticBezierCurve3; line: THREE.Line; pulses: THREE.Sprite[]; offsets: number[] };
    const conns: Conn[] = [];
    const pulseTex = makePulseTexture();

    for (let i = 1; i < NODES.length; i++) {
      const from = nodePositions[i];
      // ponto de controle: empurra a curva pra fora do dome (arco)
      const mid = from.clone().add(center).multiplyScalar(0.5);
      mid.multiplyScalar(1.18 + i * 0.02);
      const curve = new THREE.QuadraticBezierCurve3(from.clone(), mid, center.clone());
      const segs = 60;
      const cpts = curve.getPoints(segs);
      const geo = new THREE.BufferGeometry().setFromPoints(cpts);
      // metade das linhas tracejadas (dashflow), metade sólidas
      const dashed = i % 2 === 0;
      let line: THREE.Line;
      if (dashed) {
        line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: GREEN, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.85 }));
        line.computeLineDistances();
      } else {
        line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.7 }));
      }
      root.add(line);

      // 1-2 pulsos por conexão
      const nPulses = dashed ? 1 : 2;
      const pulses: THREE.Sprite[] = [];
      const offsets: number[] = [];
      for (let k = 0; k < nPulses; k++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pulseTex, color: PULSE, transparent: true, depthWrite: false }));
        sp.scale.setScalar(0.2);
        const off = (i * 0.27 + k * 0.5) % 1;
        sp.position.copy(curve.getPoint(off)); // posiciona já na curva (evita dot parado na origem)
        root.add(sp);
        pulses.push(sp);
        offsets.push(off);
      }
      conns.push({ curve, line, pulses, offsets });
    }

    // ── Resize ─────────────────────────────────────────────
    function resize() {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── Parallax de mouse ──────────────────────────────────
    let targetRotX = 0;
    let targetRotY = 0;
    function onMove(e: MouseEvent) {
      const r = wrap.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      targetRotY = nx * 0.5;
      targetRotX = ny * 0.18;
    }
    window.addEventListener("mousemove", onMove);

    // ── Projeção de labels ─────────────────────────────────
    const v = new THREE.Vector3();
    function updateLabels() {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      NODES.forEach((_, idx) => {
        const el = labelRefs.current[idx];
        if (!el) return;
        v.copy(nodePositions[idx]).applyMatrix4(root.matrixWorld).project(camera);
        const x = (v.x * 0.5 + 0.5) * w;
        const y = (-v.y * 0.5 + 0.5) * h;
        el.style.transform = `translate(-50%,-50%) translate(${x}px, ${y - 26}px)`;
        el.style.opacity = v.z < 1 ? "1" : "0";
      });
    }

    // ── Loop ───────────────────────────────────────────────
    let raf = 0;
    let t = 0;
    let running = true;
    const clock = new THREE.Clock();

    function frame() {
      if (!running) return;
      const dt = clock.getDelta();
      t += dt;
      // drift idle + easing do parallax
      root.rotation.y += (targetRotY + Math.sin(t * 0.12) * 0.08 - root.rotation.y) * 0.05;
      root.rotation.x += (targetRotX - root.rotation.x) * 0.05;
      root.updateMatrixWorld();

      // breathing dos pontos
      domeMat.opacity = 0.55 + Math.sin(t * 1.2) * 0.12;

      // pulsos viajando (o cue de "fluxo" — linhas tracejadas ficam estáticas)
      conns.forEach((c) => {
        c.pulses.forEach((sp, k) => {
          c.offsets[k] = (c.offsets[k] + dt * 0.22) % 1;
          c.curve.getPoint(c.offsets[k], v);
          v.applyMatrix4(root.matrixWorld);
          // desfaz a rotação do root pra sprite ficar no espaço certo
          sp.position.copy(c.curve.getPoint(c.offsets[k]));
          const fade = Math.sin(c.offsets[k] * Math.PI); // some nas pontas
          (sp.material as THREE.SpriteMaterial).opacity = 0.25 + fade * 0.75;
        });
      });

      renderer.render(scene, camera);
      updateLabels();
      raf = requestAnimationFrame(frame);
    }

    if (reduced) {
      root.updateMatrixWorld();
      renderer.render(scene, camera);
      updateLabels();
    } else {
      // pausa quando fora da viewport (perf)
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !raf) {
            running = true;
            clock.getDelta();
            raf = requestAnimationFrame(frame);
          } else if (!entry.isIntersecting) {
            running = false;
            cancelAnimationFrame(raf);
            raf = 0;
          }
        },
        { threshold: 0.05 },
      );
      io.observe(wrap);
      // guarda p/ cleanup
      (wrap as unknown as { _io?: IntersectionObserver })._io = io;
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("mousemove", onMove);
      (wrap as unknown as { _io?: IntersectionObserver })._io?.disconnect();
      pulseTex.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block w-full h-full" />
      {/* labels mono projetados */}
      {NODES.map((n, i) => (
        <div
          key={n.id}
          ref={(el) => (labelRefs.current[i] = el)}
          className={`pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide transition-opacity ${
            n.central
              ? "border-accent/30 bg-white text-accent"
              : "border-flow-okfg/30 bg-white text-flow-okfg"
          }`}
          style={{ willChange: "transform" }}
        >
          {n.label}
        </div>
      ))}
    </div>
  );
}

// textura radial p/ os pulsos (quadradinho com glow suave)
function makePulseTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // núcleo quadrado nítido
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillRect(size / 2 - 6, size / 2 - 6, 12, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
