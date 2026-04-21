官方例子（webgpu_tsl_earth.html ）

我的代码 [threejs/local-study/sixth-stage/5.美化地球.html at main · heasia7227/threejs](https://link.zhihu.com/?target=https%3A//github.com/heasia7227/threejs/blob/main/local-study/sixth-stage/5.%25E7%25BE%258E%25E5%258C%2596%25E5%259C%25B0%25E7%2590%2583.html)

**用到了[Three.Webgpu](https://zhida.zhihu.com/search?content_id=255228896&content_type=Article&match_order=1&q=Three.Webgpu&zhida_source=entity)模块**

```js
<script type="importmap">
	{
		"imports": {
			"three": "../js/three.webgpu.js",
			"three/addons/": "../js/jsm/",
			"three/webgpu": "../js/three.webgpu.js",
			"three/tsl": "../js/three.tsl.js"
		}
	}
</script>
```

## 第一步：创建一个球

```js
// 地球模型
const earthModel = (sunModel) => {
    // 地球
    const earthGeometry = new THREE.SphereGeometry(1, 64, 64);

    // 地球材质
    // 在Three.js中，PMREM主要用于环境映射照明。使用标准的HDRI纹理时，可能会遇到周围的照明问题，导致阴影完全黑色。而使用PMREMGenerator可以解决这个问题
    // MeshStandardNodeMaterial 属于 PMREM
    const earthMaterial = new THREE.MeshStandardNodeMaterial();

    const bumpRoughnessClouds = getBumpRoughnessClouds();

    earthMaterial.colorNode = getTextureDay(bumpRoughnessClouds.cloudsStrength); // 白天的贴图
    earthMaterial.outputNode = getTextureNight(sunModel); // 夜晚的贴图
    earthMaterial.roughnessNode = getTextureRoughness(bumpRoughnessClouds); // 粗糙度的贴图
    earthMaterial.normalNode = getTextureNormal(bumpRoughnessClouds); // 法线的贴图

    // 地球网格模型
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);

    // 设置地球的倾斜角度
    earthMesh.rotateX(-Math.PI / 7.6);

    return earthMesh;
};
```

## 第二步：设置白天的贴图

```js
const getTextureDayJpg = () => {
    // 贴图, 白天
    const dayTexture = textureLoader.load("earth_day_4096.jpg");
    dayTexture.colorSpace = THREE.SRGBColorSpace; // 设置为SRGB颜色空间
    dayTexture.anisotropy = 8; // 数值越大Map越清晰，默认值1

    return dayTexture;
};

const getTextureBumpRoughnessCloudsJpg = () => {
    const bumpRoughnessCloudsTexture = textureLoader.load("earth_bump_roughness_clouds_4096.jpg");
    bumpRoughnessCloudsTexture.anisotropy = 8;

    return bumpRoughnessCloudsTexture;
};

// 云层的影响力和贴图
const getBumpRoughnessClouds = () => {
    // 贴图，云层
    const bumpRoughnessCloudsTexture = getTextureBumpRoughnessCloudsJpg();

    // uv 创建一个UV属性Node
    // texture: 创建一个texture node，返回TextureNode
    // smoothstep: 在两个值之间执行埃尔米特插值，返回Node
    const cloudsStrength = texture(bumpRoughnessCloudsTexture, uv()).b.smoothstep(0.2, 1);
    return { cloudsStrength, bumpRoughnessCloudsTexture };
};

// 白天的贴图
const getTextureDay = (cloudsStrength) => {
    // 贴图, 白天
    const dayTexture = getTextureDayJpg();

    // colorNode: 设置轮廓颜色，Node<vec3>类型
    // mix: 在两个值之间线性插值，返回Node
    // vec3: ???
    // mul: 返回两个或多个值的乘法
    const colorNode = mix(texture(dayTexture), vec3(1), cloudsStrength.mul(2));

    return colorNode;
};
```

## 第三步：计算大气层

```js
// 大气层白天颜色
const atmosphereDayColor = uniform(color("#4db2ff"));
// 大气层夜晚颜色（暮色）
const atmosphereTwilightColor = uniform(color("#bc490b"));

// 大气层颜色
const getAtmosphereColor = (sunModel) => {
    // 太阳光的方向
    const sunOrientation = sunModel.sunOrientation;

    // 大气层颜色
    const atmosphereColor = mix(atmosphereTwilightColor, atmosphereDayColor, sunOrientation.smoothstep(-0.25, 0.75));

    return atmosphereColor;
};
```

## 第四步：设置夜晚的贴图

```js
// 夜晚的贴图
const getTextureNight = (sunModel) => {
    // 贴图，加载器
    const textureLoader = new THREE.TextureLoader().setPath("./textures/");

    // 贴图，夜晚
    const nightTexture = textureLoader.load("earth_night_4096.jpg");
    nightTexture.colorSpace = THREE.SRGBColorSpace;
    nightTexture.anisotropy = 8;

    // 大气层颜色
    const atmosphereColor = getAtmosphereColor(sunModel);

    const fresnel = getFresnel();
    // 夜晚贴图
    const night = texture(nightTexture);
    // 太阳光白天的影响力
    const sunDayStrength = sunModel.sunOrientation.smoothstep(-0.25, 0.5);

    // 大气层白天的影响力
    const atmosphereDayStrength = sunModel.sunOrientation.smoothstep(-0.5, 1);
    const atmosphereMix = atmosphereDayStrength.mul(fresnel.pow(2)).clamp(0, 1);

    let finalOutput = mix(night.rgb, output.rgb, sunDayStrength);
    finalOutput = mix(finalOutput, atmosphereColor, atmosphereMix);

    // outputNode: 设置最终输出的材质
    // vec4: ???
    const outputNode = vec4(finalOutput, output.a);

    return outputNode;
};
```

## 第五步：设置粗糙度的贴图

```js
// 粗糙度的贴图
const getTextureRoughness = (bumpRoughnessClouds) => {
    const roughness = max(
        texture(bumpRoughnessClouds.bumpRoughnessCloudsTexture).g,
        step(0.01, bumpRoughnessClouds.cloudsStrength)
    );
    const roughnessNode = roughness.remap(0, 1, roughnessLow, roughnessHigh);
    return roughnessNode;
};
```

## 第六步：设置法线的贴图

```js
// 法线的贴图
const getTextureNormal = (bumpRoughnessClouds) => {
    const bumpElevation = max(
        texture(bumpRoughnessClouds.bumpRoughnessCloudsTexture).r,
        bumpRoughnessClouds.cloudsStrength
    );
    const normalNode = bumpMap(bumpElevation);

    return normalNode;
};
```

## 第七步：把地球添加到3D场景

```js
// 3D场景
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // 渲染场景背景

// 太阳
const sun = sunModel();
scene.add(sun.sunLight);

const earthGroup = new THREE.Group();
// 地球
const earth = earthModel(sun);
earthGroup.add(earth);
// 地球大气层
const atmosphere = atmosphereModel(sun, earth);
earthGroup.add(atmosphere);

scene.add(earthGroup);

// 相机
const camera = new THREE.PerspectiveCamera(25, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(4.5, 2, 3);

const renderer = new THREE.WebGPURenderer();
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.1;
controls.maxDistance = 50;

// 动画函数
function animate() {
    earthGroup.rotation.y += 0.001;

    renderer.render(scene, camera); //执行渲染操作
}
```
