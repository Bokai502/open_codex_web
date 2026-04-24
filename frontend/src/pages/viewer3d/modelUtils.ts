import * as THREE from "three/webgpu"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

export function applyTransparency(material: THREE.Material, opacity = 0.09) {
  material.transparent = true
  material.opacity = opacity
  material.depthWrite = false
  material.side = THREE.DoubleSide

  if (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhysicalMaterial
  ) {
    material.roughness = Math.max(material.roughness, 0.72)
    material.metalness = Math.min(material.metalness, 0.02)
    material.envMapIntensity = 0.22
  }

  material.needsUpdate = true
}

export function disposeModelResources(root: THREE.Object3D | null) {
  if (!root) return

  const disposedGeometries = new Set<THREE.BufferGeometry>()
  const disposedMaterials = new Set<THREE.Material>()
  const disposedTextures = new Set<THREE.Texture>()

  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return

    if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
      disposedGeometries.add(mesh.geometry)
      mesh.geometry.dispose()
    }

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]

    materials.forEach((material) => {
      if (disposedMaterials.has(material)) return

      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
          disposedTextures.add(value)
          value.dispose()
        }
      })

      disposedMaterials.add(material)
      material.dispose()
    })
  })
}

export function loadGltf(loader: GLTFLoader, url: string) {
  return new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
    loader.load(url, resolve, undefined, reject)
  })
}
