import { useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

type AnnotationPalette = {
  dot: string
  line: string
  text: string
  tint: string
}

type PartAnnotation = {
  anchorWorld: THREE.Vector3
  dotEl: SVGCircleElement
  id: string
  labelEl: HTMLDivElement
  lineEl: SVGPolylineElement
  palette: AnnotationPalette
}

const ANNOTATION_PALETTES: AnnotationPalette[] = [
  {
    dot: "#a995ff",
    line: "rgba(169, 149, 255, 0.72)",
    text: "#7366cf",
    tint: "rgba(245, 241, 255, 0.94)",
  },
  {
    dot: "#e3b070",
    line: "rgba(227, 176, 112, 0.7)",
    text: "#b67d42",
    tint: "rgba(255, 248, 238, 0.94)",
  },
  {
    dot: "#bcc5df",
    line: "rgba(188, 197, 223, 0.64)",
    text: "#606a88",
    tint: "rgba(248, 249, 253, 0.94)",
  },
]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isMeshObject(node: THREE.Object3D) {
  return (node as THREE.Mesh).isMesh === true
}

function hasRenderableDescendant(node: THREE.Object3D) {
  let renderable = false

  node.traverse((child) => {
    if (renderable) return
    if (isMeshObject(child)) {
      renderable = true
    }
  })

  return renderable
}

function findComponentContainerRoot(root: THREE.Object3D) {
  let current = root

  while (
    current.children.length === 1 &&
    !isMeshObject(current.children[0]) &&
    !isMeshObject(current)
  ) {
    current = current.children[0]
  }

  return current
}

function normalizeComponentLabel(name: string) {
  return name
    .replace(/(?:[_\s-]+)?(part|component|group)$/i, "")
    .trim()
}

function resolveComponentLabel(componentRoot: THREE.Object3D) {
  const rootLabel = normalizeComponentLabel(componentRoot.name)
  if (rootLabel) return rootLabel

  if (componentRoot.children.length === 1) {
    const childLabel = normalizeComponentLabel(componentRoot.children[0].name)
    if (childLabel) return childLabel
  }

  const namedDescendant = componentRoot.children.find((child) =>
    hasRenderableDescendant(child) && child.name.trim().length > 0,
  )
  if (namedDescendant) return normalizeComponentLabel(namedDescendant.name)

  return ""
}

function collectComponentRoots(root: THREE.Object3D) {
  const containerRoot = findComponentContainerRoot(root)
  const componentRoots = containerRoot.children.filter((child) =>
    hasRenderableDescendant(child),
  )

  if (componentRoots.length > 0) return componentRoots
  return hasRenderableDescendant(containerRoot) ? [containerRoot] : []
}

function distributeLabelTops(
  items: Array<{ desiredTop: number; height: number }>,
  safeTop: number,
  safeBottom: number,
  gap: number,
) {
  if (items.length === 0) return []

  const tops: number[] = []
  let cursor = safeTop

  for (const item of items) {
    const maxTop = safeBottom - item.height
    const desiredTop = clamp(item.desiredTop, safeTop, maxTop)
    const nextTop = Math.max(desiredTop, cursor)
    tops.push(nextTop)
    cursor = nextTop + item.height + gap
  }

  const lastIndex = tops.length - 1
  const overflow = tops[lastIndex] + items[lastIndex].height - safeBottom

  if (overflow > 0) {
    tops[lastIndex] -= overflow

    for (let index = tops.length - 2; index >= 0; index -= 1) {
      const maxTop = tops[index + 1] - items[index].height - gap
      tops[index] = Math.min(tops[index], maxTop)
    }

    if (tops[0] < safeTop) {
      const shift = safeTop - tops[0]
      for (let index = 0; index < tops.length; index += 1) {
        tops[index] += shift
      }
    }
  }

  return tops.map((top, index) =>
    clamp(top, safeTop, safeBottom - items[index].height),
  )
}

function createAnnotationLabel(id: string, palette: AnnotationPalette) {
  const labelEl = document.createElement("div")
  labelEl.style.position = "absolute"
  labelEl.style.display = "flex"
  labelEl.style.alignItems = "center"
  labelEl.style.gap = "8px"
  labelEl.style.padding = "5px 10px"
  labelEl.style.border = "1px solid rgba(214, 220, 238, 0.92)"
  labelEl.style.borderLeft = `3px solid ${palette.dot}`
  labelEl.style.borderRadius = "4px"
  labelEl.style.background = palette.tint
  labelEl.style.boxShadow = "0 10px 34px rgba(12, 18, 40, 0.18)"
  labelEl.style.backdropFilter = "blur(6px)"
  labelEl.style.pointerEvents = "none"
  labelEl.style.userSelect = "none"
  labelEl.style.whiteSpace = "nowrap"
  labelEl.style.transform = "translate(-9999px, -9999px)"
  labelEl.style.opacity = "0"

  const capEl = document.createElement("span")
  capEl.style.width = "7px"
  capEl.style.height = "7px"
  capEl.style.borderRadius = "999px"
  capEl.style.background = palette.dot
  capEl.style.boxShadow = `0 0 0 5px ${palette.line.replace("0.72", "0.14").replace("0.7", "0.14").replace("0.64", "0.14")}`
  labelEl.appendChild(capEl)

  const textEl = document.createElement("span")
  textEl.textContent = id
  textEl.style.color = palette.text
  textEl.style.fontFamily = "\"IBM Plex Mono\", \"SFMono-Regular\", Consolas, monospace"
  textEl.style.fontSize = "12px"
  textEl.style.fontWeight = "700"
  textEl.style.letterSpacing = "0.18em"
  textEl.style.textTransform = "uppercase"
  labelEl.appendChild(textEl)

  return labelEl
}

function applyTransparency(material: THREE.Material, opacity = 0.2) {
  material.transparent = true
  material.opacity = opacity
  material.depthWrite = false
  material.side = THREE.DoubleSide

  if (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhysicalMaterial
  ) {
    material.roughness = Math.min(material.roughness, 0.35)
    material.metalness = Math.max(material.metalness, 0.05)
    material.envMapIntensity = 1.8
  }

  material.needsUpdate = true
}

export default function Viewer3D() {
  const mountRef = useRef<HTMLDivElement>(null)
  const annotationSvgRef = useRef<SVGSVGElement>(null)
  const annotationLabelsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    const annotationSvg = annotationSvgRef.current
    const annotationLabels = annotationLabelsRef.current

    if (!mount || !annotationSvg || !annotationLabels) return

    const width = mount.clientWidth
    const height = mount.clientHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.4
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d0d1a)

    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex
    pmrem.dispose()

    scene.fog = new THREE.FogExp2(0x0d0d1a, 0.018)

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000)
    camera.position.set(3, 2, 5)

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

    const fillLight = new THREE.DirectionalLight(0x7ecfff, 0.8)
    fillLight.position.set(-8, 4, -6)
    scene.add(fillLight)

    const rimLight = new THREE.DirectionalLight(0xffffff, 1.0)
    rimLight.position.set(0, -4, -10)
    scene.add(rimLight)

    const ambient = new THREE.AmbientLight(0xffffff, 0.25)
    scene.add(ambient)

    const pointA = new THREE.PointLight(0x4488ff, 3.0, 15)
    pointA.position.set(-2, 3, 2)
    scene.add(pointA)

    const pointB = new THREE.PointLight(0xff6644, 2.0, 12)
    pointB.position.set(3, 1, -2)
    scene.add(pointB)

    const grid = new THREE.GridHelper(30, 60, 0x223355, 0x111833)
    scene.add(grid)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 0.3
    controls.maxDistance = 150

    let loadingMesh: THREE.Mesh | null = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.05, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }),
    )
    scene.add(loadingMesh)

    const annotations: PartAnnotation[] = []
    const screenPoint = new THREE.Vector3()
    const cameraSpacePoint = new THREE.Vector3()

    const hideAnnotation = (annotation: PartAnnotation) => {
      annotation.labelEl.style.opacity = "0"
      annotation.labelEl.style.transform = "translate(-9999px, -9999px)"
      annotation.lineEl.style.display = "none"
      annotation.dotEl.style.display = "none"
    }

    const clearAnnotations = () => {
      annotations.splice(0, annotations.length)
      annotationLabels.replaceChildren()
      annotationSvg.replaceChildren()
    }

    const layoutAnnotations = () => {
      if (annotations.length === 0) return

      const viewportWidth = mount.clientWidth
      const viewportHeight = mount.clientHeight
      const safeTop = 86
      const safeBottom = viewportHeight - 28
      const sidePadding = 26
      const labelGap = 10

      annotationSvg.setAttribute("viewBox", `0 0 ${viewportWidth} ${viewportHeight}`)

      const visible = annotations
        .map((annotation) => {
          screenPoint.copy(annotation.anchorWorld).project(camera)
          cameraSpacePoint
            .copy(annotation.anchorWorld)
            .applyMatrix4(camera.matrixWorldInverse)

          if (
            screenPoint.z < -1 ||
            screenPoint.z > 1 ||
            screenPoint.x < -1.4 ||
            screenPoint.x > 1.4 ||
            screenPoint.y < -1.4 ||
            screenPoint.y > 1.4
          ) {
            hideAnnotation(annotation)
            return null
          }

          const bounds = annotation.labelEl.getBoundingClientRect()
          const labelWidth = bounds.width || 84
          const labelHeight = bounds.height || 28

          return {
            annotation,
            height: labelHeight,
            side: cameraSpacePoint.x < 0 ? "left" as const : "right" as const,
            screenX: (screenPoint.x * 0.5 + 0.5) * viewportWidth,
            screenY: (-screenPoint.y * 0.5 + 0.5) * viewportHeight,
            width: labelWidth,
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)

      const leftItems = visible
        .filter((item) => item.side === "left")
        .sort((a, b) => a.screenY - b.screenY)
      const rightItems = visible
        .filter((item) => item.side === "right")
        .sort((a, b) => a.screenY - b.screenY)

      const applyLayout = (
        items: typeof leftItems,
        side: "left" | "right",
      ) => {
        const tops = distributeLabelTops(
          items.map((item) => ({
            desiredTop: item.screenY - item.height * 0.5,
            height: item.height,
          })),
          safeTop,
          safeBottom,
          labelGap,
        )

        items.forEach((item, index) => {
          const labelLeft =
            side === "left"
              ? sidePadding
              : viewportWidth - sidePadding - item.width
          const labelTop = tops[index]
          const labelCenterY = labelTop + item.height * 0.5
          const labelEdgeX =
            side === "left" ? labelLeft + item.width : labelLeft
          const elbowX =
            side === "left"
              ? Math.max(labelEdgeX + 12, item.screenX - 34)
              : Math.min(labelEdgeX - 12, item.screenX + 34)

          item.annotation.labelEl.style.opacity = "1"
          item.annotation.labelEl.style.transform = `translate(${labelLeft}px, ${labelTop}px)`

          item.annotation.lineEl.style.display = "block"
          item.annotation.lineEl.setAttribute(
            "points",
            `${item.screenX},${item.screenY} ${item.screenX},${labelCenterY} ${elbowX},${labelCenterY} ${labelEdgeX},${labelCenterY}`,
          )

          item.annotation.dotEl.style.display = "block"
          item.annotation.dotEl.setAttribute("cx", item.screenX.toFixed(2))
          item.annotation.dotEl.setAttribute("cy", item.screenY.toFixed(2))
        })
      }

      applyLayout(leftItems, "left")
      applyLayout(rightItems, "right")
    }

    const buildAnnotations = (model: THREE.Object3D) => {
      clearAnnotations()
      model.updateWorldMatrix(true, true)

      const componentRoots = collectComponentRoots(model)

      componentRoots
        .map((componentRoot) => ({
          label: resolveComponentLabel(componentRoot),
          node: componentRoot,
        }))
        .filter((component) => component.label.length > 0)
        .sort((left, right) => left.label.localeCompare(right.label))
        .forEach((component, index) => {
          const bounds = new THREE.Box3().setFromObject(component.node)
          if (bounds.isEmpty()) return

          const center = bounds.getCenter(new THREE.Vector3())
          const anchorWorld = new THREE.Vector3(center.x, bounds.max.y, center.z)
          const palette = ANNOTATION_PALETTES[index % ANNOTATION_PALETTES.length]
          const labelEl = createAnnotationLabel(component.label, palette)

          const lineEl = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "polyline",
          )
          lineEl.setAttribute("fill", "none")
          lineEl.setAttribute("stroke", palette.line)
          lineEl.setAttribute("stroke-width", "1.4")
          lineEl.setAttribute("stroke-linecap", "round")
          lineEl.setAttribute("stroke-linejoin", "round")
          lineEl.style.display = "none"

          const dotEl = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle",
          )
          dotEl.setAttribute("r", "4.2")
          dotEl.setAttribute("fill", palette.dot)
          dotEl.setAttribute("stroke", "rgba(255, 255, 255, 0.95)")
          dotEl.setAttribute("stroke-width", "1")
          dotEl.style.display = "none"

          annotationLabels.appendChild(labelEl)
          annotationSvg.appendChild(lineEl)
          annotationSvg.appendChild(dotEl)

          annotations.push({
            anchorWorld,
            dotEl,
            id: component.label,
            labelEl,
            lineEl,
            palette,
          })
        })

      layoutAnnotations()
    }

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

          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((material) => applyTransparency(material))
          } else {
            applyTransparency(mesh.material)
          }

          mesh.renderOrder = 1
        })

        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = 3.5 / maxDim
        model.scale.setScalar(scale)
        model.position.sub(center.multiplyScalar(scale))

        const groundedBox = new THREE.Box3().setFromObject(model)
        model.position.y -= groundedBox.min.y

        scene.add(model)
        buildAnnotations(model)

        const sphere = new THREE.Sphere()
        new THREE.Box3().setFromObject(model).getBoundingSphere(sphere)
        const radius = sphere.radius
        const sphereCenter = sphere.center

        pointA.position.set(
          sphereCenter.x - radius * 1.2,
          sphereCenter.y + radius * 0.8,
          sphereCenter.z + radius,
        )
        pointB.position.set(
          sphereCenter.x + radius,
          sphereCenter.y + radius * 0.2,
          sphereCenter.z - radius * 1.2,
        )

        camera.position.set(
          sphereCenter.x + radius * 2.2,
          sphereCenter.y + radius * 1.4,
          sphereCenter.z + radius * 2.2,
        )
        controls.target.copy(sphereCenter)
        controls.update()
        layoutAnnotations()
      },
      undefined,
      (error) => {
        console.error("GLB load error:", error)
      },
    )

    let animationFrameId = 0
    const clock = new THREE.Clock()

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)
      const elapsed = clock.getElapsedTime()

      if (loadingMesh) {
        loadingMesh.rotation.z += 0.04
      }

      pointA.intensity = 3.0 + Math.sin(elapsed * 1.2) * 0.8
      pointB.intensity = 2.0 + Math.sin(elapsed * 0.9 + 1.5) * 0.6

      controls.update()
      renderer.render(scene, camera)
      layoutAnnotations()
    }

    animate()

    const onResize = () => {
      const nextWidth = mount.clientWidth
      const nextHeight = mount.clientHeight
      camera.aspect = nextWidth / nextHeight
      camera.updateProjectionMatrix()
      renderer.setSize(nextWidth, nextHeight)
      layoutAnnotations()
    }

    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(animationFrameId)
      clearAnnotations()
      controls.dispose()
      envTex.dispose()
      renderer.dispose()

      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0d0d1a",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      >
        <svg
          ref={annotationSvgRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
        />
        <div
          ref={annotationLabelsRef}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
          }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          background:
            "linear-gradient(to bottom, rgba(5, 5, 20, 0.88), rgba(5, 5, 20, 0.24), transparent)",
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <span
            style={{
              color: "#c8d8ff",
              fontFamily: "\"Space Grotesk\", system-ui, sans-serif",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}
          >
            Mesh CAD File
          </span>
          <span
            style={{
              color: "rgba(200, 216, 255, 0.62)",
              fontFamily: "\"IBM Plex Mono\", Consolas, monospace",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Part Index Overlay
          </span>
        </div>

        <a
          href="/"
          style={{
            color: "#90caf9",
            fontFamily: "system-ui",
            fontSize: 13,
            textDecoration: "none",
            pointerEvents: "auto",
            padding: "4px 12px",
            borderRadius: 6,
            border: "1px solid rgba(144, 202, 249, 0.3)",
            background: "rgba(0, 0, 0, 0.35)",
          }}
        >
          Back
        </a>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          color: "rgba(180, 200, 255, 0.56)",
          fontFamily: "\"IBM Plex Mono\", Consolas, monospace",
          fontSize: 12,
          letterSpacing: "0.08em",
          background: "rgba(0, 0, 0, 0.3)",
          padding: "6px 16px",
          borderRadius: 20,
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        Orbit / Pan / Zoom
      </div>
    </div>
  )
}
