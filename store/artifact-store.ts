import { create } from "zustand"
import { persist } from "zustand/middleware"

export type ArtifactType = "markdown" | "code" | "html" | "svg" | "mermaid"

export interface Artifact {
  id: string
  title: string
  type: ArtifactType
  content: string
}

interface ArtifactState {
  isOpen: boolean
  activeArtifactId: string | null
  artifacts: Artifact[]
  openPanel: (artifact?: Artifact) => void
  closePanel: () => void
  togglePanel: (artifact?: Artifact) => void
  setActiveArtifact: (id: string | null) => void
  addArtifact: (artifact: Artifact) => void
  deleteArtifact: (id: string) => void
}

export const useArtifactStore = create<ArtifactState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      activeArtifactId: null,
      artifacts: [],

      openPanel: (artifact) => {
        if (artifact) {
          const { artifacts } = get()
          const exists = artifacts.find((a) => a.id === artifact.id)
          set({
            artifacts: exists ? artifacts : [...artifacts, artifact],
            activeArtifactId: artifact.id,
            isOpen: true,
          })
        } else {
          set({ isOpen: true })
        }
      },

      closePanel: () => set({ isOpen: false, activeArtifactId: null }),

      togglePanel: (artifact) => {
        const { isOpen } = get()
        if (isOpen) {
          get().closePanel()
        } else if (artifact) {
          get().openPanel(artifact)
        } else {
          get().openPanel()
        }
      },

      setActiveArtifact: (id) => set({ activeArtifactId: id }),

      addArtifact: (artifact) =>
        set((state) => ({ artifacts: [...state.artifacts, artifact] })),
      deleteArtifact: (id) =>
        set((state) => ({
          artifacts: state.artifacts.filter((a) => a.id !== id),
          activeArtifactId: state.activeArtifactId === id ? null : state.activeArtifactId,
        })),
    }),
    {
      name: "nightcode-artifacts",
      version: 1,
    }
  )
)
