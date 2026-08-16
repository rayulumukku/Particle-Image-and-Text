import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const canvasRef = useRef(null);
  const canvasControllerRef = useRef(null);
  const recognitionRef = useRef(null);
  const fileInputRef = useRef(null);

  // React state for UI
  const [inputValue, setInputValue] = useState('');
  const [transcript, setTranscript] = useState('');
  const [statusText, setStatusText] = useState('interactive sphere ready');
  const [showTip, setShowTip] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);

  // Sync theme ref
  useEffect(() => {
    document.body.classList.remove('light-theme');
  }, []);

  // Detect mobile device
  const isMobile = typeof window !== 'undefined' && 
    (('ontouchstart' in window) || navigator.maxTouchPoints > 0 || window.innerWidth < 768);

  const tipText = isMobile
    ? 'touch to repel \u2022 double-tap to reset'
    : 'move cursor over image/word to repel \u2022 double-click to reset';

  // Initialize Speech Recognition on Mount
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSpeechSupported(true);
      const rec = new SpeechRecognition();
      rec.continuous = false; // Stops automatically when user stops speaking
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onstart = () => {
        setIsListening(true);
        setStatusText('listening...');
      };

      rec.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        setStatusText('speech error: ' + event.error);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      rec.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        const currentText = finalTranscript || interimTranscript;
        if (currentText.trim()) {
          setTranscript(currentText);
          setInputValue(currentText);
          if (canvasControllerRef.current) {
            canvasControllerRef.current.formWord(currentText, !finalTranscript);
          }
        }
      };

      recognitionRef.current = rec;
    }
  }, []);

  // Main Canvas Setup and Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    /* ─── Particle count & config ─────────────────────────────────── */
    const N = isMobile ? 4000 : 10000;
    const px = new Float32Array(N);
    const py = new Float32Array(N);
    const pz = new Float32Array(N);
    const vx = new Float32Array(N);
    const vy = new Float32Array(N);
    const vz = new Float32Array(N);
    
    // Position targets
    const tx = new Float32Array(N);
    const ty = new Float32Array(N);
    const tz = new Float32Array(N);
    const ox = new Float32Array(N);
    const oy = new Float32Array(N);
    const oz = new Float32Array(N);
    
    // Dynamic color values (interpolated)
    const cr = new Float32Array(N);
    const cg = new Float32Array(N);
    const cb = new Float32Array(N);
    const ca = new Float32Array(N);
    
    // Color targets
    const tr = new Float32Array(N);
    const tg = new Float32Array(N);
    const tb = new Float32Array(N);
    const ta = new Float32Array(N);
    
    const hue = new Float32Array(N);
    const phase = new Float32Array(N);

    let appState = 0; // 0 = sphere, 1 = forming, 2 = interactive/formed
    let colorMode = 'text'; // 'text' (monochromatic) or 'image' (custom RGB)
    let mouseX = -9999;
    let mouseY = -9999;
    let t = 0;
    let rotY = 0;

    const REPEL_RADIUS = isMobile ? 80 : 60;
    const REPEL_FORCE = 8;
    const PHI = Math.PI * (1 + Math.sqrt(5));

    // Golden cursor trail pool
    const TRAIL_MAX = 1200;
    const trail = [];
    let lastMouseX = -9999;
    let lastMouseY = -9999;
    const FOV = 550;
    const CAMERA_Z = 600;

    let W = window.innerWidth;
    let H = window.innerHeight;
    let CX = W / 2;
    let CY = H / 2;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    /* ─── Helper Functions ─────────────────────────────────────────── */
    function hslToRgb(h, s, l) {
      let r, g, b;
      if (s === 0) {
        r = g = b = l; // achromatic
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
      }
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    function initSphereTargets() {
      const baseDim = Math.min(W, H);
      const R = baseDim > 1200 ? baseDim * 0.28 : baseDim * 0.42;
      for (let i = 0; i < N; i++) {
        const polar = Math.acos(1 - 2 * (i + 0.5) / N);
        const azim = PHI * i;

        ox[i] = Math.sin(polar) * Math.cos(azim) * R;
        oy[i] = Math.sin(polar) * Math.sin(azim) * R;
        oz[i] = Math.cos(polar) * R;

        tx[i] = ox[i];
        ty[i] = oy[i];
        tz[i] = oz[i];
      }
    }

    function initParticles() {
      for (let i = 0; i < N; i++) {
        px[i] = (Math.random() - 0.5) * W * 2;
        py[i] = (Math.random() - 0.5) * H * 2;
        pz[i] = (Math.random() - 0.5) * 1000;
        vx[i] = vy[i] = vz[i] = 0;
        hue[i] = (i / N) * 320 + 170;
        phase[i] = Math.random() * Math.PI * 2;
        
        // Initial colors matching dynamic rainbow sphere
        const rgb = hslToRgb(hue[i] / 360, 0.8, 0.7);
        cr[i] = tr[i] = rgb[0];
        cg[i] = tg[i] = rgb[1];
        cb[i] = tb[i] = rgb[2];
        ca[i] = ta[i] = 0.5;
      }
    }

    function sampleTextPositions(phrase) {
      const cW = Math.floor(W);
      const cH = Math.floor(H);
      const off = document.createElement('canvas');
      off.width = cW;
      off.height = cH;
      const c2 = off.getContext('2d');

      const words = phrase.split(' ');
      const lines = [];
      let currentLine = '';
      const maxChars = phrase.length > 25 ? 12 : 20;

      words.forEach(word => {
        if ((currentLine + word).length > maxChars) {
          lines.push(currentLine.trim());
          currentLine = word + ' ';
        } else {
          currentLine += word + ' ';
        }
      });
      lines.push(currentLine.trim());

      let fs = Math.min(cW * 0.72 / (maxChars * 0.5), cH * 0.50 / lines.length, 180);
      if (phrase.length > 30) fs *= 0.8;

      c2.fillStyle = '#fff';
      c2.font = `900 ${fs}px Arial Black, Arial, sans-serif`;
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';

      const lineHeight = fs * 1.1;
      const startY = (cH / 2) - ((lines.length - 1) * lineHeight / 2);

      lines.forEach((line, i) => {
        c2.fillText(line, cW / 2, startY + (i * lineHeight));
      });

      const data = c2.getImageData(0, 0, cW, cH).data;
      const pts = [];
      const step = phrase.length > 30 ? 2 : 1;

      for (let y = 0; y < cH; y += step) {
        for (let x = 0; x < cW; x += step) {
          if (data[(y * cW + x) * 4 + 3] > 120) {
            pts.push(x - cW / 2 + (Math.random() - 0.5) * 0.8, y - cH / 2 + (Math.random() - 0.5) * 0.8);
          }
        }
      }

      for (let i = pts.length / 2 - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const ia = i * 2, ja = j * 2;
        let tmp = pts[ia]; pts[ia] = pts[ja]; pts[ja] = tmp;
        tmp = pts[ia + 1]; pts[ia + 1] = pts[ja + 1]; pts[ja + 1] = tmp;
      }

      return pts;
    }

    let formTimeout;

    function formWord(phrase, isInterim = false) {
      if (!phrase.trim()) return;

      appState = 1;
      colorMode = 'text';
      setShowTip(false);
      setStatusText(isInterim ? 'capturing...' : 'sentence active');

      const pts = sampleTextPositions(phrase);
      const pCount = pts.length / 2;

      for (let i = 0; i < N; i++) {
        const idx = (i % pCount) * 2;
        tx[i] = pts[idx];
        ty[i] = pts[idx + 1];
        tz[i] = (Math.random() - 0.5) * 4;
      }

      rotY = 0;
      t = 0;
      clearTimeout(formTimeout);
      if (!isInterim) {
        formTimeout = setTimeout(() => {
          appState = 2;
          setStatusText(isMobile ? 'touch to repel' : 'move cursor to repel');
          setShowTip(true);
        }, 2000);
      }
    }

    function formImage(img) {
      appState = 1;
      colorMode = 'image';
      setShowTip(false);
      setStatusText('forming image...');

      // Center and scale image
      const maxW = W * 0.65;
      const maxH = H * 0.65;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const targetW = img.width * scale;
      const targetH = img.height * scale;

      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const c2 = off.getContext('2d');
      const startX = (W - targetW) / 2;
      const startY = (H - targetH) / 2;
      c2.drawImage(img, startX, startY, targetW, targetH);

      const data = c2.getImageData(0, 0, W, H).data;

      // Scan sample pixels to see if transparency is used
      let hasTransparency = false;
      for (let i = 3; i < data.length; i += 4 * 100) {
        if (data[i] < 250) {
          hasTransparency = true;
          break;
        }
      }

      // Detect background color from corners to filter screenshots
      const getPixelColor = (px, py) => {
        const idx = (py * W + px) * 4;
        return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
      };

      const corner1 = getPixelColor(Math.floor(startX), Math.floor(startY));
      const corner2 = getPixelColor(Math.floor(startX + targetW - 1), Math.floor(startY));
      const corner3 = getPixelColor(Math.floor(startX), Math.floor(startY + targetH - 1));
      const corner4 = getPixelColor(Math.floor(startX + targetW - 1), Math.floor(startY + targetH - 1));

      const colorDist = (colA, colB) => {
        return Math.sqrt((colA[0] - colB[0]) ** 2 + (colA[1] - colB[1]) ** 2 + (colA[2] - colB[2]) ** 2);
      };

      // Check if background is solid (all corners are highly similar)
      const maxDiff = Math.max(
        colorDist(corner1, corner2), colorDist(corner1, corner3), colorDist(corner1, corner4),
        colorDist(corner2, corner3), colorDist(corner2, corner4), colorDist(corner3, corner4)
      );
      const isSolidBg = maxDiff < 45;
      const bgR = (corner1[0] + corner2[0] + corner3[0] + corner4[0]) / 4;
      const bgG = (corner1[1] + corner2[1] + corner3[1] + corner4[1]) / 4;
      const bgB = (corner1[2] + corner2[2] + corner3[2] + corner4[2]) / 4;

      // Calculate step grid to fit around N particles
      const pts = [];
      const colors = [];
      const step = Math.max(1, Math.floor(Math.sqrt((targetW * targetH) / N) * 0.95));

      for (let y = 0; y < targetH; y += step) {
        for (let x = 0; x < targetW; x += step) {
          const pxX = Math.floor(startX + x);
          const pxY = Math.floor(startY + y);
          if (pxX >= W || pxY >= H) continue;

          const idx = (pxY * W + pxX) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];

          // Thresholding
          if (hasTransparency && a < 50) continue;

          if (!hasTransparency) {
            // Adaptive corner subtraction
            if (isSolidBg) {
              const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
              if (dist < 38) continue;
            }
            // Simple bright/dark thresholds as a secondary fallback
            const brightness = (r + g + b) / 3;
            if (brightness > 232) continue; // Skip near-white
            if (brightness < 22) continue;  // Skip near-black
          }

          pts.push(pxX - W / 2, pxY - H / 2);
          colors.push(r, g, b, a);
        }
      }

      const pCount = pts.length / 2;
      if (pCount === 0) {
        setStatusText('error: image could not be sampled');
        return;
      }

      // Populate positions and colors target
      for (let i = 0; i < N; i++) {
        const idx = (i % pCount) * 2;
        tx[i] = pts[idx] + (Math.random() - 0.5) * 1.5;
        ty[i] = pts[idx + 1] + (Math.random() - 0.5) * 1.5;
        tz[i] = (Math.random() - 0.5) * 10;

        const cIdx = (i % pCount) * 4;
        tr[i] = colors[cIdx];
        tg[i] = colors[cIdx + 1];
        tb[i] = colors[cIdx + 2];
        ta[i] = colors[cIdx + 3] / 255;
      }

      rotY = 0;
      t = 0;
      clearTimeout(formTimeout);
      formTimeout = setTimeout(() => {
        appState = 2;
        setStatusText(isMobile ? 'touch to repel' : 'move cursor to repel');
        setShowTip(true);
      }, 2000);
    }

    function resetToSphere() {
      appState = 0;
      colorMode = 'text';
      initSphereTargets();
      setStatusText('interactive sphere ready');
      setShowTip(false);
      setTranscript('');
      setInputValue('');
    }

    // Expose controller back to components
    canvasControllerRef.current = {
      formWord,
      formImage,
      resetToSphere
    };

    /* ─── Physics update ────────────────────────────────────────────── */
    function update() {
      t += 0.005;
      if (appState === 0) rotY += 0.006;

      const jitter = appState === 0 ? 1.8 : 0;

      for (let i = 0; i < N; i++) {
        let curTx = tx[i], curTy = ty[i], curTz = tz[i];

        const cosY = Math.cos(rotY), sinY = Math.sin(rotY);

        let targetX = curTx * cosY - curTz * sinY;
        let targetY = curTy;
        let targetZ = curTx * sinY + curTz * cosY;

        if (appState === 0) {
          targetX += Math.sin(t * 8 + phase[i]) * jitter;
          targetY += Math.cos(t * 9 + phase[i]) * jitter;
          targetZ += Math.sin(t * 7 + phase[i] * 2) * jitter;
        }

        const sp = appState === 0 ? 0.02 : 0.022;
        vx[i] += (targetX - px[i]) * sp;
        vy[i] += (targetY - py[i]) * sp;
        vz[i] += (targetZ - pz[i]) * sp;

        if (mouseX > -9000) {
          const scale = FOV / (FOV + pz[i] + CAMERA_Z);
          const sx = px[i] * scale + CX;
          const sy = py[i] * scale + CY;

          const rdx = sx - mouseX;
          const rdy = sy - mouseY;
          const d2 = rdx * rdx + rdy * rdy;
          if (d2 < REPEL_RADIUS * REPEL_RADIUS && d2 > 1) {
            const d = Math.sqrt(d2);
            const mag = REPEL_FORCE * (1 - d / REPEL_RADIUS) * 5;
            vx[i] += (rdx / d) * mag;
            vy[i] += (rdy / d) * mag;
          }
        }

        vx[i] *= 0.82;
        vy[i] *= 0.82;
        vz[i] *= 0.82;

        px[i] += vx[i];
        py[i] += vy[i];
        pz[i] += vz[i];

        // Color transitions interpolation
        let targetR, targetG, targetB, targetA;
        if (appState === 0) {
          const h = (hue[i] + t * 25) % 360;
          const sat = 0.8;
          const lightness = 0.7;
          const rgb = hslToRgb(h / 360, sat, lightness);
          targetR = rgb[0];
          targetG = rgb[1];
          targetB = rgb[2];
          targetA = 0.5;
        } else if (colorMode === 'text') {
          targetR = 170;
          targetG = 230;
          targetB = 250;
          targetA = 1.0;
        } else {
          // Custom RGB image colors
          targetR = tr[i];
          targetG = tg[i];
          targetB = tb[i];
          targetA = ta[i];
        }

        cr[i] += (targetR - cr[i]) * 0.1;
        cg[i] += (targetG - cg[i]) * 0.1;
        cb[i] += (targetB - cb[i]) * 0.1;
        ca[i] += (targetA - ca[i]) * 0.1;
      }
    }

    /* ─── Render ────────────────────────────────────────────────────── */
    function draw() {
      // Background clear color trail
      ctx.fillStyle = 'rgba(5,5,15,0.22)';
      ctx.fillRect(0, 0, W, H);

      for (let i = 0; i < N; i++) {
        const zPos = pz[i] + CAMERA_Z;
        if (zPos < 10) continue;

        const scale = FOV / zPos;
        const sx = px[i] * scale + CX;
        const sy = py[i] * scale + CY;

        const spd = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
        const sizeMultiplier = 1.0;
        let size = (appState >= 1 ? 0.45 : 0.4 + spd * 0.12) * scale * sizeMultiplier;

        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, 6.2832);
        ctx.fillStyle = `rgba(${Math.round(cr[i])}, ${Math.round(cg[i])}, ${Math.round(cb[i])}, ${ca[i] * Math.min(1, scale * 0.65)})`;
        ctx.fill();
      }

      // Update & draw golden chime sparkles
      for (let i = trail.length - 1; i >= 0; i--) {
        const p = trail[i];
        p.life--;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985;
        p.vy *= 0.985;

        if (p.life <= 0) { trail.splice(i, 1); continue; }

        const lifeRatio = p.life / p.maxLife;
        // Flash in fast, fade out slowly
        const alpha = lifeRatio > 0.8
          ? ((1 - lifeRatio) / 0.2)
          : lifeRatio;

        // Twinkle effect (shimmer)
        const shimmer = 0.35 + 0.65 * Math.sin(t * 35 + p.phase);
        const curAlpha = alpha * shimmer;
        const rad = p.size * (0.35 + 0.65 * lifeRatio);

        if (p.isStar) {
          // Draw a glowing golden diamond/star (pinched corners star)
          ctx.fillStyle = `hsla(${p.hue}, 100%, 75%, ${curAlpha})`;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - rad * 2.0);
          ctx.lineTo(p.x + rad * 0.5, p.y - rad * 0.5);
          ctx.lineTo(p.x + rad * 2.0, p.y);
          ctx.lineTo(p.x + rad * 0.5, p.y + rad * 0.5);
          ctx.lineTo(p.x, p.y + rad * 2.0);
          ctx.lineTo(p.x - rad * 0.5, p.y + rad * 0.5);
          ctx.lineTo(p.x - rad * 2.0, p.y);
          ctx.lineTo(p.x - rad * 0.5, p.y - rad * 0.5);
          ctx.closePath();
          ctx.fill();

          // Tiny center core (bright white)
          ctx.fillStyle = `rgba(255, 255, 255, ${curAlpha})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad * 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Draw a soft glowing gold circle
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 2.2);
          grd.addColorStop(0, `rgba(255, 255, 255, ${curAlpha})`);
          grd.addColorStop(0.25, `hsla(${p.hue}, 100%, 72%, ${curAlpha})`);
          grd.addColorStop(0.7, `hsla(${p.hue}, 100%, 48%, ${curAlpha * 0.25})`);
          grd.addColorStop(1, `hsla(${p.hue}, 100%, 40%, 0)`);
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    /* ─── Main loop ─────────────────────────────────────────────────── */
    let animId;
    function loop() {
      update();
      draw();
      animId = requestAnimationFrame(loop);
    }

    /* ─── Resize listener ───────────────────────────────────────────── */
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      CX = W / 2;
      CY = H / 2;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
      if (appState === 0) initSphereTargets();
    }

    // Attach Event Listeners
    window.addEventListener('resize', resize);

    const onMouseMove = (e) => {
      // If mouse is hovering over the UI panel, don't spawn particles or repel
      const ui = document.getElementById('pw-ui');
      if (ui && ui.contains(e.target)) {
        mouseX = -9999;
        mouseY = -9999;
        lastMouseX = -9999;
        lastMouseY = -9999;
        return;
      }

      const clientX = e.clientX;
      const clientY = e.clientY;

      let dx = 0;
      let dy = 0;
      if (lastMouseX > -9000) {
        dx = clientX - lastMouseX;
        dy = clientY - lastMouseY;
      }
      lastMouseX = clientX;
      lastMouseY = clientY;

      mouseX = clientX;
      mouseY = clientY;

      // Spawn 12-20 dense shimmering golden stardust particles
      const spawnCount = 12 + Math.floor(Math.random() * 9);
      for (let s = 0; s < spawnCount; s++) {
        if (trail.length >= TRAIL_MAX) trail.shift();
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.2 + Math.random() * 1.1;
        // 55 to 115 frames duration (much longer disappearance time)
        const life = 55 + Math.floor(Math.random() * 60);
        trail.push({
          x: mouseX + (Math.random() - 0.5) * 8,
          y: mouseY + (Math.random() - 0.5) * 8,
          vx: dx * 0.12 + Math.cos(angle) * speed,
          vy: dy * 0.12 + Math.sin(angle) * speed,
          life,
          maxLife: life,
          size: 0.45 + Math.random() * 0.85, // smaller width/size for tiny stardust
          hue: 38 + Math.random() * 18,      // gold to amber range
          phase: Math.random() * Math.PI * 2,
          isStar: Math.random() > 0.45
        });
      }
    };
    const onMouseLeave = () => {
      mouseX = -9999;
      mouseY = -9999;
      lastMouseX = -9999;
      lastMouseY = -9999;
    };
    const onDblClick = () => { resetToSphere(); };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('dblclick', onDblClick);

    const onTouchStart = (e) => {
      e.preventDefault();
      mouseX = e.touches[0].clientX;
      mouseY = e.touches[0].clientY;
    };
    const onTouchMove = (e) => {
      e.preventDefault();
      mouseX = e.touches[0].clientX;
      mouseY = e.touches[0].clientY;
    };
    const onTouchEnd = (e) => {
      e.preventDefault();
      mouseX = -9999;
      mouseY = -9999;
    };

    let lastTap = 0;
    const onTouchTapReset = () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        resetToSphere();
      }
      lastTap = now;
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchend', onTouchTapReset);

    // Boot Canvas
    resize();
    initParticles();
    loop();

    // Cleanup on Unmount
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchend', onTouchTapReset);
      clearTimeout(formTimeout);
    };
  }, [isMobile]);

  // Handle Voice Input Toggle
  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      setInputValue('');
      setTranscript('');
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error('Speech Recognition start error:', err);
      }
    }
  };

  // Handle Manual Typing
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    if (val.trim()) {
      setTranscript(val);
      if (canvasControllerRef.current) {
        canvasControllerRef.current.formWord(val, true);
        
        // Debounce to finalize the word and enable repell state
        clearTimeout(window.inputFinalizeTimeout);
        window.inputFinalizeTimeout = setTimeout(() => {
          if (canvasControllerRef.current && val.trim() === e.target.value.trim()) {
            canvasControllerRef.current.formWord(val, false);
          }
        }, 1200);
      }
    } else {
      setTranscript('');
      if (canvasControllerRef.current) {
        canvasControllerRef.current.resetToSphere();
      }
    }
  };

  // Trigger Image File Choice Dialog
  const triggerImageUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Read uploaded Image
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setTranscript(`Image: ${file.name}`);
        setInputValue('');
        if (canvasControllerRef.current) {
          canvasControllerRef.current.formImage(img);
        }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className='dark-theme' style={{ position: 'relative', width: '100%', height: '100%' }}>

      <canvas id="pw-canvas" ref={canvasRef}></canvas>

      <div id="pw-ui">
        <div id="pw-transcript">{transcript}</div>
        <div id="pw-input-zone">
          <input
            id="pw-input"
            type="text"
            placeholder="type a phrase here..."
            maxLength={100}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            value={inputValue}
            onChange={handleInputChange}
          />
          {isSpeechSupported && (
            <button
              id="pw-btn"
              className={isListening ? 'listening' : ''}
              onClick={toggleListening}
            >
              {isListening ? 'Listening...' : 'Speak'}
            </button>
          )}
          <button
            id="pw-go"
            onClick={triggerImageUpload}
          >
            Upload
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept="image/*"
            onChange={handleImageUpload}
          />
        </div>
        <div id="pw-status">{statusText}</div>
        <div id="pw-tip" style={{ opacity: showTip ? 1 : 0 }}>
          {tipText}
        </div>
      </div>

      <div id="pw-hint">
        <span>{isMobile ? 'double-tap to reset' : 'double-click to reset'}</span>
      </div>
    </div>
  );
}

export default App;
