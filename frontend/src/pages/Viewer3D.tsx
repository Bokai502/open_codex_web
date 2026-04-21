import { useEffect, useRef } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"

// Force semi-transparent on every material with correct depth/blending settings
function applyTransparency(mat: THREE.Material, opacity = 0.20) {
  mat.transparent = true
  mat.opacity = opacity
  // depthWrite=false prevents transparent surfaces from blocking each other
  mat.depthWrite = false
  mat.side = THREE.DoubleSide
  if (
    mat instanceof THREE.MeshStandardMaterial ||
    mat instanceof THREE.MeshPhysicalMaterial
  ) {
    mat.roughness = Math.min(mat.roughness, 0.35)
    mat.metalness = Math.max(mat.metalness, 0.05)
    // Boost env-map contribution for glassy look
    mat.envMapIntensity = 1.8
  }
  mat.needsUpdate = true
}

export default function Viewer3D() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current!
    const w = mount.clientWidth
    const h = mount.clientHeight

    // ── Renderer ────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(w, h)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.4
    mount.appendChild(renderer.domElement)

    // ── Scene ───────────────────────────────────────────────────────────
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d0d1a)

    // IBL: RoomEnvironment gives ambient reflections that make glass look real
    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex
    pmrem.dispose()

    // Subtle fog
    scene.fog = new THREE.FogExp2(0x0d0d1a, 0.018)

    // ── Camera ──────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000)
    camera.position.set(3, 2, 5)

    // ── Lights ──────────────────────────────────────────────────────────
    // Key light (warm, casts shadows)
    const keyLight = new THREE.DirectionalLight(0xfff4e0, 2.0)
    keyLight.position.set(6, 12, 8)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(2048, 2048)
    keyLight.shadow.bias = -0.0005
    keyLight.shadow.camera.near = 0.5
    keyLight.shadow.camera.far = 80
    keyLight.shadow.camera.left = -10
    keyLight.shadow.camera.right = 10
    keyLight.shadow.camera.top = 10
    keyLight.shadow.camera.bottom = -10
    scene.add(keyLight)

    // Fill light (cool blue, from opposite side)
    const fillLight = new THREE.DirectionalLight(0x7ecfff, 0.8)
    fillLight.position.set(-8, 4, -6)
    scene.add(fillLight)

    // Rim light (backlight, highlights transparent edges)
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.0)
    rimLight.position.set(0, -4, -10)
    scene.add(rimLight)

    // Ambient (very low, IBL handles most indirect light)
    const ambient = new THREE.AmbientLight(0xffffff, 0.25)
    scene.add(ambient)

    // Coloured point lights for dramatic interior glow
    const pointA = new THREE.PointLight(0x4488ff, 3.0, 15)
    pointA.position.set(-2, 3, 2)
    scene.add(pointA)

    const pointB = new THREE.PointLight(0xff6644, 2.0, 12)
    pointB.position.set(3, 1, -2)
    scene.add(pointB)

    // ── Grid / Ground ───────────────────────────────────────────────────
    const grid = new THREE.GridHelper(30, 60, 0x223355, 0x111833)
    scene.add(grid)


    // ── Controls ─────────────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 0.3
    controls.maxDistance = 150

    // ── Loading spinner ──────────────────────────────────────────────────
    let loadingMesh: THREE.Mesh | null = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.05, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }),
    )
    scene.add(loadingMesh)

    // ── Load GLB ─────────────────────────────────────────────────────────
    const loader = new GLTFLoader()
    loader.load(
      "/models/test3.glb",
      (gltf) => {
        if (loadingMesh) {
          scene.remove(loadingMesh)
          loadingMesh.geometry.dispose()
          ;(loadingMesh.material as THREE.Material).dispose()
          loadingMesh = null
        }

        const model = gltf.scene

        model.traverse((node) => {
          const mesh = node as THREE.Mesh
          if (!mesh.isMesh) return

          mesh.castShadow = true
          mesh.receiveShadow = true

          // Apply semi-transparency + correct blending to every material
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => applyTransparency(m))
          } else {
            applyTransparency(mesh.material)
          }

          // Transparent meshes must render after opaque scene objects
          mesh.renderOrder = 1
        })

        // Auto-center and fit
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = 3.5 / maxDim
        model.scale.setScalar(scale)
        model.position.sub(center.multiplyScalar(scale))

        // Sit on ground
        const box2 = new THREE.Box3().setFromObject(model)
        model.position.y -= box2.min.y

        scene.add(model)

        // Move point lights to surround the model
        const sphere = new THREE.Sphere()
        new THREE.Box3().setFromObject(model).getBoundingSphere(sphere)
        const r = sphere.radius
        const c = sphere.center
        pointA.position.set(c.x - r * 1.2, c.y + r * 0.8, c.z + r)
        pointB.position.set(c.x + r, c.y + r * 0.2, c.z - r * 1.2)

        // Fit camera to model
        camera.position.set(c.x + r * 2.2, c.y + r * 1.4, c.z + r * 2.2)
        controls.target.copy(c)
        controls.update()
      },
      undefined,
      (err) => console.error("GLB load error:", err),
    )

    // ── Animate ───────────────────────────────────────────────────────────
    let animId: number
    const clock = new THREE.Clock()
    const animate = () => {
      animId = requestAnimationFrame(animate)
      const t = clock.getElapsedTime()

      if (loadingMesh) loadingMesh.rotation.z += 0.04

      // Slowly pulse the point lights for a living-glow effect
      pointA.intensity = 3.0 + Math.sin(t * 1.2) * 0.8
      pointB.intensity = 2.0 + Math.sin(t * 0.9 + 1.5) * 0.6

      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // ── Resize ────────────────────────────────────────────────────────────
    const onResize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(animId)
      controls.dispose()
      envTex.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#0d0d1a", position: "relative" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px",
        background: "linear-gradient(to bottom, rgba(5,5,20,0.85), transparent)",
        pointerEvents: "none",
      }}>
        <span style={{ color: "#c8d8ff", fontFamily: "system-ui", fontSize: 15, fontWeight: 600, letterSpacing: "0.04em" }}>
          3D Viewer — test3.glb
        </span>
        <a href="/" style={{
          color: "#90caf9", fontFamily: "system-ui", fontSize: 13,
          textDecoration: "none", pointerEvents: "auto",
          padding: "4px 12px", borderRadius: 6,
          border: "1px solid rgba(144,202,249,0.3)",
          background: "rgba(0,0,0,0.35)",
        }}>
          ← Back
        </a>
      </div>

      <div style={{
        position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
        color: "rgba(180,200,255,0.45)", fontFamily: "system-ui", fontSize: 12,
        background: "rgba(0,0,0,0.3)", padding: "6px 16px", borderRadius: 20,
        pointerEvents: "none", whiteSpace: "nowrap",
      }}>
        左键旋转 · 右键平移 · 滚轮缩放
      </div>
    </div>
  )
}
