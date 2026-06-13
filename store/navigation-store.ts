import { create } from "zustand"

interface NavigationState {
  activeChatId: string | null
  chats: { id: string; title: string }[]
  setActiveChatId: (id: string | null) => void
  addChat: (id: string, title: string) => void
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activeChatId: null,
  chats: [],
  setActiveChatId: (id) => set({ activeChatId: id }),
  addChat: (id, title) =>
    set((state) => ({ chats: [...state.chats, { id, title }] })),
}))
