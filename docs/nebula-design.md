# 星系实现文档

本文记录 `main.js` 的代码结构、参数、更新顺序和修改方法。星系的整体模型见 [README](../README.md) 的“星系实现”。

- 唯一相关文件：`main.js`（791 行，单文件，无构建）
- 效果参数全部在这一个文件里，没有配置文件、没有 CSS 变量参与

---

## 1. 代码地图

| 行 | 内容 |
| --- | --- |
| 1 | `window.addEventListener('load', …)` 开始，**所有代码都在这个作用域内** |
| 3–7 | DOM 引用：`#universe` `#galaxy-letter` `#pause` `#reset` `#speed` |
| 8 | `reducedMotion` 媒体查询（用 `addEventListener('change')`，需要较新浏览器） |
| 9–12 | 全局可调常量（见第 2 节） |
| 14–42 | 运行状态：`paused` / `motionSpeed` / `elapsed` / 一组 `nebula*` 派生尺寸 / `pointer` |
| 44–48 | `armShift(t)` — 水平偏移 |
| 50–61 | `refreshIcons()` / `updatePause()` — lucide 图标重建、按钮状态同步 |
| 63–75 | `mulberry32(seed)` / `gaussian(rng)` |
| 77–122 | `makeGlowSprite()` / `makeFlareSprite()` / `sprites` 表（11 张） |
| 124–127 | `blit(target, sprite, x, y, size, alpha)` |
| 129–147 | 工具：`cubicBezierEase` / `armT` / `armSpreadAt` / `wrapSpan` |
| 150–212 | `applyDustGravity(sources)` — 格子分桶的平方反比引力 |
| 214–232 | `pickStarSprite` / `pickBrightStarSprite` — 恒星配色加权抽取 |
| 234–263 | `createFreeStar(rand, scatter, dust)` — 自由星工厂 |
| 265–497 | `generateNebula()` — 一次性生成 + 烘焙 |
| 499–739 | `draw(time)` — 每帧更新与绘制 |
| 741–749 | `resetNebula()` |
| 751–773 | `initializeNebula()` — 创建 canvas、`ResizeObserver`、指针监听 |
| 775–789 | 控件事件绑定、启动 |

---

## 2. 常量表

### 全局（第 9–12 行）

| 常量 | 值 | 作用 |
| --- | --- | --- |
| `seed` | `20260921` | 确定性随机种子，改它 = 换一套随机外观 |
| `galaxyZoom` | `2` | 星系整体缩放**上限**（实际值还要受画布余量约束） |
| `starCountScale` | `2` | 所有粒子数量的总倍数 |
| `armSpread` | `1.5` | 臂的横向散布总倍数 |

### 画质与密度（第 273–274 行）

```js
const scale = Math.max(1, Math.min(devicePixelRatio, 2, Math.sqrt(2600000 / (width * height))));
const density = Math.min(1, Math.max(.55, slot.width * slot.height * 6.5 / 150000));
```

- `scale` 是 canvas 的 DPR 倍率，用**画布面积的反比**封顶：像素总数超过约 2.6M 就不再提高倍率。
- `density` 随字母槽面积线性增长，钳制在 `[.55, 1]`：小屏自动减粒子，大屏才吃满。

### 尺寸派生（第 297–311 行）

| 变量 | 表达式 |
| --- | --- |
| `radiusX` | `max(150, slot.width * 1.21)` |
| `radiusY` | `max(128, slot.height * 1.175)` |
| `flatten` | `radiusY / radiusX`（桌面 ≈ .67） |
| `innerRadius` | `radiusX * .2` |
| `nebulaRightBias` | `radiusX * .28` |
| `nebulaWakeRadius` | `radiusX * .24` |
| `nebulaWakeCore` | `radiusX * .055` |
| `nebulaZoom` | `max(1, min(galaxyZoom, leftRoom, rightRoom, verticalRoom))` |

`nebulaZoom` 的三个 room 由星系中心到画布四边的距离反解，保证外臂不被裁掉：

```js
const leftRoom     = nebulaCenterX / radiusX;
const rightRoom    = (width - nebulaCenterX) / (radiusX * 1.28);   // 1.28 是右侧额外偏移的余量
const verticalRoom = Math.min(nebulaCenterY, height - nebulaCenterY) / radiusY;
```

### 骨架（第 374–378 行）

```js
const tailAngle = Math.PI / 3;                 // 尾端停在 5 点方向
const sweep     = Math.PI * 2.8 - Math.PI / 9; // 旋转跨度 ≈ 484°
const arms = [
  { offset: tailAngle + sweep, swirl: -sweep, length: 1, bright: 1, clusters: 60, dust: 2600 },
];
```

`arms` 是数组，但**只有一项**：单臂。改成多项即可变多臂（见第 9 节的改形流程）。

---

## 3. 生成管线 `generateNebula()`

> `generateNebula()` 的执行顺序决定 `rng` 的消费顺序。增删或移动 `rng()` 调用，会改变后续粒子的初始布局。

1. **尺寸与画质**（266–275）：读 `#universe` 与 `#galaxy-letter` 的 `getBoundingClientRect()`。
2. **早退**（270）：`if (baked && width === nebulaWidth && height === nebulaHeight) return;` — 尺寸没变直接返回，避免 `ResizeObserver` 抖动时反复重建。
3. **中心**（276–277）：`nebulaCenterX/Y` = 字母槽中心相对 hero 的坐标。整个星系锚在这里。
4. **离屏 `baked`**（279–285）：建（或复用）离屏 canvas，`setTransform(scale, …)`、`globalCompositeOperation = 'lighter'`、`translate(nebulaCenterX, nebulaCenterY)`。之后所有烘焙绘制都用**星系中心为原点**的坐标。
5. **主 canvas 重置**（287–295）：尺寸、CSS 尺寸、`setTransform`。
6. **派生参数**（296–311）：见第 2 节。
7. **清空**（312–313）：`twinklers = []`、`streams = []`。
8. **两个本地工具**（315–340）：`starPoint(angle, radius, armProgress)` 与 `addStar(…)`。`addStar` 的 `live` 参数决定这个点是进 `twinklers`（动态层）还是直接 `blit` 进 `baked`（静态层）。
9. **核球**（343–351）：5 次 `haze/warmHaze` blit 堆出辉光渐变，加一颗 `radiusX * .2` 的白星。位置用**笛卡尔偏移** `coreOffsetX/Y` 直接给，不走极坐标。
10. **核球星群**（354–372）：`950 · density · starCountScale` 颗，半径按 `rng()^1.7 * radiusX * .17` 分布（幂律 = 中心更密），其中 `12%` 取 `live`，全部带 `coreOffsetX/Y` 偏移。
11. **旋臂**（374–471），对每个 arm 依次：
    - **星团**：`arm.clusters` 个，每个 6–18 颗成员（× `starCountScale`），第 0 颗 85% 概率是 hero 星（`glow 24–52`）。每个星团同时进 `baked`（雾光）与 `streams`（流动）。
    - **尘埃光带**（426–434）：`arm.dust · density · starCountScale` 颗，全部烘焙，构成轨道的可见纹理。
    - **流动尘埃**（437–459）：上面的 `40%`，作为单成员 `streams`。
    - **自由小星**（462–464）：`1700 · density · starCountScale` 颗 `createFreeStar(rng)`。
    - **自由尘埃**（467–469）：`700 · …` 颗，`scatter = 3`（离轨更远、更暗、更小）。
12. **背景星板**（473–495）：`1210 · density · starCountScale` 颗。**放在最后**，这样以后调整背景星数量不会打乱前面旋臂的随机序列。
13. **`inflows = []`**（496）：死代码，见第 11 节。

### `armT` 与 `armSpreadAt` 的用法区别

```js
function armT(u)       { return Math.pow(u, .6); }       // 采样：把 u 重新分布到弧长上
function armSpreadAt(t){ return .35 + .65 * Math.min(1, Math.max(0, t)); } // 散布：越靠核心越紧
```

- `armT` 只用在**生成**时（采样的分布）。
- `armSpreadAt` 只用在**散布量**的缩放上（生成与每帧都用到）。

---

## 4. 坐标与骨架公式

### 轨道参数 → 屏幕坐标

```
θ = offset + t · swirl
r = innerRadius + t^0.95 · length · (radiusX − innerRadius)
x = cos(θ) · r + armShift(t)
y = sin(θ) · r · flatten
```

`armShift` 是那段打破旋转对称的水平偏移：

```js
function armShift(t) {
  const progress = Math.min(1, Math.max(0, t));
  const smooth = progress * progress * (3 - 2 * progress);   // smoothstep
  return smooth * nebulaRightBias;
}
```

### 坐标转换

`applyDustGravity` 使用笛卡尔坐标做空间分桶。粒子状态保存为 `theta / r`，需要笛卡尔坐标时正向计算：

```js
xs[i] = Math.cos(star.theta) * star.r + armShift(progress);
ys[i] = Math.sin(star.theta) * star.r;
```

### 变换层级（每帧绘制时）

```
画布
└── translate(nebulaCenterX + pointer.x * 10, nebulaCenterY + pointer.y * 8)
    └── scale(zoom, zoom)
        ├── 背景星板
        ├── baked（额外 translate(-nebulaCenterX, -nebulaCenterY) 贴回 hero 坐标）
        └── twinklers / streams / inflows
```

注意 `baked` 的坐标原点是 hero 左上角，而其他层原点是星系中心——所以贴回时要减掉中心偏移。

---

## 5. 生命周期

### `streams`（无状态，只有参数）

```js
stream.t -= stream.speed * motionDelta;
if (stream.t <= 0) {
  stream.t += 1;                                   // 回外端重生
  stream.speed = .01 + Math.random() * .012;
  for (const member of stream.members) member.phase = Math.random() * Math.PI * 2;
}
```

绘制时的两段淡入淡出（第 699–702 行）：

```js
const outerFade = member.glow >= 10 ? .3 : .08;                       // 大星更早淡入
const fade = Math.min(progress / .035, 1) * Math.min((1 - progress) / outerFade, 1);
const brightStarFade = member.glow >= 10 ? cubicBezierEase(progress / .32) : 1;
```

`outerFade` 让大星团比普通成员更早进入可见区。

### `twinklers`（有寿命，会回收）

```js
star.age += motionDelta;
if (star.age >= star.life || star.r <= coreClearRadius) {
  twinklers[index] = createFreeStar(Math.random, star.scatter, star.dust);   // 原地替换，不增删数组
}
```

- `life = 8 + rand() * 11.2` 秒。
- `coreClearRadius = nebulaStartRadius * 1.4`。被中心引力拖进核心就回收。
- 原地替换，不使用 `splice`：数组长度保持不变。
- 重生使用 `Math.random`，初始布局仍由 `rng` 控制。

---

## 6. 每帧物理（`draw()` 第 500–640 行）

### 顺序

```
入场进度 / pointer 平滑
└── 若 !paused && !document.hidden：
    1. inflows 推进
    2. streams 推进（t -= speed · motionDelta）
    3. 构造 wakeSources
    4. applyDustGravity(wakeSources)
    5. 遍历 twinklers 积分：
       wake 耦合 → 鼠标斥力 → 尘埃引力 → 中心引力 → 径向弹簧 → 阻尼 → 积分 → 钳制 → 回收
```

### 各步对应代码

| 步 | 代码位置 | 说明 |
| --- | --- | --- |
| wake 耦合 | 608–616 | `targetOmega = tangentSpeed / totalWeight / radius`，再以 `coupling = min(3, totalWeight * 1.4) · dt` 向它收敛 |
| 鼠标斥力 | 592–606 | **速度场**而非力：算出目标推开速度，用 `grip = min(1, 4 · dt)` 把当前速度带过去 |
| 尘埃引力 | 617–623 | 把 `star.gx/gy`（`applyDustGravity` 累加的加速度）投影到极坐标分量 |
| 中心引力 | 624–627 | `pull = radiusX² · .14 · r / (r² + ε²)^1.5`，Plummer 软化，`ε = radiusX · .18` |
| 径向弹簧 | 628–629 | `star.vr += (star.homeR - star.r) * .45 * dt` |
| 阻尼 | 630–631 | `damp = Math.pow(.992, motionDelta * 60)`，**按帧率归一** |
| 积分 | 632–633 | `theta += (omega + vTheta) · dt`；然后钳制 `r ∈ [innerRadius * .6, radiusX * 1.5]` |
| 回收 | 635–638 | `age >= life` 或 `r <= coreClearRadius` 时原地替换 |

### `wakeSources` 的解析导数

这是文件中对骨架求导的代码（第 537–558 行），用于计算亮星团的瞬时速度方向：

```js
const radialSlope = .95 * Math.pow(progress, -.05) * stream.length * (nebulaRadiusX - nebulaStartRadius);
const shiftSlope  = 6 * progress * (1 - progress) * nebulaRightBias;   // smoothstep 的导数
const dxdt = -Math.sin(angle) * stream.swirl * radius + Math.cos(angle) * radialSlope + shiftSlope;
const dydt =  Math.cos(angle) * stream.swirl * radius + Math.sin(angle) * radialSlope;
```

对 `x = cos θ · r + armShift(t)` 关于 `t` 求导后，三项分别对应 `θ`、`r` 和 `armShift` 的变化。由于 `t` 递减，速度取负：

```js
vx: -stream.speed * dxdt,  vy: -stream.speed * dydt
```

改动骨架公式后，同步更新这两行。

### `applyDustGravity`（第 150–212 行）

| 项 | 值 | 作用 |
| --- | --- | --- |
| `cellSize` | `nebulaRadiusX * .1` | 分桶边长 = 截断半径 |
| 桶范围 | 3×3 邻域 | 因为 `cellSize` 就等于截断半径，检查相邻 9 个桶即可覆盖全部影响 |
| `soft2` | `(radiusX * .02)²` | Plummer 软化，防 `r→0` 数值爆炸 |
| `gravityG` | `radiusX² * .00008` | 引力常数（随尺度平方缩放，保证不同屏幕大小观感一致） |
| 质量 | 源 `1 + strength * 12`，星 `1` | wake 源比普通星重得多 |
| 截断 | `cutoff2 = cellSize²` | 超过就不算 |

数据结构是**链表式空间哈希**：`head[cell]` + `next[i]`，两个 `Int32Array` + 两个 `Float32Array`，无对象分配。

---

## 7. 每帧绘制（第 645–739 行）

变换栈：`translate(中心 + 视差)` → `scale(zoom)`。

| 顺序 | 图层 | alpha | 备注 |
| --- | --- | --- | --- |
| 1 | 背景星板 `backStars` | `masterAlpha · alpha · (.6 + pulse·.3)` | 越界**对侧绕回**，绕回线在可见区外 |
| 2 | 烘焙层 `baked` | `masterAlpha · .65` | 需再 `translate(-nebulaCenterX, -nebulaCenterY)` |
| 3 | `twinklers` | `masterAlpha · alpha · (.68 + pulse·.32) · 1.25` | 带 `flare` 的先叠一层星芒 |
| 4 | `streams` | `masterAlpha · alpha · fade · brightStarFade²` | 见第 5 节 |
| 5 | `inflows` | — | **当前恒为空** |

`masterAlpha = .15 + .85 * ease`，`ease` 是 1700ms 的入场缓动。所有层都乘它，所以入场是"整体淡入 + 缩放"，不需要给每个粒子单独做。

`masterAlpha` 之外还有几个统一的可见性系数值得注意：

- 动态层普遍乘 `1.25`（相对烘焙层提亮，让流动的星跳出来）
- `baked` 乘 `.65`（压暗，避免静态纹理盖过动态层）

---

## 8. 交互绑定（第 741–789 行）

| 事件 | 行为 |
| --- | --- |
| `#pause` click | 切换 `paused`，重绘图标（`updatePause`） |
| `#reset` click | `introStart = performance.now()`，指针归零 → 重播入场 |
| `#speed` input | `motionSpeed = Number(value)`（`.25`–`1`，默认 `.55`） |
| `hero` pointermove | 归一化到 `[-.5, .5]` 存入 `pointer.targetX/Y` |
| `hero` pointerleave | 归零并 `active = false` |
| `reducedMotion` change | 跟随系统设置切换 `paused` |
| `ResizeObserver`(`.hero`) | 调 `generateNebula()`（内部有尺寸早退） |

指针的平滑与坐标换算（第 507–512 行）：

```js
pointer.strength += ((pointer.active ? 1 : 0) - pointer.strength) * .05;
const cursorX = ((pointer.x + .5) * nebulaWidth  - (nebulaCenterX + pointer.x * 10)) / zoomNow;
const cursorY = ((pointer.y + .5) * nebulaHeight - (nebulaCenterY + pointer.y * 8))  / zoomNow / nebulaFlatten;
```

这里将指针从屏幕坐标换算到星系物理坐标。改视差系数 `10 / 8` 时同步修改这两行。

---

## 9. 改形流程

### 想改旋臂的形状

1. 改 `tailAngle`（尾端朝向）与 `sweep`（跨度）。两者都在第 374–375 行。
2. 改了 `swirl` 的符号或大小后，检查 `wakeSources` 的导数公式（第 6 节）。
3. 改 `radiusX / radiusY` 的倍数调整体大小；改 `innerRadius` 的系数调内圈空出的区域。

### 想改成多臂

`arms` 已经是数组，加一项即可：

```js
const arms = [
  { offset: tailAngle + sweep,        swirl: -sweep,        length: 1,   bright: 1,   clusters: 60, dust: 2600 },
  { offset: tailAngle + sweep + Math.PI, swirl: -sweep,     length: .85, bright: .5,  clusters: 30, dust: 1200 },
];
```

当前生成循环会把 `nebulaArm` 覆写成最后一个 arm（第 383 行 `nebulaArm = arm;`），`createFreeStar` 使用它决定自由星所属的旋臂。改成多臂时，应在循环内把对应 arm 传给 `createFreeStar`。

### 调参速查

| 想改什么 | 改哪里 | 当前值 |
| --- | --- | --- |
| 星系整体大小 | `radiusX` / `radiusY` 的倍数 | `* 1.21` / `* 1.175` |
| 臂的疏密 | `arm.clusters` / `arm.dust` | `60` / `2600` |
| 臂的横向宽度 | `armSpread` + `armSpreadAt()` | `1.5` / `.35+.65t` |
| 粒子总量 | `starCountScale` | `2` |
| 小屏减负 | `density` 公式 | `area·6.5/150000`，钳制 `.55–1` |
| 大屏像素上限 | `scale` 公式里的常数 | `2600000` |
| 自由星数量 | 生成循环里的 `1700` / `700` | — |
| 引力强度 | `gravityG` / 中心引力 `.14` | `radiusX²·8e-5` |
| 弹簧强度 | 系数 `.45` | — |
| 阻尼 | `.992`（按 60fps 归一） | — |
| 鼠标影响范围 | `nebulaRadiusX * .45` + 基准速度 `.05` | — |
| 鼠标手感 | `grip = min(1, 4 · dt)` 里的 `4` | — |
| 入场时长 | `1700` / `zoomNow` 的 `.78 + .22` | — |
| 星流速度 | `stream.speed` 的 `.008–.022` | — |
| 自由星寿命 | `life = 8 + rnd·11.2` | — |
| 换一套随机外观 | `seed` | `20260921` |

---

## 10. 已知的坑

1. **随机数顺序**。在 `generateNebula()` 中插入 `rng()` 会改变后续粒子的初始布局。需要保持布局不变时，把新调用放在随机序列末尾，或使用单独的 `mulberry32` 实例。
2. **积分使用 `dt`**。`damp` 使用 `Math.pow(.992, dt * 60)`，新增速度或位置更新时也乘 `dt`。
3. **`inflows` 当前为空**。推进循环每帧执行，但数组没有成员。见第 11 节。
4. **`nebulaArm` 假设单臂**。见第 9 节。
5. 重命名数组或变量后，全局搜索旧标识符。`get_errors` 不一定报告运行时的裸标识符错误。

---

## 11. 死代码与待办

- **`inflows`（旋入粒子层）**：第 516–521 行有推进逻辑、第 719–735 行有绘制逻辑（3 段拖尾、`startRadius`/`endRadius`/`sweep`/`wobble` 全部在），但**没有任何地方 `push`**，`inflows` 在第 496 行被清空后再也没被填充。要么补生成（外缘取随机 `startAngle`、`startRadius ≈ radiusX`、`endRadius ≈ innerRadius`），要么删掉这一层。
- **`arm.bright` 恒为 1**：保留的字段，亮度按臂区分用的，当前单臂下是常量。
- **`length` 恒为 1**：同上。