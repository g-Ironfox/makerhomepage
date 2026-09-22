window.addEventListener('load', () => {
  window.lucide?.createIcons();
    const host = document.querySelector('#universe');
    const letter = document.querySelector('#galaxy-letter');
    const pauseButton = document.querySelector('#pause');
    const resetButton = document.querySelector('#reset');
    const speedControl = document.querySelector('#speed');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const seed = 20260921;
    const galaxyZoom = 2;
    const starCountScale = 2;
    const armSpread = 1.5;

    let paused = reducedMotion.matches;
    let motionSpeed = Number(speedControl.value);
    let animationFrame;
    let lastTime = 0;
    let elapsed = 0;
    let canvas;
    let context;
    let baked;
    let bakedContext;
    let nebulaWidth = 0;
    let nebulaHeight = 0;
    let twinklers = [];
    let backStars = [];
    let backHalfX = 0;
    let backHalfY = 0;
    let inflows = [];
    let streams = [];
    let nebulaRadiusX = 0;
    let nebulaStartRadius = 0;
    let nebulaArm = null;
    let nebulaFlatten = 1;
    let nebulaRightBias = 0;
    let nebulaZoom = 1;
    let nebulaWakeRadius = 0;
    let nebulaWakeCore = 0;
    let nebulaCenterX = 0;
    let nebulaCenterY = 0;
    let introStart = 0;
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };

    function armShift(t) {
      const progress = Math.min(1, Math.max(0, t));
      const smooth = progress * progress * (3 - 2 * progress);
      return smooth * nebulaRightBias;
    }

    function refreshIcons() {
      window.lucide?.createIcons();
    }

    function updatePause() {
      pauseButton.innerHTML = `<i data-lucide="${paused ? 'play' : 'pause'}"></i>`;
      pauseButton.setAttribute('aria-label', paused ? '播放动画' : '暂停动画');
      pauseButton.title = paused ? '播放动画' : '暂停动画';
      pauseButton.setAttribute('aria-pressed', String(paused));
      refreshIcons();
    }

    // —— 游戏式粒子系统：确定性随机 + 预渲染光斑贴图（impostor）+ 分层绘制 ——
    function mulberry32(a) {
      return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function gaussian(rng) {
      return Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-6))) * Math.cos(2 * Math.PI * rng());
    }

    function makeGlowSprite(stops) {
      const size = 128;
      const sprite = document.createElement('canvas');
      sprite.width = size;
      sprite.height = size;
      const spriteContext = sprite.getContext('2d');
      const gradient = spriteContext.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      for (const [offset, color] of stops) gradient.addColorStop(offset, color);
      spriteContext.fillStyle = gradient;
      spriteContext.fillRect(0, 0, size, size);
      return sprite;
    }

    function makeFlareSprite() {
      const size = 128;
      const sprite = document.createElement('canvas');
      sprite.width = size;
      sprite.height = size;
      const spriteContext = sprite.getContext('2d');
      const gradient = spriteContext.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255, 255, 255, .85)');
      gradient.addColorStop(.3, 'rgba(205, 228, 255, .18)');
      gradient.addColorStop(1, 'rgba(170, 205, 250, 0)');
      spriteContext.fillStyle = gradient;
      spriteContext.beginPath();
      spriteContext.ellipse(size / 2, size / 2, size / 2, size * .028, 0, 0, Math.PI * 2);
      spriteContext.fill();
      spriteContext.beginPath();
      spriteContext.ellipse(size / 2, size / 2, size * .028, size / 2, 0, 0, Math.PI * 2);
      spriteContext.fill();
      return sprite;
    }

    const sprites = {
      star: makeGlowSprite([[0, 'rgba(255, 255, 255, 1)'], [.16, 'rgba(240, 246, 255, .9)'], [.42, 'rgba(188, 214, 246, .3)'], [1, 'rgba(150, 185, 235, 0)']]),
      ice: makeGlowSprite([[0, 'rgba(255, 255, 255, 1)'], [.2, 'rgba(210, 234, 255, .88)'], [.46, 'rgba(122, 172, 238, .28)'], [1, 'rgba(92, 142, 220, 0)']]),
      amber: makeGlowSprite([[0, 'rgba(255, 251, 242, 1)'], [.22, 'rgba(255, 214, 160, .82)'], [.5, 'rgba(240, 152, 82, .26)'], [1, 'rgba(220, 122, 62, 0)']]),
      gold: makeGlowSprite([[0, 'rgba(255, 253, 246, 1)'], [.2, 'rgba(255, 232, 178, .9)'], [.5, 'rgba(244, 198, 112, .3)'], [1, 'rgba(232, 172, 82, 0)']]),
      cyan: makeGlowSprite([[0, 'rgba(255, 255, 255, 1)'], [.2, 'rgba(206, 244, 255, .9)'], [.48, 'rgba(96, 196, 232, .3)'], [1, 'rgba(70, 160, 210, 0)']]),
      red: makeGlowSprite([[0, 'rgba(255, 240, 225, 1)'], [.22, 'rgba(255, 186, 140, .85)'], [.5, 'rgba(226, 110, 72, .28)'], [1, 'rgba(200, 80, 50, 0)']]),
      violet: makeGlowSprite([[0, 'rgba(250, 248, 255, 1)'], [.22, 'rgba(214, 196, 255, .85)'], [.5, 'rgba(150, 130, 235, .28)'], [1, 'rgba(120, 100, 210, 0)']]),
      dust: makeGlowSprite([[0, 'rgba(255, 255, 255, 1)'], [.4, 'rgba(240, 248, 255, .8)'], [.78, 'rgba(196, 220, 248, .18)'], [1, 'rgba(170, 200, 240, 0)']]),
      haze: makeGlowSprite([[0, 'rgba(214, 226, 248, .85)'], [.35, 'rgba(150, 180, 222, .28)'], [1, 'rgba(110, 150, 205, 0)']]),
      warmHaze: makeGlowSprite([[0, 'rgba(255, 226, 190, .8)'], [.4, 'rgba(238, 166, 96, .22)'], [1, 'rgba(228, 138, 72, 0)']]),
      flare: makeFlareSprite(),
    };

    function blit(target, sprite, x, y, size, alpha) {
      target.globalAlpha = alpha;
      target.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    }

    function cubicBezierEase(t) {
      const clamped = Math.min(1, Math.max(0, t));
      return clamped * clamped * (3 - 2 * clamped);
    }

    // 按弧长采样臂参数：半径从内端到外端要变化数倍，等 t 采样会让内侧在屏幕上挤成一团、外侧拉稀。
    function armT(u) {
      return Math.pow(u, .6);
    }

    // 散布随进度收紧：外侧 1，越往里越小，粒子越贴近轨道。
    function armSpreadAt(t) {
      const clamped = Math.min(1, Math.max(0, t));
      return .35 + .65 * clamped;
    }

    function wrapSpan(value, span) {
      return ((value % span) + span) % span;
    }

    // 尘埃受大星与小星的平方反比引力。源有数千个，用格子分桶只算截断半径内的源。
    function applyDustGravity(sources) {
      const dust = [];
      for (const star of twinklers) {
        if (!star.dust) continue;
        star.gx = 0;
        star.gy = 0;
        dust.push(star);
      }
      if (!dust.length) return;

      const cellSize = nebulaRadiusX * .1;
      const minX = -nebulaRadiusX * 1.5;
      const minY = -nebulaRadiusX * 1.5;
      const cols = Math.ceil(nebulaRadiusX * 3 / cellSize);
      const head = new Int32Array(cols * cols).fill(-1);
      const next = new Int32Array(dust.length);
      const xs = new Float32Array(dust.length);
      const ys = new Float32Array(dust.length);
      const cellIndex = (x, y) => Math.min(cols - 1, Math.max(0, Math.floor((y - minY) / cellSize))) * cols
        + Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / cellSize)));

      for (let i = 0; i < dust.length; i++) {
        const star = dust[i];
        const progress = (star.r - nebulaStartRadius) / (nebulaRadiusX - nebulaStartRadius);
        xs[i] = Math.cos(star.theta) * star.r + armShift(progress);
        ys[i] = Math.sin(star.theta) * star.r;
        const cell = cellIndex(xs[i], ys[i]);
        next[i] = head[cell];
        head[cell] = i;
      }

      const soft2 = Math.pow(nebulaRadiusX * .02, 2);
      const gravityG = nebulaRadiusX * nebulaRadiusX * .00008;
      const cutoff2 = cellSize * cellSize;
      const pull = (sx, sy, mass) => {
        const cx = Math.floor((sx - minX) / cellSize);
        const cy = Math.floor((sy - minY) / cellSize);
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          if (gy < 0 || gy >= cols) continue;
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            if (gx < 0 || gx >= cols) continue;
            for (let i = head[gy * cols + gx]; i !== -1; i = next[i]) {
              const dx = sx - xs[i];
              const dy = sy - ys[i];
              const d2 = dx * dx + dy * dy;
              if (d2 >= cutoff2) continue;
              const dist = Math.sqrt(d2) || 1;
              const accel = gravityG * mass / (d2 + soft2) / dist;
              dust[i].gx += dx * accel;
              dust[i].gy += dy * accel;
            }
          }
        }
      };

      for (const source of sources) pull(source.x, source.y, 1 + source.strength * 12);
      for (const star of twinklers) {
        if (!star.gravity || star.dust) continue;
        const progress = (star.r - nebulaStartRadius) / (nebulaRadiusX - nebulaStartRadius);
        pull(Math.cos(star.theta) * star.r + armShift(progress), Math.sin(star.theta) * star.r, 1);
      }
    }

    // 恒星类型加权随机：白、冰蓝、青、金、橙、红巨星、紫
    function pickStarSprite(roll) {
      if (roll < .15) return sprites.amber;
      if (roll < .22) return sprites.gold;
      if (roll < .27) return sprites.red;
      if (roll < .32) return sprites.violet;
      if (roll < .46) return sprites.cyan;
      if (roll < .7) return sprites.ice;
      return sprites.star;
    }

    function pickBrightStarSprite(roll) {
      if (roll < .27) return sprites.amber;
      if (roll < .46) return sprites.gold;
      if (roll < .64) return sprites.red;
      if (roll < .8) return sprites.violet;
      return sprites.cyan;
    }

    // 自由粒子：在旋臂外侧段生成，受大星局部引力裹挟，带寿命；进入核心区即回收。
    // scatter 越大离轨道越远；dust 为真时按尘埃表现（更暗更小）。
    function createFreeStar(rand, scatter = 1, dust = false) {
      const arm = nebulaArm;
      const t = .16 + armT(rand()) * .81;
      const angle = arm.offset + t * arm.swirl + gaussian(rand) * (.025 + t * .035) * armSpread * scatter;
      const radius = nebulaStartRadius + Math.pow(t, .95) * arm.length * (nebulaRadiusX - nebulaStartRadius)
        + gaussian(rand) * (5 + t * 11) * armSpread * scatter;
      const roll = rand();
      return {
        a: angle, theta: angle, r: radius, homeR: radius, flatten: nebulaFlatten,
        glow: dust ? .9 + rand() * 1.8 : 1.1 + rand() * 2.5,
        alpha: dust ? .1 + rand() * .22 : .16 + rand() * .36,
        sprite: dust || roll < .58 ? sprites.dust : pickStarSprite(rand()),
        gravity: true, ox: 0, oy: 0,
        scatter, dust,
        gx: 0, gy: 0,
        phase: rand() * Math.PI * 2,
        speed: .5 + rand() * 1.7,
        flare: !dust && rand() < .1,
        orbSpeed: (.16 + rand() * .34) * 1.6,
        orbPhase: rand() * Math.PI * 2,
        orbPhase2: rand() * Math.PI * 2,
        orbRad: (1 + rand() * 3.4) * armSpread * scatter,
        orbTan: (1.6 + rand() * 4.6) * armSpread * scatter,
        omega: .008 + rand() * .008,
        vTheta: 0,
        vr: 0,
        age: 0,
        life: 8 + rand() * 11.2,
      };
    }

    function generateNebula() {
      const bounds = host.getBoundingClientRect();
      const slot = letter.getBoundingClientRect();
      const width = Math.max(320, Math.round(bounds.width));
      const height = Math.max(320, Math.round(bounds.height));
      if (baked && width === nebulaWidth && height === nebulaHeight) return;
      nebulaWidth = width;
      nebulaHeight = height;
      const scale = Math.max(1, Math.min(devicePixelRatio, 2, Math.sqrt(2600000 / (width * height))));
      const density = Math.min(1, Math.max(.55, slot.width * slot.height * 6.5 / 150000));
      // 星系中心对齐标题里的字母槽位
      nebulaCenterX = slot.left + slot.width / 2 - bounds.left;
      nebulaCenterY = slot.top + slot.height / 2 - bounds.top;

      baked = baked || document.createElement('canvas');
      baked.width = Math.round(width * scale);
      baked.height = Math.round(height * scale);
      bakedContext = baked.getContext('2d');
      bakedContext.setTransform(scale, 0, 0, scale, 0, 0);
      bakedContext.globalCompositeOperation = 'lighter';
      bakedContext.clearRect(0, 0, width, height);
      bakedContext.translate(nebulaCenterX, nebulaCenterY);

      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.style.left = '0px';
      canvas.style.top = '0px';
      context.setTransform(scale, 0, 0, scale, 0, 0);

      const rng = mulberry32(seed);
      const radiusX = Math.max(150, slot.width * 1.21);
      const radiusY = Math.max(128, slot.height * 1.175);
      const flatten = radiusY / radiusX;
      const innerRadius = radiusX * .2;
      nebulaRadiusX = radiusX;
      nebulaStartRadius = innerRadius;
      nebulaFlatten = flatten;
      nebulaRightBias = radiusX * .28;
      nebulaWakeRadius = radiusX * .24;
      nebulaWakeCore = radiusX * .055;
      // 等比放大：按外臂实际到边的距离收敛，避免被画布裁掉
      const leftRoom = nebulaCenterX / radiusX;
      const rightRoom = (width - nebulaCenterX) / (radiusX * 1.28);
      const verticalRoom = Math.min(nebulaCenterY, height - nebulaCenterY) / radiusY;
      nebulaZoom = Math.max(1, Math.min(galaxyZoom, leftRoom, rightRoom, verticalRoom));
      twinklers = [];
      streams = [];

      function starPoint(angle, radius, armProgress = 0) {
        return { x: Math.cos(angle) * radius + armShift(armProgress), y: Math.sin(angle) * radius * flatten };
      }

      // 星点登记：live 星进入动态层（带自己的轨道摇摆），其余烘焙进静态层。
      function addStar(angle, radius, glow, alpha, sprite, live, wild = false, omega = 0, gravity = false, ox = 0, oy = 0) {
        if (!live) {
          const point = starPoint(angle, radius);
          blit(bakedContext, sprite, point.x + ox, point.y + oy, glow, alpha);
          return;
        }
        const wildness = wild ? 1 : .45;
        twinklers.push({
          a: angle, theta: angle, r: radius, homeR: radius, flatten, glow, alpha, sprite, gravity, ox, oy,
          phase: rng() * Math.PI * 2,
          speed: .5 + rng() * 1.7,
          flare: rng() < .1,
          orbSpeed: (.16 + rng() * .34) * (wild ? 1.6 : 1),
          orbPhase: rng() * Math.PI * 2,
          orbPhase2: rng() * Math.PI * 2,
          orbRad: (1 + rng() * 3.4) * wildness,
          orbTan: (1.6 + rng() * 4.6) * wildness,
          omega: gravity ? .008 + rng() * .008 : omega,
          vTheta: 0,
          vr: 0,
        });
      }

      // 中央核球：用笛卡尔偏移直接定位，不参与极坐标换算
      const coreOffsetX = radiusX * -.17;
      const coreOffsetY = radiusX * .01;
      blit(bakedContext, sprites.haze, coreOffsetX, coreOffsetY, radiusX * 1.7, .12);
      blit(bakedContext, sprites.haze, coreOffsetX, coreOffsetY, radiusX * .62, .5);
      blit(bakedContext, sprites.warmHaze, coreOffsetX, coreOffsetY, radiusX * .3, .28);
      blit(bakedContext, sprites.haze, coreOffsetX, coreOffsetY, radiusX * .24, .85);
      blit(bakedContext, sprites.haze, coreOffsetX, coreOffsetY, radiusX * .11, 1);
      addStar(0, 0, radiusX * .2, 1, sprites.star, true, false, 0, false, coreOffsetX, coreOffsetY);

      // 核球星群
      for (let index = 0; index < Math.round(950 * density * starCountScale); index++) {
        const angle = rng() * Math.PI * 2;
        const radius = Math.pow(rng(), 1.7) * radiusX * .17;
        const roll = rng();
        addStar(
          angle, radius,
          1 + rng() * 2.2,
          .14 + rng() * .55,
          pickStarSprite(roll),
          rng() < .12,
          false,
          0,
          false,
          coreOffsetX,
          coreOffsetY
        );
      }

      // 旋臂：单条极坐标螺旋，尾端停在 5 点方向。内端停在 9 点方向（迎向 12 点方向）不再向核心收拢，
      // 避免内圈那圈急弯。
      const tailAngle = Math.PI / 3;
      const sweep = Math.PI * 2.8 - Math.PI / 9;
      const arms = [
        { offset: tailAngle + sweep, swirl: -sweep, length: 1, bright: 1, clusters: 60, dust: 2600 },
      ];
      // 烘焙层两端各留余量，让动态粒子盖住边界，避免静态贴图露馅
      const bakedMargin = .05;

      for (const arm of arms) {
        nebulaArm = arm;
        // 串珠状亮星团：整组作为一支星流，沿臂轨道向核心滑动
        for (let cluster = 0; cluster < arm.clusters; cluster++) {
          const t = Math.min(.995, armT((cluster + rng() * .9) / arm.clusters));
          const angle = arm.offset + t * arm.swirl;
          const radius = innerRadius + Math.pow(t, .95) * arm.length * (radiusX - innerRadius);
          const point = starPoint(angle, radius, t);
          const hazeSprite = rng() < .42 ? sprites.warmHaze : sprites.haze;
          const hazeSize = (17 + rng() * 46) * (.7 + arm.bright * .5);
          const hazeAlpha = (.07 + rng() * .1) * arm.bright;
          if (t > bakedMargin && t < 1 - bakedMargin) blit(bakedContext, hazeSprite, point.x, point.y, hazeSize, hazeAlpha);

          const members = [];
          const memberCount = (6 + Math.floor(rng() * 13)) * starCountScale;
          const spread = (5 + rng() * 12) * armSpread;
          for (let member = 0; member < memberCount; member++) {
            const roll = rng();
            const hero = member === 0 && rng() < .85;
            members.push({
              dt: gaussian(rng) * spread / (radiusX * .9),
              dr: gaussian(rng) * spread,
              wobble: (.4 + rng() * 1.8) * armSpread,
              phase: rng() * Math.PI * 2,
              glow: hero ? 24 + rng() * 28 : 2 + rng() * 3.8,
              alpha: hero ? (.8 + rng() * .2) * Math.min(1, arm.bright + .15) : (.32 + rng() * .5) * arm.bright,
              sprite: hero ? pickBrightStarSprite(roll) : pickStarSprite(roll),
              twkPhase: rng() * Math.PI * 2,
              twkSpeed: .5 + rng() * 1.7,
              flare: hero && rng() < .35,
            });
            if (hero) {
              const heroSize = 34 + rng() * 40;
              if (t > bakedMargin && t < 1 - bakedMargin) blit(bakedContext, roll < .3 ? sprites.warmHaze : sprites.haze, point.x, point.y, heroSize, .12);
            }
          }
          streams.push({
            offset: arm.offset, swirl: arm.swirl, length: arm.length,
            t, speed: .01 + rng() * .012,
            members,
          });
        }

        // 臂内尘埃光带（烘焙）：作为流动粒子的轨道/约束
        for (let index = 0; index < Math.round(arm.dust * density * starCountScale); index++) {
          const t = bakedMargin + armT(rng()) * (1 - bakedMargin * 2);
          const angle = arm.offset + t * arm.swirl + gaussian(rng) * (.05 + t * .04) * armSpread * armSpreadAt(t);
          const radius = innerRadius + Math.pow(t, .95) * arm.length * (radiusX - innerRadius) + gaussian(rng) * (2.2 + t * 6.2) * armSpread * armSpreadAt(t);
          const roll = rng();
          const point = starPoint(angle, radius, t);
          const sprite = roll < .08 ? sprites.gold : roll < .2 ? sprites.amber : roll < .3 ? sprites.ice : roll < .38 ? sprites.cyan : sprites.dust;
          blit(bakedContext, sprite, point.x, point.y, 1.2 + rng() * 3.2, (.15 + rng() * .5) * arm.bright);
        }

        // 一部分尘埃星也脱离烘焙图，沿轨道向核心流动
        for (let index = 0; index < Math.round(arm.dust * density * .4 * starCountScale); index++) {
          const roll = rng();
          const beacon = rng() < .025 / starCountScale;
          // 信标大星更靠内侧生成；普通尘埃按弧长采样，避免内侧挤成一团
          const streamT = beacon ? Math.pow(rng(), 1.7) : armT(rng());
          streams.push({
            offset: arm.offset, swirl: arm.swirl, length: arm.length,
            t: streamT,
            speed: .008 + rng() * .014,
            members: [{
              dt: 0,
              dr: gaussian(rng) * (1 + rng() * 3.8) * armSpread,
              wobble: (.3 + rng() * 1.5) * armSpread,
              phase: rng() * Math.PI * 2,
              glow: beacon ? 26 + rng() * 26 : 1.2 + rng() * 2.8,
              alpha: beacon ? .55 + rng() * .3 : (.15 + rng() * .45) * arm.bright,
              sprite: beacon ? pickBrightStarSprite(rng()) : roll < .55 ? sprites.dust : pickStarSprite(roll),
              twkPhase: rng() * Math.PI * 2,
              twkSpeed: .4 + rng() * 1.4,
              flare: beacon,
            }],
          });
        }

        // 自由小星从旋臂附近出发，由大星的局部引力维持在轨道周围。
        for (let index = 0; index < Math.round(1700 * density * starCountScale); index++) {
          twinklers.push(createFreeStar(rng));
        }

        // 自由尘埃：同样受引力裹挟，但离轨道更远、散布更大，构成臂外的弥散晕。
        for (let index = 0; index < Math.round(700 * density * starCountScale); index++) {
          twinklers.push(createFreeStar(rng, 3, true));
        }
      }
      // 背景板：铺满整个 hero 的弥散星点，缓慢浮动，在最底层。
      // 放在最后生成，避免打乱前面已有布局的随机序列。
      backStars = [];
      backHalfX = Math.max(nebulaCenterX, width - nebulaCenterX) / nebulaZoom * 1.25;
      backHalfY = Math.max(nebulaCenterY, height - nebulaCenterY) / nebulaZoom * 1.25;
      for (let index = 0; index < Math.round(1210 * density * starCountScale); index++) {
        const roll = rng();
        const drift = 1.5 + rng() * 4;
        const driftAngle = rng() * Math.PI * 2;
        backStars.push({
          x: (rng() * 2 - 1) * backHalfX,
          y: (rng() * 2 - 1) * backHalfY,
          vx: Math.cos(driftAngle) * drift,
          vy: Math.sin(driftAngle) * drift,
          glow: 1 + rng() * 1.8,
          alpha: .12 + rng() * .3,
          sprite: roll < .5 ? sprites.dust : pickStarSprite(rng()),
          amp: .8 + rng() * 2.6,
          sp: .12 + rng() * .3,
          ph: rng() * Math.PI * 2,
          ph2: rng() * Math.PI * 2,
          tw: .4 + rng() * 1.4,
          tph: rng() * Math.PI * 2,
        });
      }
      inflows = [];
    }

    function draw(time) {
      const delta = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0;
      lastTime = time;
      if (!paused && !document.hidden) {
        const motionDelta = delta * motionSpeed;
        elapsed += motionDelta;
        for (const particle of inflows) {
          particle.progress += particle.speed * motionDelta;
          if (particle.progress >= 1) {
            particle.progress -= 1;
            particle.startAngle = Math.random() * Math.PI * 2;
            particle.speed = .05 + Math.random() * .055;
            particle.sweep = 3 + Math.random() * 3.2;
            particle.phase = Math.random() * Math.PI * 2;
          }
        }
        for (const stream of streams) {
          stream.t -= stream.speed * motionDelta;
          if (stream.t <= 0) {
            stream.t += 1;
            stream.speed = .01 + Math.random() * .012;
            for (const member of stream.members) member.phase = Math.random() * Math.PI * 2;
          }
        }
        // 局部群集力与中心引力共同约束小星，径向锚避免长期向核心塌缩。
        const damp = Math.pow(.992, motionDelta * 60);
        const wakeSources = [];
        for (const stream of streams) {
          const base = stream.t;
          const clusterSpread = armSpreadAt(base);
          for (const member of stream.members) {
            if (member.glow < 10) continue;
            const progress = base + member.dt * clusterSpread;
            if (progress <= 0 || progress >= 1) continue;
            const angle = stream.offset + progress * stream.swirl;
            const radius = nebulaStartRadius + Math.pow(progress, .95) * stream.length * (nebulaRadiusX - nebulaStartRadius) + member.dr * clusterSpread;
            const radialSlope = .95 * Math.pow(progress, -.05) * stream.length * (nebulaRadiusX - nebulaStartRadius);
            const shiftSlope = 6 * progress * (1 - progress) * nebulaRightBias;
            const dxdt = -Math.sin(angle) * stream.swirl * radius + Math.cos(angle) * radialSlope + shiftSlope;
            const dydt = Math.cos(angle) * stream.swirl * radius + Math.sin(angle) * radialSlope;
            wakeSources.push({
              x: Math.cos(angle) * radius + armShift(progress),
              y: Math.sin(angle) * radius,
              vx: -stream.speed * dxdt,
              vy: -stream.speed * dydt,
              strength: Math.min(1.4, member.glow / 24),
            });
          }
        }
        applyDustGravity(wakeSources);
        const wakeRadius2 = nebulaWakeRadius * nebulaWakeRadius;
        const coreClearRadius = nebulaStartRadius * 1.4;
        for (let index = 0; index < twinklers.length; index++) {
          const star = twinklers[index];
          if (!star.gravity) continue;
          const cosT = Math.cos(star.theta);
          const sinT = Math.sin(star.theta);
          const armProgress = (star.r - nebulaStartRadius) / (nebulaRadiusX - nebulaStartRadius);
          const sx = cosT * star.r + armShift(armProgress);
          const sy = sinT * star.r;
          let tangentSpeed = 0;
          let totalWeight = 0;
          let localVr = 0;
          let localVt = 0;
          for (const source of wakeSources) {
            const dx = source.x - sx;
            const dy = source.y - sy;
            const d2 = dx * dx + dy * dy;
            if (d2 >= wakeRadius2) continue;
            const distance = Math.sqrt(d2) || 1;
            const edge = 1 - d2 / wakeRadius2;
            const weight = edge * edge * source.strength;
            tangentSpeed += (source.vx * -sinT + source.vy * cosT) * weight;
            totalWeight += weight;
            // 只保留向大星靠拢的局部吸引，中心处平滑降为零。
            const force = Math.min(15, distance / nebulaWakeCore * 7) * edge;
            const fx = dx / distance * force * source.strength;
            const fy = dy / distance * force * source.strength;
            localVr += fx * cosT + fy * sinT;
            localVt += fx * -sinT + fy * cosT;
          }
          const radius = Math.max(star.r, 12);
          if (totalWeight > 0) {
            const targetOmega = tangentSpeed / totalWeight / radius;
            const coupling = Math.min(3, totalWeight * 1.4) * motionDelta;
            star.vTheta += (targetOmega - star.omega - star.vTheta) * coupling;
            const localForce = Math.hypot(localVr, localVt);
            const forceLimit = localForce > 24 ? 24 / localForce : 1;
            star.vr += localVr * forceLimit * motionDelta;
            star.vTheta += localVt * forceLimit / radius * motionDelta;
          }
          // 尘埃额外受大星与小星的平方反比引力（wake 负责裹挟流动，这里补引力本身）
          if (star.dust) {
            const gravityForce = Math.hypot(star.gx, star.gy);
            const gravityLimit = gravityForce > 24 ? 24 / gravityForce : 1;
            star.vr += (star.gx * cosT + star.gy * sinT) * gravityLimit * motionDelta;
            star.vTheta += (star.gx * -sinT + star.gy * cosT) * gravityLimit / radius * motionDelta;
          }
          const centralSoftening = nebulaRadiusX * .18;
          const centralDistance2 = star.r * star.r + centralSoftening * centralSoftening;
          const centralPull = nebulaRadiusX * nebulaRadiusX * .14 * star.r / Math.pow(centralDistance2, 1.5);
          star.vr -= centralPull * motionDelta;
          // 径向弹簧只抵消长期内落，不把星锁死；外圈同样维持运动
          star.vr += (star.homeR - star.r) * .45 * motionDelta;
          star.vTheta *= damp;
          star.vr *= damp;
          star.theta += (star.omega + star.vTheta) * motionDelta;
          star.r = Math.min(nebulaRadiusX * 1.5, Math.max(nebulaStartRadius * .6, star.r + star.vr * motionDelta));
          // 被中心引力拖进核心、或活得超过寿命的自由小星，回收重投。
          star.age += motionDelta;
          if (star.age >= star.life || star.r <= coreClearRadius) {
            twinklers[index] = createFreeStar(Math.random, star.scatter, star.dust);
          }
        }
      }
      pointer.x += (pointer.targetX - pointer.x) * .05;
      pointer.y += (pointer.targetY - pointer.y) * .05;

      const intro = reducedMotion.matches ? 1 : Math.min(Math.max((time - introStart) / 1700, 0), 1);
      const ease = intro * intro * (3 - 2 * intro);
      const masterAlpha = .15 + .85 * ease;
      const width = nebulaWidth;
      const height = nebulaHeight;

      context.clearRect(0, 0, width, height);
      context.save();
      context.globalCompositeOperation = 'lighter';
      // 字形固定不转：转动感完全交给星星沿螺旋的流动
      context.translate(nebulaCenterX + pointer.x * 10, nebulaCenterY + pointer.y * 8);
      // 整体等比放大：臂宽、星点尺寸、间距一起缩，保持比例
      const zoom = nebulaZoom * (.78 + .22 * ease);
      context.scale(zoom, zoom);
      // 背景板：铺满 hero 的弥散星点，缓慢漂移 + 浮动 + 呼吸，位于所有内容之下
      const backSpanX = backHalfX * 2;
      const backSpanY = backHalfY * 2;
      for (const star of backStars) {
        const driftX = star.vx * elapsed + Math.sin(elapsed * star.sp + star.ph) * star.amp;
        const driftY = star.vy * elapsed + Math.cos(elapsed * star.sp * .8 + star.ph2) * star.amp;
        const pulse = Math.sin(elapsed * star.tw + star.tph);
        const glow = star.glow * (1 + pulse * .2);
        // 越界后从另一侧绕回，绕回线落在可见区域之外
        const x = wrapSpan(star.x + driftX + backHalfX, backSpanX) - backHalfX + pointer.x * 6.6;
        const y = wrapSpan(star.y + driftY + backHalfY, backSpanY) - backHalfY + pointer.y * 5.5;
        context.globalAlpha = Math.min(1, masterAlpha * star.alpha * (.6 + pulse * .3));
        context.drawImage(star.sprite, x - glow / 2, y - glow / 2, glow, glow);
      }

      // 烘焙层：最底层轨道纹理（以 hero 坐标绘制，按星系中心偏移贴回）
      context.globalAlpha = masterAlpha * .65;
      context.drawImage(baked, -nebulaCenterX, -nebulaCenterY, width, height);

      for (const star of twinklers) {
        const wobble = elapsed * star.orbSpeed + star.orbPhase;
        const starSpread = armSpreadAt((star.r - nebulaStartRadius) / (nebulaRadiusX - nebulaStartRadius));
        const baseAngle = star.gravity ? star.theta : star.a + elapsed * star.omega;
        const angle = baseAngle + star.orbTan * starSpread * Math.sin(wobble * 1.37 + star.orbPhase2) / Math.max(star.r, 36);
        const radius = star.r + star.orbRad * starSpread * Math.sin(wobble);
        const armProgress = (radius - nebulaStartRadius) / (nebulaRadiusX - nebulaStartRadius);
        const x = Math.cos(angle) * radius + (star.gravity ? armShift(armProgress) : 0) + star.ox;
        const y = Math.sin(angle) * radius * star.flatten + star.oy;
        const pulse = Math.sin(elapsed * star.speed + star.phase);
        const glow = star.glow * (1 + pulse * .14);
        if (star.flare) blit(context, sprites.flare, x, y, glow * 2.8, Math.min(1, masterAlpha * star.alpha * (.22 + pulse * .1) * 1.25));
        context.globalAlpha = Math.min(1, masterAlpha * star.alpha * (.68 + pulse * .32) * 1.25);
        context.drawImage(star.sprite, x - glow / 2, y - glow / 2, glow, glow);
      }

      // 旋臂星流：沿臂（轨道）旋转着滑向核心，核心处淡出、外端重生
      for (const stream of streams) {
        const t = stream.t;
        const clusterSpread = armSpreadAt(t);
        for (const member of stream.members) {
          const progress = t + member.dt * clusterSpread;
          // 大星在外端更晚淡入，相当于更内侧才出现
          const outerFade = member.glow >= 10 ? .3 : .08;
          const fade = Math.min(progress / .035, 1) * Math.min((1 - progress) / outerFade, 1);
          if (fade <= 0) continue;
          const brightStarFade = member.glow >= 10 ? cubicBezierEase(progress / .32) : 1;
          const angle = stream.offset + progress * stream.swirl;
          const radius = nebulaStartRadius + Math.pow(Math.max(progress, 0), .95) * stream.length * (nebulaRadiusX - nebulaStartRadius)
            + member.dr * clusterSpread + member.wobble * clusterSpread * Math.sin(elapsed * 1.1 + member.phase);
          const x = Math.cos(angle) * radius + armShift(progress);
          const y = Math.sin(angle) * radius * nebulaFlatten;
          const pulse = Math.sin(elapsed * member.twkSpeed + member.twkPhase);
          const pulseScale = member.glow >= 10 ? .05 : .14;
          const glow = member.glow * (1 + pulse * pulseScale) * (.3 + brightStarFade * .7);
          const alpha = member.alpha * fade * brightStarFade * brightStarFade;
          if (member.flare) blit(context, sprites.flare, x, y, glow * 2.8, Math.min(1, masterAlpha * alpha * (.22 + pulse * .1) * 1.25));
          context.globalAlpha = Math.min(1, masterAlpha * alpha * (.68 + pulse * .32) * 1.25);
          context.drawImage(member.sprite, x - glow / 2, y - glow / 2, glow, glow);
        }
      }

      // 旋入粒子：外端生成 → 向内加速盘旋 → 核心处淡出消失（带拖尾）
      for (const particle of inflows) {
        for (let sample = 0; sample < 3; sample++) {
          const progress = particle.progress - sample * .022;
          if (progress < 0) continue;
          const fade = Math.min(progress / .08, 1) * Math.min((1 - progress) / .22, 1);
          if (fade <= 0) continue;
          const radius = particle.startRadius + (particle.endRadius - particle.startRadius) * Math.pow(progress, 1.35)
            + particle.wobble * Math.sin(elapsed * 1.3 + particle.phase + sample);
          const angle = particle.startAngle + particle.sweep * Math.pow(progress, 1.5);
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius * particle.flatten;
          const tailScale = sample === 0 ? 1 : sample === 1 ? .38 : .15;
          const glow = particle.glow * (1 - sample * .2);
          context.globalAlpha = Math.min(1, masterAlpha * particle.alpha * fade * tailScale * 1.2);
          context.drawImage(particle.sprite, x - glow / 2, y - glow / 2, glow, glow);
        }
      }

      context.restore();
      animationFrame = requestAnimationFrame(draw);
    }

    function resetNebula() {
      elapsed = 0;
      lastTime = 0;
      introStart = performance.now();
      pointer.x = 0;
      pointer.y = 0;
      pointer.targetX = 0;
      pointer.targetY = 0;
    }

    function initializeNebula() {
      canvas = document.createElement('canvas');
      context = canvas.getContext('2d');
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none' });
      host.appendChild(canvas);
      generateNebula();
      const hero = host.closest('.hero');
      new ResizeObserver(generateNebula).observe(hero);
      hero.addEventListener('pointermove', (event) => {
        const bounds = hero.getBoundingClientRect();
        pointer.targetX = (event.clientX - bounds.left) / bounds.width - .5;
        pointer.targetY = (event.clientY - bounds.top) / bounds.height - .5;
      });
      hero.addEventListener('pointerleave', () => {
        pointer.targetX = 0;
        pointer.targetY = 0;
      });
      introStart = performance.now();
      animationFrame = requestAnimationFrame(draw);
    }

    pauseButton.addEventListener('click', () => {
      paused = !paused;
      updatePause();
    });

    resetButton.addEventListener('click', resetNebula);
    speedControl.addEventListener('input', () => {
      motionSpeed = Number(speedControl.value);
    });
    reducedMotion.addEventListener('change', () => {
      paused = reducedMotion.matches;
      updatePause();
    });
    updatePause();
    initializeNebula();
    document.body.classList.add('scene-ready');
});