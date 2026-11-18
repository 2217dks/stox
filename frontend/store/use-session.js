"use client";

import { create } from "zustand";

import {
  clearAuthSession,
  fetchCurrentUser,
  getAccessToken,
  getStoredUser,
  logoutSession,
  saveAuthSession,
  updateStoredUser,
} from "@/lib/auth";

let bootstrapPromise = null;

export const useSession = create((set) => ({
  user: null,
  status: "idle", // idle | loading | authed | guest
  error: null,

  hydrate: async () => {
    if (bootstrapPromise) return bootstrapPromise;

    bootstrapPromise = (async () => {
      const token = getAccessToken();
      const storedUser = getStoredUser();

      if (!token) {
        set({ user: null, status: "guest", error: null });
        return;
      }

      // Render immediately from the cached profile, then verify in the
      // background. This keeps protected pages from flashing a loader.
      set({
        user: storedUser,
        status: storedUser ? "authed" : "loading",
        error: null,
      });

      try {
        const user = await fetchCurrentUser();

        if (user) {
          updateStoredUser(user);
          set({ user, status: "authed", error: null });
        } else {
          clearAuthSession();
          set({ user: null, status: "guest" });
        }
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          clearAuthSession();
          set({ user: null, status: "guest" });
          return;
        }

        // Network failure: keep the cached session rather than logging out.
        set((state) => ({
          status: state.user ? "authed" : "guest",
          error: error?.message || "Could not verify the session.",
        }));
      } finally {
        bootstrapPromise = null;
      }
    })();

    return bootstrapPromise;
  },

  setSession: (result) => {
    const user = saveAuthSession(result);
    set({ user, status: "authed", error: null });
    return user;
  },

  setUser: (user) => {
    if (!user) return;
    updateStoredUser(user);
    set({ user });
  },

  refreshUser: async () => {
    try {
      const user = await fetchCurrentUser();
      if (user) {
        updateStoredUser(user);
        set({ user });
        return user;
      }
      return null;
    } catch {
      return null;
    }
  },

  signOut: async () => {
    await logoutSession();
    set({ user: null, status: "guest", error: null });
  },
}));
