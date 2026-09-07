import { HarnessReminder } from '../../types';

const STORAGE_KEY = 'luminara_harness_reminders';

class ReminderService {
  private reminders: HarnessReminder[] = [];
  private listeners: Array<(reminders: HarnessReminder[]) => void> = [];
  private checkInterval: any = null;

  constructor() {
    this.load();
    if (typeof window !== 'undefined') {
      this.checkInterval = setInterval(() => this.checkDueReminders(), 5000);
    }
  }

  private load(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        this.reminders = JSON.parse(saved);
      }
    } catch {
      this.reminders = [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.reminders));
    } catch {
      // storage disabled
    }
    this.notify();
  }

  public addReminder(label: string, minutes: number): HarnessReminder {
    const now = Date.now();
    const reminder: HarnessReminder = {
      id: `rem_${now}_${Math.random().toString(36).substring(2, 7)}`,
      label: label.trim() || 'Luminara Scheduled Task',
      minutes: Math.max(1, minutes),
      createdAt: now,
      dueAt: now + minutes * 60 * 1000,
      completed: false,
      notified: false
    };

    this.reminders.unshift(reminder);
    this.save();
    return reminder;
  }

  public getReminders(): HarnessReminder[] {
    return [...this.reminders];
  }

  public getActiveReminders(): HarnessReminder[] {
    return this.reminders.filter(r => !r.completed);
  }

  public getDueCount(): number {
    const now = Date.now();
    return this.reminders.filter(r => !r.completed && r.dueAt <= now).length;
  }

  public markCompleted(id: string): void {
    const r = this.reminders.find(item => item.id === id);
    if (r) {
      r.completed = true;
      this.save();
    }
  }

  public deleteReminder(id: string): void {
    this.reminders = this.reminders.filter(r => r.id !== id);
    this.save();
  }

  public clearAll(): void {
    this.reminders = [];
    this.save();
  }

  public subscribe(fn: (reminders: HarnessReminder[]) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  private notify(): void {
    this.listeners.forEach(fn => fn([...this.reminders]));
  }

  private checkDueReminders(): void {
    const now = Date.now();
    let hasChanges = false;

    this.reminders.forEach(r => {
      if (!r.completed && !r.notified && r.dueAt <= now) {
        r.notified = true;
        hasChanges = true;
        this.triggerNotification(r);
      }
    });

    if (hasChanges) {
      this.save();
    }
  }

  private triggerNotification(r: HarnessReminder): void {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('Luminara Reminder', {
          body: r.label,
          icon: '/favicon.ico'
        });
      }
    }
  }
}

export const reminderService = new ReminderService();
