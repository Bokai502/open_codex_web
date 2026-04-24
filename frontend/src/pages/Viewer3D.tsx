import { useEffect, useRef, useState } from "react"
import * as THREE from "three/webgpu"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import {
  ANNOTATION_PALETTES,
  DEFAULT_ANNOTATION_HEIGHT,
  DEFAULT_ANNOTATION_WIDTH,
  collectComponentRoots,
  createAnnotationLabel,
  distributeLabelTops,
  measureAnnotationLabel,
  resolveComponentLabel,
} from "./viewer3d/annotations"
import {
  fetchResolvedModel,
  buildViewerModelSource,
  getModelDisplayName,
  getModelVersion,
} from "./viewer3d/modelSource"
import { applyTransparency, disposeModelResources, loadGltf } from "./viewer3d/modelUtils"
import type { Disposable, PartAnnotation, ResolvedModel, WebGPURendererRuntime } from "./viewer3d/types"

const MAX_DEVICE_PIXEL_RATIO = 2

export default function Viewer3D() {
  const mountRef = useRef<HTMLDivElement>(null)
  const annotationSvgRef = useRef<SVGSVGElement>(null)
  const annotationLabelsRef = useRef<HTMLDivElement>(null)
  const [modelInfo, setModelInfo] = useState<ResolvedModel | null>(null)
  const [statusMessage, setStatusMessage] = useState("Resolving FreeCAD geometry...")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    const annotationSvg = annotationSvgRef.current
    const annotationLabels = annotationLabelsRef.current

    if (!mount || !annotationSvg || !annotationLabels) return

    let disposed = false
    let renderer: WebGPURendererRuntime | null = null
    let controls: OrbitControls | null = null
    let domElement: HTMLCanvasElement | null = null
    let modelRoot: THREE.Object3D | null = null
    let loadingMesh: THREE.Mesh | null = null
    let currentModelVersion: string | null = null
    let modelRefreshInFlight = false
    let lookupInterval: ReturnType<typeof setInterval> | null = null
    const modelRequest = new AbortController()
    const disposableResources: Disposable[] = []
    const annotations: PartAnnotation[] = []
    const screenPoint = new THREE.Vector3()
    const cameraSpacePoint = new THREE.Vector3()
    let annotationsNeedLayout = false

    const markAnnotationsDirty = () => {
      annotationsNeedLayout = true
    }

    const hideAnnotation = (annotation: PartAnnotation) => {
      annotation.labelEl.style.opacity = "0"
      annotation.labelEl.style.transform = "translate(-9999px, -9999px)"
      annotation.lineEl.style.display = "none"
      annotation.dotEl.style.display = "none"
    }

    const clearAnnotations = () => {
      annotations.splice(0, annotations.length)
      annotationsNeedLayout = false
      annotationLabels.replaceChildren()
      annotationSvg.replaceChildren()
    }

    const refreshAnnotationMeasurements = () => {
      annotations.forEach((annotation) => {
        const { height, width } = measureAnnotationLabel(annotation.labelEl)
        annotation.height = height
        annotation.width = width
      })
      markAnnotationsDirty()
    }

    const syncCameraForAnnotations = (camera: THREE.PerspectiveCamera) => {
      camera.updateMatrixWorld(true)
    }

    const layoutAnnotations = (
      camera: THREE.PerspectiveCamera,
      force = false,
    ) => {
      if (!force && !annotationsNeedLayout) return
      if (annotations.length === 0) {
        annotationsNeedLayout = false
        return
      }

      const viewportWidth = mount.clientWidth
      const viewportHeight = mount.clientHeight
      if (viewportWidth <= 0 || viewportHeight <= 0) return

      syncCameraForAnnotations(camera)

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

          return {
            annotation,
            height: annotation.height,
            side: cameraSpacePoint.x < 0 ? "left" as const : "right" as const,
            screenX: (screenPoint.x * 0.5 + 0.5) * viewportWidth,
            screenY: (-screenPoint.y * 0.5 + 0.5) * viewportHeight,
            width: annotation.width,
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
      annotationsNeedLayout = false
    }

    const buildAnnotations = (
      model: THREE.Object3D,
      camera: THREE.PerspectiveCamera,
    ) => {
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
            height: DEFAULT_ANNOTATION_HEIGHT,
            labelEl,
            lineEl,
            width: DEFAULT_ANNOTATION_WIDTH,
          })
        })

      refreshAnnotationMeasurements()
      layoutAnnotations(camera, true)
    }

    const init = async () => {
      const modelSource = buildViewerModelSource()
      if (!modelSource) {
        setErrorMessage("Viewer model source is unavailable.")
        setStatusMessage("")
        return
      }

      const width = mount.clientWidth
      const height = mount.clientHeight

      const nextRenderer = new THREE.WebGPURenderer({ antialias: true, alpha: false }) as unknown as WebGPURendererRuntime
      renderer = nextRenderer
      await nextRenderer.init()

      if (nextRenderer.backend?.isWebGLBackend) {
        console.info("Viewer3D renderer fallback: WebGPU unavailable in current context, running with WebGL2 backend.")
      }

      if (disposed) {
        nextRenderer.dispose()
        return
      }

      nextRenderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO),
      )
      nextRenderer.setSize(width, height)
      nextRenderer.shadowMap.enabled = true
      nextRenderer.shadowMap.type = THREE.PCFSoftShadowMap
      nextRenderer.outputColorSpace = THREE.SRGBColorSpace
      nextRenderer.toneMapping = THREE.ACESFilmicToneMapping
      nextRenderer.toneMappingExposure = 0.88
      domElement = nextRenderer.domElement
      mount.appendChild(nextRenderer.domElement)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x050914)

      const pmrem = new THREE.PMREMGenerator(nextRenderer as unknown as THREE.WebGLRenderer)
      pmrem.compileEquirectangularShader()
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      scene.environment = envTex
      scene.fog = new THREE.FogExp2(0x050914, 0.016)
      disposableResources.push(pmrem, envTex)

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000)
      camera.position.set(3, 2, 5)

      const keyLight = new THREE.DirectionalLight(0x8fbaff, 0.72)
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

      const fillLight = new THREE.DirectionalLight(0x3c6db6, 0.24)
      fillLight.position.set(-8, 4, -6)
      scene.add(fillLight)

      const rimLight = new THREE.DirectionalLight(0x6d87bb, 0.22)
      rimLight.position.set(0, -4, -10)
      scene.add(rimLight)

      const ambient = new THREE.AmbientLight(0x4c618a, 0.08)
      scene.add(ambient)

      const pointA = new THREE.PointLight(0x2f62c9, 0.8, 14)
      pointA.position.set(-2, 3, 2)
      scene.add(pointA)

      const pointB = new THREE.PointLight(0x2f8bb8, 0.42, 11)
      pointB.position.set(3, 1, -2)
      scene.add(pointB)

      const grid = new THREE.GridHelper(30, 60, 0x1d3f80, 0x0b1630)
      scene.add(grid)

      controls = new OrbitControls(camera, nextRenderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.06
      controls.minDistance = 0.3
      controls.maxDistance = 150
      controls.addEventListener("change", markAnnotationsDirty)

      loadingMesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.4, 0.05, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }),
      )
      scene.add(loadingMesh)
      disposableResources.push(loadingMesh.geometry, loadingMesh.material as THREE.Material)

      const loader = new GLTFLoader()

      const loadResolvedModel = async (resolvedModel: ResolvedModel, phase: "initial" | "refresh") => {
        const nextModelVersion = getModelVersion(resolvedModel)

        if (nextModelVersion === currentModelVersion) {
          return
        }

        setErrorMessage(null)
        setModelInfo(resolvedModel)
        setStatusMessage(phase === "initial" ? "Loading GLB..." : "Refreshing geometry...")

        const gltf = await loadGltf(loader, resolvedModel.modelUrl)

        if (disposed) return

        if (loadingMesh) {
          scene.remove(loadingMesh)
          loadingMesh = null
        }

        if (modelRoot) {
          scene.remove(modelRoot)
          disposeModelResources(modelRoot)
          modelRoot = null
        }
        clearAnnotations()

        const model = gltf.scene
        modelRoot = model

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
        const scale = maxDim > 0 ? 3.5 / maxDim : 1
        model.scale.setScalar(scale)
        model.position.sub(center.multiplyScalar(scale))

        const groundedBox = new THREE.Box3().setFromObject(model)
        model.position.y -= groundedBox.min.y

        scene.add(model)

        const sphere = new THREE.Sphere()
        new THREE.Box3().setFromObject(model).getBoundingSphere(sphere)
        const radius = Math.max(sphere.radius, 0.2)
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
        controls?.target.copy(sphereCenter)
        controls?.update()

        buildAnnotations(model, camera)
        currentModelVersion = nextModelVersion
        setStatusMessage("")
      }

      const resolveLatestModel = async (phase: "initial" | "refresh") => {
        const resolvedModel = await fetchResolvedModel(modelSource, modelRequest.signal)
        if (!resolvedModel) {
          if (phase === "initial") {
            throw new Error("Unable to resolve a FreeCAD GLB artifact.")
          }
          return
        }

        if (disposed) return

        await loadResolvedModel(resolvedModel, phase)
      }

      const clock = new THREE.Clock()
      const syncViewport = () => {
        const nextWidth = mount.clientWidth
        const nextHeight = mount.clientHeight
        if (nextWidth <= 0 || nextHeight <= 0) return

        camera.aspect = nextWidth / nextHeight
        camera.updateProjectionMatrix()
        nextRenderer.setPixelRatio(
          Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO),
        )
        nextRenderer.setSize(nextWidth, nextHeight)
        refreshAnnotationMeasurements()
        layoutAnnotations(camera, true)
      }

      const resizeObserver = new ResizeObserver(() => {
        syncViewport()
      })
      resizeObserver.observe(mount)

      document.fonts?.ready.then(() => {
        if (disposed) return
        refreshAnnotationMeasurements()
        layoutAnnotations(camera, true)
      })

      nextRenderer.setAnimationLoop(() => {
        if (disposed) return

        const elapsed = clock.getElapsedTime()

        if (loadingMesh) {
          loadingMesh.rotation.z += 0.04
        }

        pointA.intensity = 0.8 + Math.sin(elapsed * 1.2) * 0.12
        pointB.intensity = 0.42 + Math.sin(elapsed * 0.9 + 1.5) * 0.08

        controls?.update()
        nextRenderer.render(scene, camera)
        layoutAnnotations(camera)
      })

      const refreshLatestModel = (phase: "initial" | "refresh") => {
        if (modelRefreshInFlight) return
        modelRefreshInFlight = true
        void resolveLatestModel(phase)
          .catch((error: unknown) => {
            if (disposed) return
            if (phase === "initial") {
              setStatusMessage(modelSource.autoRefresh ? "Waiting for geometry_after.glb..." : "")
              setErrorMessage(
                modelSource.autoRefresh
                  ? null
                  : error instanceof Error ? error.message : "Unable to resolve a FreeCAD GLB artifact.",
              )
            } else {
              console.error("Viewer3D auto-refresh error:", error)
            }
          })
          .finally(() => {
            modelRefreshInFlight = false
          })
      }

      refreshLatestModel("initial")

      if (modelSource.autoRefresh) {
        lookupInterval = setInterval(() => {
          refreshLatestModel("refresh")
        }, 3000)
      }

      return () => {
        resizeObserver.disconnect()
        controls?.removeEventListener("change", markAnnotationsDirty)
        if (lookupInterval) {
          clearInterval(lookupInterval)
          lookupInterval = null
        }
      }
    }

    let disposeResize: (() => void) | undefined

    init()
      .then((cleanup) => {
        if (disposed) {
          cleanup?.()
          return
        }
        disposeResize = cleanup
      })
      .catch((error: unknown) => {
        if (disposed) return
        console.error("Viewer3D init error:", error)
        setErrorMessage(error instanceof Error ? error.message : "Viewer initialization failed.")
        setStatusMessage("")
      })

    return () => {
      disposed = true
      modelRequest.abort()
      disposeResize?.()
      clearAnnotations()
      controls?.dispose()
      renderer?.setAnimationLoop(null)
      if (lookupInterval) clearInterval(lookupInterval)
      disposeModelResources(modelRoot)

      disposableResources.forEach((resource) => resource.dispose())
      renderer?.dispose()

      if (mount && domElement && mount.contains(domElement)) {
        mount.removeChild(domElement)
      }
    }
  }, [])

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "radial-gradient(circle at top, #0a1730 0%, #050914 52%, #03050d 100%)",
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
          padding: "12px 20px",
          background:
            "linear-gradient(to bottom, rgba(3, 8, 20, 0.94), rgba(3, 8, 20, 0.38), transparent)",
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <span
            style={{
              color: "#b6cdfd",
              fontFamily: "\"Space Grotesk\", system-ui, sans-serif",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}
            >
            {getModelDisplayName(modelInfo)}
          </span>
          <span
            style={{
              color: "rgba(145, 172, 226, 0.62)",
              fontFamily: "\"IBM Plex Mono\", Consolas, monospace",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            {modelInfo?.runId || "Part Index Overlay"}
          </span>
        </div>
      </div>

      {(statusMessage || errorMessage) && (
        <div
          style={{
            position: "absolute",
            top: 72,
            left: 20,
            display: "grid",
            gap: 6,
            maxWidth: 520,
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(6, 12, 27, 0.66)",
            border: "1px solid rgba(92, 126, 188, 0.24)",
            backdropFilter: "blur(10px)",
            color: "#c9dbff",
            pointerEvents: "none",
          }}
        >
          {statusMessage && (
            <span
              style={{
                fontFamily: "\"IBM Plex Mono\", Consolas, monospace",
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "rgba(152, 183, 235, 0.74)",
              }}
            >
              {statusMessage}
            </span>
          )}
          {errorMessage && (
            <span
              style={{
                fontFamily: "\"IBM Plex Sans\", system-ui, sans-serif",
                fontSize: 13,
                lineHeight: 1.45,
                color: "#ffb4b4",
              }}
            >
              {errorMessage}
            </span>
          )}
        </div>
      )}

      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          color: "rgba(126, 154, 208, 0.62)",
          fontFamily: "\"IBM Plex Mono\", Consolas, monospace",
          fontSize: 12,
          letterSpacing: "0.08em",
          background: "rgba(5, 10, 22, 0.48)",
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
