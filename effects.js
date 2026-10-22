(() => {
  'use strict';

  const boot = () => {
    const body = document.body;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const mobile = window.matchMedia('(max-width: 700px)');
    const toggles = Array.from(document.querySelectorAll('[data-motion-toggle]'));
    const progress = document.getElementById('reading-progress');
    const surfaces = Array.from(document.querySelectorAll('.tilt-surface'));
    const scenes = [];
    let userPaused = false;
    let paused = reduceMotion.matches;
    let frame = 0;
    let previousTime = 0;
    let elapsed = 0;
    let scrollFrame = 0;
    let resizeFrame = 0;

    body.classList.add('motion-ready');

    const resetSurface = (surface) => {
      surface.style.setProperty('--rx', '0deg');
      surface.style.setProperty('--ry', '0deg');
      surface.style.setProperty('--mx', '50%');
      surface.style.setProperty('--my', '50%');
    };
    surfaces.forEach((surface) => {
      resetSurface(surface);
      surface.addEventListener('pointermove', (event) => {
        if (paused || !finePointer.matches || event.pointerType === 'touch') return;
        const rect = surface.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
        surface.style.setProperty('--rx', `${((0.5 - y) * 5).toFixed(2)}deg`);
        surface.style.setProperty('--ry', `${((x - 0.5) * 7).toFixed(2)}deg`);
        surface.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
        surface.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      }, { passive: true });
      surface.addEventListener('pointerleave', () => resetSurface(surface));
      surface.addEventListener('pointercancel', () => resetSurface(surface));
    });

    const reveals = Array.from(document.querySelectorAll('.reveal'));
    let revealObserver;
    if ('IntersectionObserver' in window && !reduceMotion.matches) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.remove('pending');
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        });
      }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });
      reveals.forEach((element) => {
        // Already-visible content is never hidden during initialization.
        const rect = element.getBoundingClientRect();
        if (rect.top < innerHeight && rect.bottom > 0) {
          element.classList.add('is-visible');
        } else {
          element.classList.add('pending');
          revealObserver.observe(element);
        }
      });
    }

    const exposeAll = () => {
      reveals.forEach((element) => {
        element.classList.remove('pending');
        element.classList.add('is-visible');
      });
      if (revealObserver) revealObserver.disconnect();
    };

    const makeScene = (id, paint) => {
      const canvas = document.getElementById(id);
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const scene = { canvas, ctx, paint, width: 0, height: 0, visible: true };
      scenes.push(scene);
      return scene;
    };

    // A deterministic constellation keeps its composition through resizes.
    const random = (seed) => {
      const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return value - Math.floor(value);
    };
    makeScene('space-field', (scene, time) => {
      const { ctx, width, height } = scene;
      ctx.clearRect(0, 0, width, height);
      const count = mobile.matches ? 35 : 76;
      for (let index = 0; index < count; index += 1) {
        const x = (random(index + 1) * width + time * (0.45 + random(index + 91) * 0.6)) % width;
        const y = (random(index + 301) * height - time * 0.4 + height) % height;
        const radius = 0.4 + random(index + 501) * 0.85;
        const alpha = 0.12 + (Math.sin(time * 0.32 + index * 3.1) + 1) * 0.105;
        ctx.fillStyle = `rgba(${index % 6 === 0 ? '126,144,255' : '168,218,239'},${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    const spherePoints = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const buildSphere = () => {
      spherePoints.length = 0;
      const count = mobile.matches ? 320 : 650;
      for (let index = 0; index < count; index += 1) {
        const y = 1 - (index / (count - 1)) * 2;
        const radius = Math.sqrt(1 - y * y);
        const angle = goldenAngle * index;
        spherePoints.push({ x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius, index });
      }
    };
    buildSphere();

    const rotate = (point, yaw, pitch) => {
      const x = point.x * Math.cos(yaw) + point.z * Math.sin(yaw);
      const z = -point.x * Math.sin(yaw) + point.z * Math.cos(yaw);
      return { x, y: point.y * Math.cos(pitch) - z * Math.sin(pitch), z: point.y * Math.sin(pitch) + z * Math.cos(pitch) };
    };

    makeScene('signal-orb', (scene, time) => {
      const { ctx, width, height } = scene;
      ctx.clearRect(0, 0, width, height);
      const cx = width * 0.5;
      const cy = height * 0.5;
      const radius = Math.min(width, height) * 0.29;
      const yaw = time * 0.095 + 0.4;
      const pitch = -0.22 + Math.sin(time * 0.09) * 0.09;
      const project = (point) => {
        const perspective = 3.8 / (3.8 - point.z);
        return { x: cx + point.x * radius * perspective, y: cy + point.y * radius * perspective, z: point.z, scale: perspective };
      };

      const halo = ctx.createRadialGradient(cx, cy, radius * 0.18, cx, cy, radius * 1.65);
      halo.addColorStop(0, 'rgba(27,150,177,0.065)');
      halo.addColorStop(0.5, 'rgba(18,97,148,0.045)');
      halo.addColorStop(1, 'rgba(11,52,93,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      const orbitPoint = (angle, ring) => {
        const point = { x: Math.cos(angle) * ring.radius, y: 0, z: Math.sin(angle) * ring.radius };
        return rotate(rotate(point, 0, ring.tilt), ring.yaw + time * ring.speed, 0);
      };
      const rings = [
        { radius: 1.37, tilt: 0.48, yaw: 0.25, speed: 0.022, color: '89,221,244' },
        { radius: 1.19, tilt: -0.98, yaw: -0.67, speed: -0.016, color: '131,119,247' },
        { radius: 1.07, tilt: 1.2, yaw: 0.8, speed: 0.014, color: '103,159,255' }
      ];
      const drawRings = (front) => {
        rings.forEach((ring, ringIndex) => {
          const segments = mobile.matches ? 100 : 160;
          for (let index = 0; index < segments; index += 1) {
            const angle = (index / segments) * Math.PI * 2;
            const a = project(orbitPoint(angle, ring));
            const b = project(orbitPoint(angle + Math.PI * 2 / segments, ring));
            if ((a.z >= 0) !== front) continue;
            const travelingLight = Math.pow((Math.cos(angle - time * 0.35 - ringIndex * 2) + 1) / 2, 18);
            const alpha = (front ? 0.14 : 0.035) + travelingLight * (front ? 0.62 : 0.1);
            ctx.strokeStyle = `rgba(${ring.color},${alpha})`;
            ctx.lineWidth = 0.65 + travelingLight * 0.9;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
          const head = project(orbitPoint(time * 0.35 + ringIndex * 2, ring));
          if ((head.z >= 0) !== front) return;
          ctx.fillStyle = `rgba(${ring.color},${front ? 0.95 : 0.2})`;
          ctx.shadowColor = `rgba(${ring.color},0.65)`;
          ctx.shadowBlur = front ? 12 : 0;
          ctx.beginPath();
          ctx.arc(head.x, head.y, front ? 2 : 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        });
      };
      drawRings(false);

      const points = spherePoints.map((point) => ({ ...project(rotate(point, yaw, pitch)), index: point.index }));
      points.sort((a, b) => a.z - b.z);
      points.forEach((point) => {
        const depth = (point.z + 1) / 2;
        const bright = point.index % 37 === 0;
        const alpha = 0.1 + depth * depth * (bright ? 0.85 : 0.57);
        const dot = (bright ? 1.45 : 0.6 + depth * 0.35) * point.scale;
        ctx.fillStyle = `rgba(${bright ? '218,249,255' : point.index % 7 === 0 ? '143,139,255' : '92,214,235'},${alpha})`;
        ctx.beginPath();
        ctx.arc(point.x, point.y, dot, 0, Math.PI * 2);
        ctx.fill();
      });
      drawRings(true);
    });

    const paintVisible = () => {
      scenes.forEach((scene) => {
        if (scene.visible && scene.width > 0 && scene.height > 0) scene.paint(scene, elapsed);
      });
    };
    const shouldRun = () => !paused && !document.hidden && scenes.some((scene) => scene.visible && scene.width && scene.height);
    const tick = (timestamp) => {
      frame = 0;
      if (!shouldRun()) { previousTime = 0; return; }
      if (!previousTime || timestamp - previousTime >= 1000 / 30) {
        const delta = previousTime ? Math.min((timestamp - previousTime) / 1000, 0.08) : 0;
        previousTime = timestamp;
        elapsed += delta;
        paintVisible();
      }
      frame = requestAnimationFrame(tick);
    };
    const synchronizeLoop = () => {
      if (!shouldRun()) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        previousTime = 0;
      } else if (!frame) {
        frame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      resizeFrame = 0;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      scenes.forEach((scene) => {
        const bounds = scene.canvas.getBoundingClientRect();
        scene.width = bounds.width;
        scene.height = bounds.height;
        scene.canvas.width = Math.round(bounds.width * dpr);
        scene.canvas.height = Math.round(bounds.height * dpr);
        scene.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      });
      paintVisible();
      synchronizeLoop();
    };
    const scheduleResize = () => {
      if (!resizeFrame) resizeFrame = requestAnimationFrame(resize);
    };
    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(scheduleResize);
      scenes.forEach((scene) => resizeObserver.observe(scene.canvas));
    }
    window.addEventListener('resize', scheduleResize, { passive: true });
    if ('IntersectionObserver' in window) {
      const canvasObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const scene = scenes.find((item) => item.canvas === entry.target);
          if (scene) scene.visible = entry.isIntersecting;
        });
        paintVisible();
        synchronizeLoop();
      });
      scenes.forEach((scene) => canvasObserver.observe(scene.canvas));
    }

    const updateMotion = () => {
      paused = userPaused || reduceMotion.matches;
      body.classList.toggle('motion-paused', paused);
      toggles.forEach((button) => {
        button.setAttribute('aria-pressed', String(paused));
        button.setAttribute('aria-label', paused ? '恢复背景动效' : '暂停背景动效');
        button.textContent = paused ? '动效已暂停' : '暂停动效';
        button.disabled = reduceMotion.matches;
        button.title = reduceMotion.matches ? '已遵循系统的减少动态效果设置' : paused ? '恢复动态效果' : '暂停动态效果';
      });
      if (paused) {
        surfaces.forEach(resetSurface);
        exposeAll();
      }
      synchronizeLoop();
    };
    toggles.forEach((button) => button.addEventListener('click', () => {
      if (reduceMotion.matches) return;
      userPaused = !userPaused;
      updateMotion();
    }));
    reduceMotion.addEventListener('change', updateMotion);
    finePointer.addEventListener('change', () => surfaces.forEach(resetSurface));
    mobile.addEventListener('change', () => { buildSphere(); scheduleResize(); });
    document.addEventListener('visibilitychange', synchronizeLoop);

    const updateProgress = () => {
      scrollFrame = 0;
      if (!progress) return;
      const distance = document.documentElement.scrollHeight - innerHeight;
      const value = distance > 0 ? Math.max(0, Math.min(1, window.scrollY / distance)) : 0;
      progress.style.transform = `scaleX(${value})`;
    };
    const scheduleProgress = () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(updateProgress);
    };
    if (progress) {
      window.addEventListener('scroll', scheduleProgress, { passive: true });
      window.addEventListener('resize', scheduleProgress, { passive: true });
      updateProgress();
    }
    updateMotion();
    resize();
    // Hash links and browser Find must not land on content waiting for an animation.
    window.addEventListener('hashchange', () => {
      let target;
      try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (_) { return; }
      if (!target) return;
      target.classList.remove('pending');
      target.classList.add('is-visible');
      const parent = target.closest('.reveal.pending');
      if (parent) { parent.classList.remove('pending'); parent.classList.add('is-visible'); }
    });
    window.addEventListener('beforeprint', exposeAll);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
