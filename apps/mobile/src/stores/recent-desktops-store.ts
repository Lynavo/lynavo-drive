import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RecentDesktopDTO } from '@syncflow/contracts';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = '@vividrop/recent_desktops';

export async function loadRecentDesktopsFromStorage(): Promise<RecentDesktopDTO[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentDesktopDTO[];
  } catch (error) {
    console.warn('[recent-desktops-store] Failed to load recent desktops:', error);
    return [];
  }
}

export async function saveRecentDesktopsToStorage(desktops: RecentDesktopDTO[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(desktops));
  } catch (error) {
    console.warn('[recent-desktops-store] Failed to save recent desktops:', error);
  }
}

export interface RecentDesktopsContextValue {
  recentDesktops: RecentDesktopDTO[];
  isLoading: boolean;
  addDesktop: (desktop: Omit<RecentDesktopDTO, 'lastConnectedAt'>) => Promise<void>;
  forgetDesktop: (desktopDeviceId: string) => Promise<void>;
  updateAuthStatus: (
    desktopDeviceId: string,
    status: RecentDesktopDTO['authorizationStatus']
  ) => Promise<void>;
}

export const RecentDesktopsContext = createContext<RecentDesktopsContextValue | null>(null);

export function RecentDesktopsProvider({ children }: { children: React.ReactNode }) {
  const [recentDesktops, setRecentDesktops] = useState<RecentDesktopDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    loadRecentDesktopsFromStorage().then(data => {
      if (active) {
        setRecentDesktops(data);
        setIsLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const addDesktop = useCallback(async (desktop: Omit<RecentDesktopDTO, 'lastConnectedAt'>) => {
    const nowStr = new Date().toISOString();
    setRecentDesktops(prev => {
      const filtered = prev.filter(d => d.desktopDeviceId !== desktop.desktopDeviceId);
      const newDesktop: RecentDesktopDTO = {
        ...desktop,
        lastConnectedAt: nowStr,
      };
      const updated = [newDesktop, ...filtered];
      updated.sort((a, b) => new Date(b.lastConnectedAt).getTime() - new Date(a.lastConnectedAt).getTime());
      void saveRecentDesktopsToStorage(updated);
      return updated;
    });
  }, []);

  const forgetDesktop = useCallback(async (desktopDeviceId: string) => {
    setRecentDesktops(prev => {
      const updated = prev.filter(d => d.desktopDeviceId !== desktopDeviceId);
      void saveRecentDesktopsToStorage(updated);
      return updated;
    });
  }, []);

  const updateAuthStatus = useCallback(
    async (desktopDeviceId: string, status: RecentDesktopDTO['authorizationStatus']) => {
      setRecentDesktops(prev => {
        const updated = prev.map(d => {
          if (d.desktopDeviceId === desktopDeviceId) {
            return { ...d, authorizationStatus: status };
          }
          return d;
        });
        void saveRecentDesktopsToStorage(updated);
        return updated;
      });
    },
    []
  );

  return (
    React.createElement(RecentDesktopsContext.Provider, {
      value: {
        recentDesktops,
        isLoading,
        addDesktop,
        forgetDesktop,
        updateAuthStatus,
      }
    }, children)
  );
}

export function useRecentDesktops() {
  const context = useContext(RecentDesktopsContext);
  if (!context) {
    throw new Error('useRecentDesktops must be used within a RecentDesktopsProvider');
  }
  return context;
}
