import { create } from 'zustand';
import type { ReactNode } from 'react';

type NotificationType = 'info' | 'success' | 'warning' | 'error';

interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration?: number; // ms, undefined = persistent
}

interface Modal {
  id: string;
  title: string;
  content: ReactNode;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface NotificationStoreState {
  notifications: Notification[];
  modals: Modal[];

  // Actions
  addNotification: (notification: Omit<Notification, 'id'>) => string;
  removeNotification: (id: string) => void;
  showModal: (modal: Omit<Modal, 'id'>) => string;
  closeModal: (id: string) => void;
}

let notificationIdCounter = 0;
let modalIdCounter = 0;

export const useNotificationStore = create<NotificationStoreState>((set, get) => ({
  notifications: [],
  modals: [],

  addNotification: (notification) => {
    const id = `notification-${++notificationIdCounter}`;
    set((state) => ({
      notifications: [...state.notifications, { ...notification, id }],
    }));

    // Auto-remove after duration
    if (notification.duration) {
      setTimeout(() => {
        get().removeNotification(id);
      }, notification.duration);
    }

    return id;
  },

  removeNotification: (id) => set((state) => ({
    notifications: state.notifications.filter((n) => n.id !== id),
  })),

  showModal: (modal) => {
    const id = `modal-${++modalIdCounter}`;
    set((state) => ({
      modals: [...state.modals, { ...modal, id }],
    }));
    return id;
  },

  closeModal: (id) => set((state) => ({
    modals: state.modals.filter((m) => m.id !== id),
  })),
}));
