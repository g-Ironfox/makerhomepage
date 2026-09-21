window.addEventListener('load', () => {
  window.lucide?.createIcons();
    const host = document.querySelector('#universe');
    const letter = document.querySelector('#galaxy-letter');
    const pauseButton = document.querySelector('#pause');
    const resetButton = document.querySelector('#reset');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const seed = 20260921;

    let paused = reducedMotion.matches;
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
    let inflows = [];
    let streams = [];
    let nebulaRadiusX = 0;
    let nebulaStartRadius = 0;
    let nebulaFlatten = 1;
    let nebulaCenterX = 0;
    let nebulaCenterY = 0;
    let nebulaArms = [];
    let introStart = 0;
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };

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

    // —— 坐标转换：极坐标（盘面角度/半径）↔ 画布坐标（椭圆盘映射：y 按 flatten 压缩）——
    function polarToXY(angle, radius) {
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * nebulaFlatten };
    }

    function xyToPolar(x, y) {
      const diskY = y / nebulaFlatten;
      return { angle: Math.atan2(diskY, x), radius: Math.hypot(diskY, x) };
    }

    // 臂的直线尾段：固定“水平向下 10°”，长度足够甩出屏幕
    const TAIL_TILT = Math.PI / 18;
    const TAIL_LENGTH = 900;

    // 臂路径：螺旋段（t ≤ joinT）+ 直线尾段（t > joinT），返回极坐标 { angle, radius }
    function armPath(arm, t) {
      if (t <= arm.joinT) {
        return {
          angle: arm.offset + t * arm.swirl,
          radius: nebulaStartRadius + Math.pow(Math.max(t, 0), 2.35) * arm.length * (nebulaRadiusX - nebulaStartRadius),
        };
      }
      const k = (t - arm.joinT) / (1 - arm.joinT);
      return xyToPolar(arm.joinX + k * TAIL_LENGTH * Math.cos(TAIL_TILT), arm.joinY + k * TAIL_LENGTH * Math.sin(TAIL_TILT));
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

    function generateNebula() {
      const bounds = host.getBoundingClientRect();
      const slot = letter.getBoundingClientRect();
      const width = Math.max(320, Math.round(bounds.width));
      const height = Math.max(320, Math.round(bounds.height));
      if (baked && width === nebulaWidth && height === nebulaHeight) return;
      nebulaWidth = width;
      nebulaHeight = height;
      const scale = Math.max(1, Math.min(devicePixelRatio, 2, Math.sqrt(2600000 / (width * height))));
      const density = Math.min(1.5, Math.max(.55, slot.width * slot.height * 6.5 / 150000));
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
      const radiusX = Math.max(200, slot.width * 2.05);
      const radiusY = Math.max(150, slot.height * 1.62);
      const flatten = radiusY / radiusX;
      const startRadius = radiusX * .13;
      nebulaRadiusX = radiusX;
      nebulaStartRadius = startRadius;
      nebulaFlatten = flatten;
      twinklers = [];
      streams = [];

      // 星点登记：live 星进入动态层（带自己的轨道摇摆），其余烘焙进静态层。
      function addStar(angle, radius, glow, alpha, sprite, live, wild = false, omega = 0, gravity = false) {
        if (!live) {
          const point = polarToXY(angle, radius);
          blit(bakedContext, sprite, point.x, point.y, glow, alpha);
          return;
        }
        const wildness = wild ? 1 : .45;
        twinklers.push({
          a: angle, theta: angle, r: radius, glow, alpha, sprite, gravity,
          phase: rng() * Math.PI * 2,
          speed: .5 + rng() * 1.7,
          flare: rng() < .1,
          orbSpeed: (.16 + rng() * .34) * (wild ? 1.6 : 1),
          orbPhase: rng() * Math.PI * 2,
          orbPhase2: rng() * Math.PI * 2,
          orbRad: (1 + rng() * 3.4) * wildness,
          orbTan: (1.6 + rng() * 4.6) * wildness,
          omega,
          vTheta: 0,
          vr: 0,
        });
      }

      // 中央核球：多层柔光 + 一颗核心亮星
      blit(bakedContext, sprites.haze, 0, 0, radiusX * 1.7, .12);
      blit(bakedContext, sprites.haze, 0, 0, radiusX * .62, .5);
      blit(bakedContext, sprites.warmHaze, 0, 0, radiusX * .3, .28);
      blit(bakedContext, sprites.haze, 0, 0, radiusX * .24, .85);
      blit(bakedContext, sprites.haze, 0, 0, radiusX * .11, 1);
      addStar(0, 0, radiusX * .2, 1, sprites.star, true);

      // 核球星群
      for (let index = 0; index < Math.round(950 * density); index++) {
        const angle = rng() * Math.PI * 2;
        const radius = Math.pow(rng(), 1.7) * radiusX * .17;
        const roll = rng();
        addStar(
          angle, radius,
          1 + rng() * 2.2,
          .14 + rng() * .55,
          pickStarSprite(roll),
          rng() < .12
        );
      }

      // 旋臂形态（极坐标拟合手绘轨迹）：r(t) = r₀ + t^2.35·L·(R−r₀)，θ(t) = θ₀ + t·swirl（前段紧贴核心盘绕、后段甩出）
      const baseOffset = 1.44;
      const arms = [
        { offset: baseOffset, swirl: -6.9, length: 1.55, bright: 1, clusters: 38, dust: 1900 },
        { offset: baseOffset + .26, swirl: -5.55, length: 1.8, bright: .5, clusters: 15, dust: 850 },
      ];
      nebulaArms = arms;

      // 标定直尾起点：切线方向首次降到“水平向下 10°”的位置（未达到的臂保持纯螺旋）
      for (const arm of arms) {
        const armArc = arm.length * (radiusX - startRadius);
        arm.joinT = 1;
        for (let scan = .55; scan <= 1.0001; scan += .005) {
          const angle = arm.offset + scan * arm.swirl;
          const radius = startRadius + Math.pow(scan, 2.35) * armArc;
          if (radius < radiusX * .65) continue;
          const radialRate = 2.35 * Math.pow(scan, 1.35) * armArc;
          const tangential = radius * Math.abs(arm.swirl);
          const directionX = Math.sin(angle) * tangential + Math.cos(angle) * radialRate;
          const directionY = flatten * (Math.sin(angle) * radialRate - Math.cos(angle) * tangential);
          const tilt = Math.atan2(directionY, directionX);
          if (directionX > 0 && tilt >= 0 && tilt <= Math.PI / 18) { arm.joinT = scan; break; }
        }
        const joinAngle = arm.offset + arm.joinT * arm.swirl;
        const joinRadius = startRadius + Math.pow(arm.joinT, 2.35) * armArc;
        const joinPoint = polarToXY(joinAngle, joinRadius);
        arm.joinX = joinPoint.x;
        arm.joinY = joinPoint.y;
      }

      for (const arm of arms) {
        // 串珠状亮星团：整组作为一支星流，沿臂轨道向核心滑动
        for (let cluster = 0; cluster < arm.clusters; cluster++) {
          const t = Math.min(.995, (cluster + rng() * .9) / arm.clusters);
          const path = armPath(arm, t);
          const point = polarToXY(path.angle, path.radius);
          blit(bakedContext, rng() < .42 ? sprites.warmHaze : sprites.haze, point.x, point.y, (14 + rng() * 40) * (.7 + arm.bright * .5), (.05 + rng() * .07) * arm.bright);

          const members = [];
          const memberCount = 5 + Math.floor(rng() * 12);
          const spread = 2 + rng() * 5.2;
          for (let member = 0; member < memberCount; member++) {
            const roll = rng();
            const hero = member === 0 && rng() < .85;
            members.push({
              dt: gaussian(rng) * spread / (radiusX * .9),
              dr: gaussian(rng) * spread,
              wobble: .4 + rng() * 1.8,
              phase: rng() * Math.PI * 2,
              glow: hero ? 9 + rng() * 11 : 2 + rng() * 3.8,
              alpha: hero ? (.8 + rng() * .2) * Math.min(1, arm.bright + .15) : (.32 + rng() * .5) * arm.bright,
              sprite: pickStarSprite(roll),
              twkPhase: rng() * Math.PI * 2,
              twkSpeed: .5 + rng() * 1.7,
              flare: hero && rng() < .35,
            });
            if (hero) blit(bakedContext, roll < .3 ? sprites.warmHaze : sprites.haze, point.x, point.y, 20 + rng() * 24, .1);
          }
          streams.push({
            offset: arm.offset, swirl: arm.swirl, length: arm.length,
            joinT: arm.joinT, joinX: arm.joinX, joinY: arm.joinY,
            t, speed: .01 + rng() * .012,
            members,
          });
        }

        // 臂内尘埃光带（烘焙）：作为流动粒子的轨道/约束
        for (let index = 0; index < Math.round(arm.dust * density); index++) {
          const t = Math.pow(rng(), .85);
          const path = armPath(arm, t);
          const angle = path.angle + gaussian(rng) * (.02 + t * .016);
          const radius = path.radius + gaussian(rng) * (.8 + t * 2.6);
          const roll = rng();
          const point = polarToXY(angle, radius);
          const sprite = roll < .08 ? sprites.gold : roll < .2 ? sprites.amber : roll < .3 ? sprites.ice : roll < .38 ? sprites.cyan : sprites.dust;
          blit(bakedContext, sprite, point.x, point.y, 1.2 + rng() * 3.2, (.15 + rng() * .5) * arm.bright);
        }

        // 一部分尘埃星也脱离烘焙图，沿轨道向核心流动
        for (let index = 0; index < Math.round(arm.dust * density * .16); index++) {
          const roll = rng();
          const beacon = rng() < .025;
          streams.push({
            offset: arm.offset, swirl: arm.swirl, length: arm.length,
            joinT: arm.joinT, joinX: arm.joinX, joinY: arm.joinY,
            t: rng(),
            speed: .008 + rng() * .014,
            members: [{
              dt: 0,
              dr: gaussian(rng) * (.6 + rng() * 2.4),
              wobble: .3 + rng() * 1.5,
              phase: rng() * Math.PI * 2,
              glow: beacon ? 10 + rng() * 10 : 1.2 + rng() * 2.8,
              alpha: beacon ? .55 + rng() * .3 : (.15 + rng() * .45) * arm.bright,
              sprite: beacon ? pickStarSprite(rng()) : roll < .55 ? sprites.dust : pickStarSprite(roll),
              twkPhase: rng() * Math.PI * 2,
              twkSpeed: .4 + rng() * 1.4,
              flare: beacon,
            }],
          });
        }
      }

      // 盘面弥散星（带轻微自身角速度，慢慢在臂间漂移）
      for (let index = 0; index < Math.round(1400 * density); index++) {
        const angle = rng() * Math.PI * 2;
        const radius = (.14 + Math.pow(rng(), .7) * .9) * radiusX;
        const roll = rng();
        const big = rng() < .05;
        addStar(
          angle, radius,
          big ? 5.5 + rng() * 7 : 1.2 + rng() * 2.4,
          big ? .5 + rng() * .4 : .12 + rng() * .34,
          roll < .45 && !big ? sprites.dust : pickStarSprite(roll),
          rng() < .5,
          false,
          (rng() - .5) * .012,
          true
        );
      }

      // 自由巡游粒子：独立绕转，最“野”的一层，覆盖星系外缘
      for (let index = 0; index < Math.round(2200 * density); index++) {
        const angle = rng() * Math.PI * 2;
        const radius = (.16 + Math.pow(rng(), .72) * 1.3) * radiusX;
        const big = rng() < .08;
        const sprite = big ? pickStarSprite(rng()) : rng() < .3 ? sprites.dust : pickStarSprite(rng());
        addStar(
          angle, radius,
          big ? 6.5 + rng() * 8 : 1.6 + rng() * 2.8,
          big ? .55 + rng() * .4 : .16 + rng() * .38,
          sprite,
          true,
          true,
          (rng() - .5) * .02,
          true
        );
      }

      // 外缘孤星
      for (let index = 0; index < Math.round(130 * density); index++) {
        const angle = rng() * Math.PI * 2;
        const radius = radiusX * (.78 + rng() * .4);
        addStar(
          angle, radius,
          3 + rng() * 4.6,
          .3 + rng() * .5,
          pickStarSprite(rng()),
          true
        );
      }

      // 旋入粒子：最外端生成，向内盘旋加速，贴近核心时淡出消失
      inflows = [];
      for (let index = 0; index < Math.round(280 * density); index++) {
        inflows.push({
          progress: rng(),
          speed: .05 + rng() * .055,
          startAngle: rng() * Math.PI * 2,
          startRadius: radiusX * (.98 + rng() * .07),
          endRadius: radiusX * (.02 + rng() * .03),
          sweep: 3 + rng() * 3.2,
          wobble: .6 + rng() * 1.6,
          phase: rng() * Math.PI * 2,
          glow: 1.7 + rng() * 2.4,
          alpha: .45 + rng() * .45,
          sprite: pickStarSprite(rng()),
        });
      }
    }

    function draw(time) {
      const delta = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0;
      lastTime = time;
      if (!paused && !document.hidden) {
        elapsed += delta;
        for (const particle of inflows) {
          particle.progress += particle.speed * delta;
          if (particle.progress >= 1) {
            particle.progress -= 1;
            particle.startAngle = Math.random() * Math.PI * 2;
            particle.speed = .05 + Math.random() * .055;
            particle.sweep = 3 + Math.random() * 3.2;
            particle.phase = Math.random() * Math.PI * 2;
          }
        }
        for (const stream of streams) {
          stream.t -= stream.speed * delta;
          if (stream.t <= 0) {
            stream.t += 1;
            stream.speed = .01 + Math.random() * .012;
            for (const member of stream.members) member.phase = Math.random() * Math.PI * 2;
          }
        }
        // 旋臂引力：法向拉向臂心线 + 沿臂向核心牵引，让自由星自然聚拢、沿臂流动
        const damp = Math.pow(.99, delta * 60);
        const tau = Math.PI * 2;
        for (const star of twinklers) {
          if (!star.gravity) continue;
          let torque = 0;
          let pull = 0;
          for (const arm of nebulaArms) {
            const arc = arm.length * (nebulaRadiusX - nebulaStartRadius);
            const t = Math.min(1, Math.max(0, Math.pow((star.r - nebulaStartRadius) / arc, 1 / 2.35)));
            let dTheta = star.theta - armPath(arm, t).angle;
            dTheta -= Math.round(dTheta / tau) * tau;
            const distance = Math.abs(dTheta) * star.r;
            if (distance > 240) continue;
            const falloff = Math.exp(-(distance * distance) / 14000);
            torque += (-.95 * dTheta + .06) * falloff * arm.bright;
            pull += -.4 * falloff * arm.bright;
          }
          star.vTheta = (star.vTheta + torque * delta) * damp;
          star.vr = (star.vr + pull * delta) * damp;
          star.theta += (star.omega + star.vTheta) * delta;
          star.r = Math.min(nebulaRadiusX * 1.5, Math.max(nebulaStartRadius * .6, star.r + star.vr * delta));
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
      // 星系固定不旋转，保证 e 形开口始终朝下（仅保留指针位移视差与入场缩放）
      context.translate(nebulaCenterX + pointer.x * 10, nebulaCenterY + pointer.y * 8);
      context.scale(.78 + .22 * ease, .78 + .22 * ease);
      // 烘焙层：最底层轨道纹理（以 hero 坐标绘制，按星系中心偏移贴回）
      context.globalAlpha = masterAlpha * .65;
      context.drawImage(baked, -nebulaCenterX, -nebulaCenterY, width, height);

      for (const star of twinklers) {
        const wobble = elapsed * star.orbSpeed + star.orbPhase;
        const baseAngle = star.gravity ? star.theta : star.a + elapsed * star.omega;
        const angle = baseAngle + star.orbTan * Math.sin(wobble * 1.37 + star.orbPhase2) / Math.max(star.r, 36);
        const radius = star.r + star.orbRad * Math.sin(wobble);
        const { x, y } = polarToXY(angle, radius);
        const pulse = Math.sin(elapsed * star.speed + star.phase);
        const glow = star.glow * (1 + pulse * .14);
        if (star.flare) blit(context, sprites.flare, x, y, glow * 2.8, Math.min(1, masterAlpha * star.alpha * (.22 + pulse * .1) * 1.25));
        context.globalAlpha = Math.min(1, masterAlpha * star.alpha * (.68 + pulse * .32) * 1.25);
        context.drawImage(star.sprite, x - glow / 2, y - glow / 2, glow, glow);
      }

      // 旋臂星流：沿臂（轨道）旋转着滑向核心，核心处淡出、外端重生
      for (const stream of streams) {
        const t = stream.t;
        for (const member of stream.members) {
          const progress = t + member.dt;
          const fade = Math.min(progress / .07, 1) * Math.min((1 - progress) / .08, 1);
          if (fade <= 0) continue;
          const path = armPath(stream, progress);
          const radius = path.radius + member.dr + member.wobble * Math.sin(elapsed * 1.1 + member.phase);
          const { x, y } = polarToXY(path.angle, radius);
          const pulse = Math.sin(elapsed * member.twkSpeed + member.twkPhase);
          const glow = member.glow * (1 + pulse * .14);
          if (member.flare) blit(context, sprites.flare, x, y, glow * 2.8, Math.min(1, masterAlpha * member.alpha * fade * (.22 + pulse * .1) * 1.25));
          context.globalAlpha = Math.min(1, masterAlpha * member.alpha * fade * (.68 + pulse * .32) * 1.25);
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
          const { x, y } = polarToXY(angle, radius);
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
    reducedMotion.addEventListener('change', () => {
      paused = reducedMotion.matches;
      updatePause();
    });
    updatePause();
    initializeNebula();
    document.body.classList.add('scene-ready');
});