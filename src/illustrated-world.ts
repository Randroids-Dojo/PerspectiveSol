import type { Event, Game } from "./core";
import { hazardAt, platformAt, type Level, type Platform } from "./levels";

// Every mark in this scene is authored in Canvas 2D. No meshes, cameras,
// WebGL textures, screenshots, or projected 3D artwork enter this renderer.
const TAU = Math.PI * 2;
const INK = "#173e48";
const GOLD = "#caa566";
const IVORY = "#f4edcf";
const random = (n: number) => {
  const v = Math.sin(n * 127.1 + 91.7) * 43758.5453;
  return v - Math.floor(v);
};
function tint(a: string, b: string, t: number) {
  const rgb = (v: string) =>
    [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  const x = rgb(a),
    y = rgb(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}
function ellipse(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string | CanvasGradient,
  rotation = 0,
) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rotation, 0, TAU);
  c.fillStyle = fill;
  c.fill();
}
function line(
  c: CanvasRenderingContext2D,
  points: number[],
  color: string,
  width: number,
) {
  c.beginPath();
  c.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}
function circle(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  width: number,
) {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}
function star(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  c.beginPath();
  c.moveTo(x, y - r);
  c.quadraticCurveTo(x + r * 0.13, y - r * 0.13, x + r, y);
  c.quadraticCurveTo(x + r * 0.13, y + r * 0.13, x, y + r);
  c.quadraticCurveTo(x - r * 0.13, y + r * 0.13, x - r, y);
  c.quadraticCurveTo(x - r * 0.13, y - r * 0.13, x, y - r);
  c.fillStyle = color;
  c.fill();
}
function leaf(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  color: string,
) {
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  c.beginPath();
  c.moveTo(0, 0);
  c.bezierCurveTo(-size * 0.6, -size * 0.3, -size * 0.4, -size, 0, -size);
  c.bezierCurveTo(size * 0.5, -size * 0.7, size * 0.5, -size * 0.2, 0, 0);
  c.fillStyle = color;
  c.fill();
  line(c, [0, -0.06, 0, -size * 0.8], "rgba(244,237,207,.25)", 0.009);
  c.restore();
}
type Island = {
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
  w: number;
  h: number;
};
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  kind: "dust" | "light";
};
export type FlatCamera = { x: number; y: number; viewHeight: number };

export class IllustratedWorld {
  readonly context: CanvasRenderingContext2D;
  private islands = new Map<string, Island>();
  private level: Level | null = null;
  private grain: CanvasPattern;
  private particles: Particle[] = [];
  private time = 0;
  private beacon = false;
  private rendered = 0;
  private visible = false;
  private camera: FlatCamera = { x: 1, y: 1.5, viewHeight: 13.6 };
  private scale = 1;
  width = innerWidth;
  height = innerHeight;
  reduced = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("The illustrated world requires Canvas 2D.");
    this.context = context;
    const paper = document.createElement("canvas");
    paper.width = paper.height = 128;
    const pc = paper.getContext("2d")!;
    const image = pc.createImageData(128, 128);
    for (let i = 0; i < image.data.length; i += 4) {
      const value = Math.floor(random(i) * 255);
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
      image.data[i + 3] = 17;
    }
    pc.putImageData(image, 0, 0);
    this.grain = context.createPattern(paper, "repeat")!;
    this.resize();
  }
  resize() {
    this.width = innerWidth;
    this.height = innerHeight;
    const ratio = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  load(level: Level) {
    this.level = level;
    this.islands.clear();
    this.particles = [];
    this.beacon = false;
    level.platforms.forEach((p, i) =>
      this.islands.set(p.id, this.paintIsland(p, i, level)),
    );
  }
  private paintIsland(p: Platform, index: number, level: Level): Island {
    const unit = 96,
      left = -p.w / 2 - 0.65,
      top = -4.5;
    const w = p.w + 1.3,
      h = 9.3;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * unit);
    canvas.height = Math.ceil(h * unit);
    const c = canvas.getContext("2d")!;
    c.scale(unit, unit);
    c.translate(-left, -top);
    const half = p.w / 2;
    const ink = tint(level.leaf, INK, 0.68);
    c.lineCap = "round";
    c.lineJoin = "round";

    // Roots and hanging ferns give the floating stone a drawn silhouette.
    for (let i = 0; i < 6; i++) {
      const x = (random(index * 71 + i) - 0.5) * p.w * 0.8;
      const length = 2 + random(index * 23 + i) * 2;
      c.beginPath();
      c.moveTo(x, 0.55);
      c.bezierCurveTo(x + 0.2, 1.2, x - 0.5, length - 0.4, x - 0.22, length);
      c.strokeStyle = ink;
      c.lineWidth = 0.035;
      c.stroke();
      for (let j = 0; j < 5; j++)
        leaf(
          c,
          x - 0.1 + Math.sin(j) * 0.15,
          1.05 + j * 0.34,
          0.24,
          j % 2 ? 1.1 : -1.1,
          tint(level.leaf, ink, j * 0.07),
        );
    }
    const rock = c.createLinearGradient(0, 0.6, 0, 4.5);
    rock.addColorStop(0, tint(level.leaf, INK, 0.5));
    rock.addColorStop(1, tint(level.sky, INK, 0.66));
    c.beginPath();
    c.moveTo(-half + 0.18, 0.65);
    const points = Math.max(5, Math.round(p.w));
    for (let j = 0; j <= points; j++) {
      const x = -half + (j * p.w) / points;
      const depth =
        1.15 + (1 - Math.abs(x / half)) * (1.1 + random(index * 11 + j) * 2.1);
      c.lineTo(x, depth);
    }
    c.lineTo(half - 0.15, 0.55);
    c.closePath();
    c.fillStyle = rock;
    c.fill();
    c.save();
    c.clip();
    for (let j = 0; j < 16; j++) {
      const x = (random(index * 46 + j) - 0.5) * p.w;
      line(
        c,
        [x, 0.7, x - 0.5, 2, x - 0.25, 4.5],
        j % 2 ? "rgba(224,222,183,.1)" : "rgba(13,44,54,.18)",
        0.02 + random(j) * 0.1,
      );
    }
    c.restore();

    const stone = c.createLinearGradient(0, 0.03, 0, 0.92);
    stone.addColorStop(0, IVORY);
    stone.addColorStop(0.48, level.stone);
    stone.addColorStop(1, tint(level.stone, GOLD, 0.34));
    c.fillStyle = stone;
    c.fillRect(-half, 0, p.w, 0.88);
    c.strokeStyle = tint(level.leaf, INK, 0.75);
    c.lineWidth = 0.025;
    c.strokeRect(-half, 0.035, p.w, 0.82);
    c.fillStyle = GOLD;
    c.fillRect(-half - 0.07, 0.03, p.w + 0.14, 0.07);
    c.fillStyle = IVORY;
    c.fillRect(-half - 0.08, -0.015, p.w + 0.16, 0.045);
    line(c, [-half + 0.14, 0.72, half - 0.14, 0.72], GOLD, 0.025);
    line(
      c,
      [-half + 0.18, 0.79, half - 0.18, 0.79],
      "rgba(253,245,209,.8)",
      0.025,
    );
    // Individually laid stones, not a texture from the sculpted scene.
    for (let j = 0; j < Math.ceil(p.w); j++) {
      const x = -half + j * 1.1;
      line(c, [x, 0.13, x + 0.06, 0.43, x, 0.71], "rgba(67,87,78,.22)", 0.013);
      line(
        c,
        [x + 0.06, 0.43, Math.min(x + 1.1, half), 0.43],
        "rgba(67,87,78,.17)",
        0.009,
      );
    }
    for (let j = -1; j <= 1; j++) {
      const x = j * Math.max(1, p.w / 3);
      if (Math.abs(x) > half - 0.3) continue;
      circle(c, x, 0.43, 0.2, GOLD, 0.025);
      star(c, x, 0.43, 0.14, tint(level.leaf, INK, 0.4));
      circle(c, x, 0.43, 0.08, IVORY, 0.014);
    }
    for (let j = 0; j < 25; j++) {
      const x = (random(index * 97 + j) - 0.5) * p.w;
      const y = 0.18 + random(j + 52) * 0.48;
      line(c, [x, y, x + 0.12, y - 0.013], "rgba(255,255,229,.42)", 0.007);
    }

    if (p.kind === "garden") {
      // Gardens are authored in profile, leaving the collision edge explicit.
      if (index % 2 === 0 || index === 0)
        this.paintTree(
          c,
          -half + 0.9,
          0,
          1 + random(index) * 0.23,
          level,
          index,
        );
      for (let j = 0; j < Math.floor(p.w * 1.35); j++) {
        const x = -half + 0.18 + random(index * 119 + j) * (p.w - 0.36);
        const size = 0.23 + random(j + 9) * 0.32;
        for (let k = -1; k <= 1; k++)
          leaf(c, x, 0, size, k * 0.6, tint(level.leaf, INK, 0.25 + k * 0.1));
        if (j % 4 === 0) {
          line(c, [x, 0, x + 0.035, -0.58], tint(level.leaf, INK, 0.4), 0.013);
          for (let k = 0; k < 5; k++)
            ellipse(
              c,
              x + 0.06 * Math.cos((k * TAU) / 5),
              -0.58 + 0.06 * Math.sin((k * TAU) / 5),
              0.07,
              0.045,
              level.accent,
              (k * TAU) / 5,
            );
          ellipse(c, x, -0.58, 0.032, 0.032, GOLD);
        }
      }
    }
    if (
      index === 0 ||
      index % 3 === 0 ||
      index === level.platforms.length - 1
    ) {
      const x = index === 0 ? 0.7 : half - 1;
      this.paintArch(
        c,
        x,
        0,
        index === level.platforms.length - 1 ? 3.25 : 2.35,
        level,
      );
    }
    if (p.kind === "lift") {
      for (const x of [-half + 0.3, half - 0.3]) {
        line(c, [x, 0.85, x, 1.3], GOLD, 0.035);
        circle(c, x, 1.48, 0.19, level.accent, 0.028);
        star(c, x, 1.48, 0.12, level.accent);
      }
    }
    c.save();
    c.globalCompositeOperation = "source-atop";
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = this.grain;
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.restore();
    return { canvas, left, top, w, h };
  }
  private paintTree(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    level: Level,
    seed: number,
  ) {
    c.save();
    c.translate(x, y);
    c.scale(size, size);
    c.beginPath();
    c.moveTo(-0.14, 0);
    c.bezierCurveTo(-0.03, -0.8, -0.27, -1.6, 0.13, -2.28);
    c.lineTo(0.2, -2.26);
    c.bezierCurveTo(-0.11, -1.4, 0.13, -0.7, 0.12, 0);
    c.closePath();
    c.fillStyle = "#8a815c";
    c.fill();
    line(c, [0.01, 0, -0.03, -0.8, -0.07, -1.4, 0.17, -2.15], "#c1b38a", 0.026);
    for (const side of [-1, 1])
      line(
        c,
        [0, -1.2, side * 0.58, -1.7, side * 0.86, -1.98],
        "#8a815c",
        0.045,
      );
    for (let j = 0; j < 5; j++) {
      const cx = -0.72 + j * 0.35,
        cy = -2.12 - Math.sin((j / 4) * Math.PI) * 0.45;
      const color = tint(level.leaf, INK, 0.42 - j * 0.055);
      c.beginPath();
      c.moveTo(cx - 0.5, cy);
      c.bezierCurveTo(
        cx - 0.8,
        cy - 0.4,
        cx - 0.24,
        cy - 0.66,
        cx + 0.1,
        cy - 0.53,
      );
      c.bezierCurveTo(
        cx + 0.64,
        cy - 0.7,
        cx + 0.91,
        cy - 0.14,
        cx + 0.52,
        cy + 0.12,
      );
      c.bezierCurveTo(cx + 0.12, cy + 0.5, cx - 0.53, cy + 0.33, cx - 0.5, cy);
      c.fillStyle = color;
      c.fill();
      for (let k = 0; k < 15; k++) {
        const lx = cx + (random(seed * 107 + j * 19 + k) - 0.5) * 0.9;
        const ly = cy + (random(k + 43) - 0.5) * 0.42;
        line(
          c,
          [lx, ly, lx + 0.07, ly - 0.045],
          "rgba(218,221,167,.22)",
          0.015,
        );
      }
    }
    c.restore();
  }
  private paintArch(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    height: number,
    level: Level,
  ) {
    c.save();
    c.translate(x, y);
    const stone = tint(level.stone, level.leaf, 0.12);
    for (const side of [-1, 1]) {
      const px = side * 1.25;
      c.fillStyle = stone;
      c.fillRect(px - 0.15, -height, 0.3, height);
      c.fillStyle = IVORY;
      c.fillRect(px - 0.16, -height, 0.09, height);
      c.fillStyle = GOLD;
      c.fillRect(px - 0.22, -height + 0.15, 0.45, 0.12);
      c.fillRect(px - 0.23, -0.16, 0.46, 0.13);
      line(
        c,
        [px + 0.07, -0.25, px + 0.07, -height + 0.34],
        "rgba(72,98,89,.27)",
        0.021,
      );
    }
    c.beginPath();
    c.moveTo(-1.45, -height + 0.14);
    c.lineTo(-1.45, -height - 0.14);
    c.lineTo(-0.18, -height - 0.42);
    c.quadraticCurveTo(0, -height - 0.54, 0.18, -height - 0.42);
    c.lineTo(1.45, -height - 0.14);
    c.lineTo(1.45, -height + 0.14);
    c.closePath();
    c.fillStyle = stone;
    c.fill();
    line(
      c,
      [-1.5, -height - 0.1, 0, -height - 0.47, 1.5, -height - 0.1],
      GOLD,
      0.045,
    );
    circle(c, 0, -height - 0.81, 0.4, GOLD, 0.035);
    star(c, 0, -height - 0.81, 0.18, GOLD);
    c.restore();
  }
  event(event: Event) {
    if (event.type === "clear") this.beacon = true;
    if (
      ![
        "jump",
        "land",
        "shard",
        "mote",
        "checkpoint",
        "clear",
        "shift",
        "fall",
      ].includes(event.type)
    )
      return;
    const count =
      event.type === "clear" ? 48 : event.type === "shard" ? 24 : 10;
    for (let i = 0; i < count; i++) {
      const life = 0.45 + random(this.rendered + i * 19) * 1.1;
      this.particles.push({
        x: event.position.x,
        y: event.position.y,
        vx: (random(i * 71 + this.rendered) - 0.5) * 4.3,
        vy: 1 + random(i * 11 + this.rendered) * 2.6,
        life,
        max: life,
        kind: event.type === "land" || event.type === "fall" ? "dust" : "light",
      });
    }
  }
  update(
    game: Game,
    dt: number,
    camera: FlatCamera,
    opacity: number,
    paused: boolean,
  ) {
    this.visible = opacity > 0.001;
    this.canvas.style.opacity = String(opacity);
    this.canvas.style.visibility = this.visible ? "visible" : "hidden";
    this.canvas.setAttribute("aria-hidden", String(!this.visible));
    this.camera = camera;
    this.scale = this.height / camera.viewHeight;
    this.time = game.time;
    if (!paused) {
      for (const p of this.particles) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= dt * 3;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
    }
    if (!this.visible || !this.level) return;
    this.rendered++;
    const c = this.context;
    this.paintSky(game);
    c.save();
    c.translate(
      this.width / 2 - camera.x * this.scale,
      this.height / 2 + camera.y * this.scale,
    );
    c.scale(this.scale, -this.scale);
    // World coordinates are upright; artwork itself is authored in screen coordinates.
    for (const original of this.level.platforms) {
      const p = platformAt(original, game.time);
      if (!this.inView(p.x, p.y, p.w + 2, 9)) continue;
      const art = this.islands.get(p.id)!;
      c.save();
      c.translate(p.x, p.y);
      c.scale(1, -1);
      c.drawImage(art.canvas, art.left, art.top, art.w, art.h);
      if (p.motion) {
        c.globalAlpha = 0.35;
        ellipse(c, 0, 1.5, p.w * 0.38, 0.16, this.level.accent);
        c.globalAlpha = 0.6;
        circle(
          c,
          0,
          0.42,
          0.37 + Math.sin(game.time * 2) * 0.025,
          this.level.accent,
          0.025,
        );
      }
      c.restore();
    }
    // Solid walls are foreground silhouettes and exactly match the shared colliders.
    for (const wall of this.level.walls) {
      c.save();
      c.translate(wall.x, wall.y);
      c.scale(1, -1);
      const gradient = c.createLinearGradient(-wall.w / 2, 0, wall.w / 2, 0);
      gradient.addColorStop(0, IVORY);
      gradient.addColorStop(0.7, this.level.stone);
      gradient.addColorStop(1, tint(this.level.stone, INK, 0.38));
      c.fillStyle = gradient;
      c.fillRect(-wall.w / 2, -wall.h, wall.w, wall.h);
      c.strokeStyle = GOLD;
      c.lineWidth = 0.035;
      c.strokeRect(-wall.w / 2, -wall.h, wall.w, wall.h);
      for (let y = 0.5; y < wall.h; y += 0.75)
        line(c, [-wall.w / 2, -y, wall.w / 2, -y], "rgba(37,66,70,.18)", 0.018);
      circle(c, 0, -wall.h + 0.9, 0.38, GOLD, 0.04);
      star(c, 0, -wall.h + 0.9, 0.22, GOLD);
      c.fillStyle = GOLD;
      c.fillRect(-wall.w / 2 - 0.13, -wall.h - 0.06, wall.w + 0.26, 0.2);
      c.restore();
    }
    this.paintCheckpoints(game);
    this.paintBeacon(game);
    this.paintCollectibles(game);
    for (const original of this.level.hazards) {
      const h = hazardAt(original, game.time);
      c.save();
      c.translate(h.x, h.y);
      c.scale(1, -1);
      const halo = c.createRadialGradient(0, 0, 0.1, 0, 0, h.r * 2.5);
      halo.addColorStop(0, "rgba(237,128,129,.35)");
      halo.addColorStop(1, "rgba(237,128,129,0)");
      ellipse(c, 0, 0, h.r * 2.5, h.r * 2.5, halo);
      c.rotate(game.time * 0.5);
      c.beginPath();
      for (let i = 0; i < 24; i++) {
        const r = h.r * (i % 2 ? 0.79 : 1);
        const x = Math.cos((i * TAU) / 24) * r,
          y = Math.sin((i * TAU) / 24) * r;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      c.fillStyle = "#a64e62";
      c.fill();
      c.strokeStyle = "#ffd8b3";
      c.lineWidth = 0.025;
      c.stroke();
      circle(c, 0, 0, h.r * 0.64, "#f6b6a0", 0.025);
      star(c, 0, 0, h.r * 0.48, "#ffc797");
      c.restore();
    }
    this.paintKeeper(game);
    for (const p of this.particles) {
      c.globalAlpha = p.life / p.max;
      if (p.kind === "light") star(c, p.x, p.y, 0.06, this.level.accent);
      else ellipse(c, p.x, p.y, 0.04, 0.035, IVORY);
    }
    c.restore();
    c.save();
    c.globalAlpha = 0.38;
    c.fillStyle = this.grain;
    c.fillRect(0, 0, this.width, this.height);
    c.restore();
  }
  private inView(x: number, y: number, w: number, h: number) {
    return (
      Math.abs(x - this.camera.x) < this.width / this.scale / 2 + w / 2 &&
      Math.abs(y - this.camera.y) < this.camera.viewHeight / 2 + h
    );
  }
  private paintSky(game: Game) {
    const c = this.context,
      level = this.level!;
    const w = this.width,
      h = this.height,
      night = game.levelIndex === 4;
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, tint(level.sky, INK, 0.52));
    sky.addColorStop(0.55, level.sky);
    sky.addColorStop(1, tint(level.mist, IVORY, 0.5));
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    const sunX = w * 0.73 - this.camera.x * this.scale * 0.025;
    const sunY = h * 0.28,
      sunR = Math.min(w, h) * 0.115;
    const haze = c.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3.8);
    haze.addColorStop(0, "rgba(255,230,166,.48)");
    haze.addColorStop(1, "rgba(255,236,190,0)");
    c.fillStyle = haze;
    c.fillRect(0, 0, w, h);
    ellipse(c, sunX, sunY, sunR, sunR, tint(level.accent, IVORY, 0.33));
    c.save();
    c.globalAlpha = 0.35;
    circle(c, sunX, sunY, sunR * 1.12, level.accent, 1);
    circle(c, sunX, sunY, sunR * 1.29, level.accent, 0.65);
    for (let i = 0; i < 48; i++) {
      const a = (i * TAU) / 48;
      const r = sunR * 1.4,
        to = r + (i % 4 === 0 ? 10 : 4);
      line(
        c,
        [
          sunX + Math.cos(a) * r,
          sunY + Math.sin(a) * r,
          sunX + Math.cos(a) * to,
          sunY + Math.sin(a) * to,
        ],
        level.accent,
        0.7,
      );
    }
    c.restore();
    // Constellations and chart lines read as an astronomical illustration.
    for (let i = 0; i < (night ? 75 : 28); i++) {
      const x = random(i * 7 + 9) * w,
        y = random(i * 19 + 4) * h * 0.64;
      c.globalAlpha =
        (night ? 0.65 : 0.25) * (0.7 + Math.sin(game.time * 0.35 + i) * 0.3);
      star(c, x, y, i % 9 === 0 ? 4 : 1.5, IVORY);
      if (i % 9 === 0) circle(c, x, y, 6, IVORY, 0.5);
    }
    c.globalAlpha = 1;
    for (let layer = 0; layer < 3; layer++) {
      const parallax = 0.05 + layer * 0.075;
      const shift = this.camera.x * this.scale * parallax;
      const spacing = 440 - layer * 70;
      const start = Math.floor(shift / spacing) - 2;
      for (let i = start; i < start + Math.ceil(w / spacing) + 4; i++) {
        const x = i * spacing - shift + random(i + layer * 71) * 170;
        const y = h * (0.59 + layer * 0.1) + (random(i + 13) - 0.5) * 70;
        const scale = 0.45 + layer * 0.17;
        c.save();
        c.translate(x, y);
        c.scale(scale, scale);
        const color = tint(level.mist, INK, 0.12 + layer * 0.1);
        c.globalAlpha = 0.3 + layer * 0.14;
        c.fillStyle = color;
        c.beginPath();
        c.moveTo(-90, 0);
        c.lineTo(90, 0);
        c.lineTo(66, 26);
        c.lineTo(32, 74);
        c.lineTo(-5, 116);
        c.lineTo(-36, 65);
        c.lineTo(-72, 43);
        c.closePath();
        c.fill();
        for (const side of [-1, 1]) c.fillRect(side * 51 - 6, -144, 12, 144);
        c.beginPath();
        c.moveTo(-69, -142);
        c.lineTo(0, -166);
        c.lineTo(69, -142);
        c.lineTo(69, -133);
        c.lineTo(-69, -133);
        c.closePath();
        c.fill();
        circle(c, 0, -198, 28, color, 3);
        line(c, [-15, -198, 15, -198], color, 2);
        c.restore();
      }
    }
    // Long hand-drawn cloud ribbons mask the distant islands at different depths.
    for (let j = 0; j < 5; j++) {
      const shift = this.camera.x * this.scale * (0.1 + j * 0.025);
      const y = h * (0.65 + j * 0.073);
      const color = tint(level.mist, IVORY, 0.15 + j * 0.12);
      c.beginPath();
      c.moveTo(-w, h + 20);
      c.lineTo(-w, y);
      for (let x = -w; x < w * 2; x += 90) {
        const phase = (x + shift) * 0.007 + j * 2;
        const cy = y + Math.sin(phase) * (12 + j * 2);
        c.bezierCurveTo(x + 25, cy - 12, x + 60, cy + 14, x + 90, cy);
      }
      c.lineTo(w * 2, h + 20);
      c.closePath();
      c.fillStyle = color;
      c.globalAlpha = 0.3 + j * 0.07;
      c.fill();
      c.globalAlpha = 0.2;
      c.strokeStyle = IVORY;
      c.lineWidth = 0.8;
      c.stroke();
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 7; i++) {
      const x =
        ((random(i * 33) * w + game.time * (this.reduced ? 0 : 3)) % (w + 40)) -
        20;
      const y = h * (0.19 + random(i * 21) * 0.2);
      c.beginPath();
      c.moveTo(x - 5, y - 1);
      c.quadraticCurveTo(x - 2, y - 4, x, y);
      c.quadraticCurveTo(x + 2, y - 4, x + 5, y - 1);
      c.strokeStyle = "rgba(26,65,73,.35)";
      c.lineWidth = 1;
      c.stroke();
    }
    const vignette = c.createRadialGradient(
      w / 2,
      h * 0.45,
      h * 0.2,
      w / 2,
      h * 0.45,
      Math.max(w, h) * 0.72,
    );
    vignette.addColorStop(0, "rgba(12,41,50,0)");
    vignette.addColorStop(1, "rgba(12,41,50,.28)");
    c.fillStyle = vignette;
    c.fillRect(0, 0, w, h);
  }
  private paintCollectibles(game: Game) {
    const c = this.context,
      level = this.level!;
    level.collectibles.forEach((item, i) => {
      if (game.collected.has(item.id)) return;
      const original = level.platforms.find((p) => p.id === item.platform)!;
      const p = platformAt(original, game.time);
      const x = item.x + p.x - original.x,
        y = item.y + p.y - original.y + Math.sin(game.time * 2 + i) * 0.13;
      c.save();
      c.translate(x, y);
      c.scale(1, -1);
      const radius = item.kind === "shard" ? 0.95 : 0.5;
      const glow = c.createRadialGradient(0, 0, 0.05, 0, 0, radius);
      glow.addColorStop(0, "rgba(255,231,170,.5)");
      glow.addColorStop(1, "rgba(255,231,170,0)");
      c.fillStyle = glow;
      c.fillRect(-radius, -radius, radius * 2, radius * 2);
      if (item.kind === "shard") {
        circle(c, 0, 0, 0.32, GOLD, 0.025);
        c.save();
        c.rotate(game.time * 0.4 + i);
        circle(c, 0, 0, 0.42, "rgba(253,220,154,.55)", 0.012);
        for (let j = 0; j < 4; j++)
          star(
            c,
            Math.cos((j * TAU) / 4) * 0.42,
            Math.sin((j * TAU) / 4) * 0.42,
            0.05,
            IVORY,
          );
        c.restore();
        c.beginPath();
        c.moveTo(0, -0.25);
        c.lineTo(0.14, 0);
        c.lineTo(0, 0.25);
        c.lineTo(-0.14, 0);
        c.closePath();
        c.fillStyle = IVORY;
        c.fill();
        c.strokeStyle = level.accent;
        c.lineWidth = 0.025;
        c.stroke();
        line(c, [0, -0.2, 0, 0.2], GOLD, 0.014);
      } else star(c, 0, 0, 0.13, IVORY);
      c.restore();
    });
  }
  private paintCheckpoints(game: Game) {
    const c = this.context;
    this.level!.checkpoints.forEach((p, i) => {
      c.save();
      c.translate(p.x, p.y);
      c.scale(1, -1);
      const active = i <= game.checkpointIndex;
      ellipse(c, 0, 0, 0.65, 0.09, active ? "#ffe3a0" : GOLD);
      line(
        c,
        [-0.5, -0.05, -0.4, -0.19, 0.4, -0.19, 0.5, -0.05],
        active ? IVORY : GOLD,
        0.028,
      );
      if (active) {
        c.globalAlpha = 0.45;
        circle(c, 0, -0.45, 0.14, this.level!.accent, 0.023);
        star(c, 0, -0.45, 0.09, IVORY);
      }
      c.restore();
    });
  }
  private paintBeacon(game: Game) {
    const c = this.context,
      e = this.level!.exit;
    c.save();
    c.translate(e.x, e.y);
    c.scale(1, -1);
    const ready =
      this.level!.collectibles.filter(
        (v) => v.kind === "shard" && game.collected.has(v.id),
      ).length === 3;
    if (ready || this.beacon) {
      const glow = c.createRadialGradient(0, -1.5, 0.1, 0, -1.5, 3.5);
      glow.addColorStop(0, "rgba(255,226,152,.42)");
      glow.addColorStop(1, "rgba(255,226,152,0)");
      c.fillStyle = glow;
      c.fillRect(-3.5, -5, 7, 7);
    }
    line(c, [-0.35, 0, -0.35, -0.8, 0.35, -0.8, 0.35, 0], GOLD, 0.08);
    c.fillStyle = this.level!.stone;
    c.fillRect(-0.48, -0.83, 0.96, 0.18);
    for (let i = 0; i < 3; i++) {
      c.save();
      c.translate(0, -1.62);
      c.rotate(game.time * 0.14 + (i * Math.PI) / 3);
      c.beginPath();
      c.ellipse(0, 0, 0.9, 0.4 + i * 0.15, 0, 0, TAU);
      c.strokeStyle = ready ? "#ffe4a5" : GOLD;
      c.lineWidth = 0.03;
      c.stroke();
      c.restore();
    }
    star(c, 0, -1.62, ready ? 0.42 : 0.2, ready ? IVORY : GOLD);
    c.restore();
  }
  private paintKeeper(game: Game) {
    const c = this.context,
      p = game.player;
    if (game.invincible > 0 && Math.floor(game.invincible * 12) % 2) return;
    c.save();
    c.translate(p.x, p.y);
    c.scale(p.facing, -1);
    const speed = Math.min(1, Math.abs(p.vx) / 5.9);
    const stride = this.reduced ? 0 : Math.sin(game.time * 13) * speed;
    if (p.grounded) ellipse(c, 0, 0, 0.36, 0.055, "rgba(13,52,57,.2)");
    c.translate(0, p.grounded ? -Math.abs(stride) * 0.025 : -0.02);
    // Animated, separately illustrated boots, coat, helmet, and scarf.
    for (const side of [-1, 1]) {
      c.save();
      c.translate(side * 0.095, -0.37);
      c.rotate(p.grounded ? side * stride * 0.48 : side * 0.34);
      c.fillStyle = INK;
      c.fillRect(-0.067, 0, 0.13, 0.25);
      c.beginPath();
      c.roundRect(-0.09, 0.23, 0.23, 0.13, 0.035);
      c.fillStyle = IVORY;
      c.fill();
      line(c, [-0.075, 0.34, 0.12, 0.34], GOLD, 0.02);
      c.restore();
    }
    c.beginPath();
    c.moveTo(-0.19, -0.75);
    c.quadraticCurveTo(-0.28, -0.49, -0.21, -0.32);
    c.quadraticCurveTo(0, -0.25, 0.22, -0.33);
    c.lineTo(0.19, -0.76);
    c.closePath();
    const coat = c.createLinearGradient(-0.2, 0, 0.2, 0);
    coat.addColorStop(0, "#b5c7b6");
    coat.addColorStop(0.45, IVORY);
    coat.addColorStop(1, "#e8dcb9");
    c.fillStyle = coat;
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 0.015;
    c.stroke();
    line(c, [0, -0.7, 0, -0.34], GOLD, 0.012);
    c.fillStyle = "#d3a16c";
    c.fillRect(-0.26, -0.67, 0.08, 0.27);
    circle(c, -0.235, -0.55, 0.095, GOLD, 0.02);
    c.save();
    c.translate(0.19, -0.68);
    c.rotate(p.grounded ? -stride * 0.25 : -0.48);
    c.beginPath();
    c.roundRect(-0.015, 0, 0.12, 0.29, 0.045);
    c.fillStyle = IVORY;
    c.fill();
    line(c, [0.04, 0.27, 0.22, 0.35], INK, 0.07);
    // The little sun is carried in the keeper's hand in the flat illustration.
    const glow = c.createRadialGradient(0.24, 0.4, 0, 0.24, 0.4, 0.5);
    glow.addColorStop(0, "rgba(255,231,164,.6)");
    glow.addColorStop(1, "rgba(255,231,164,0)");
    c.fillStyle = glow;
    c.fillRect(-0.3, -0.1, 1, 1);
    circle(c, 0.24, 0.4, 0.14, GOLD, 0.02);
    star(c, 0.24, 0.4, 0.095, "#fff3c3");
    c.restore();
    ellipse(c, 0, -0.93, 0.295, 0.265, IVORY);
    circle(c, 0, -0.93, 0.292, GOLD, 0.015);
    ellipse(c, 0.075, -0.945, 0.215, 0.117, INK, -0.07);
    ellipse(c, 0.056, -0.95, 0.022, 0.028, "#ffe7a6");
    ellipse(c, 0.17, -0.962, 0.022, 0.028, "#ffe7a6");
    line(c, [-0.19, -1.08, -0.06, -1.13, 0.07, -1.12], "#fffbe6", 0.025);
    c.beginPath();
    c.roundRect(-0.21, -0.785, 0.42, 0.082, 0.02);
    c.fillStyle = "#ce6559";
    c.fill();
    const flutter = this.reduced ? 0 : Math.sin(game.time * 7) * 0.06;
    c.beginPath();
    c.moveTo(-0.16, -0.76);
    c.bezierCurveTo(
      -0.4,
      -0.76 + flutter,
      -0.63,
      -0.6 - speed * 0.13,
      -0.94,
      -0.72 + flutter,
    );
    c.lineTo(-0.85, -0.6 + flutter);
    c.lineTo(-0.95, -0.52 + flutter);
    c.bezierCurveTo(
      -0.6,
      -0.42 - speed * 0.13,
      -0.35,
      -0.62 + flutter,
      -0.16,
      -0.69,
    );
    c.closePath();
    c.fillStyle = "#ce6559";
    c.fill();
    line(
      c,
      [-0.35, -0.65, -0.64, -0.57 - speed * 0.1, -0.82, -0.62 + flutter],
      "#eaa080",
      0.014,
    );
    c.restore();
  }
  snapshot() {
    return {
      engine: "canvas2d",
      artwork: "illustrated",
      visible: this.visible,
      frames: this.rendered,
      islands: this.islands.size,
      time: this.time,
      beacon: this.beacon,
      viewport: [this.width, this.height],
      camera: { ...this.camera },
    };
  }
}
