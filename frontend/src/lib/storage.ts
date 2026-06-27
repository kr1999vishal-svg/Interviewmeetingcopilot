import type { Meeting, UserSettings } from '@/types';

const MEETINGS_KEY = 'mc.meetings';
const SETTINGS_KEY = 'mc.settings';

export const defaultSettings: UserSettings = {
  displayName: 'You',
  defaultDuration: 30,
  syncToServer: true,
  aiProvider: 'openai',
  aiApiKey: '',
  aiModel: '',
};

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (err) {
    console.error(`Failed to read "${key}" from localStorage`, err);
    return fallback;
  }
};

const isQuotaError = (err: unknown): boolean =>
  err instanceof DOMException &&
  (err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22);

const write = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Failed to write "${key}" to localStorage`, err);
    if (isQuotaError(err)) {
      throw new Error(
        'Storage limit reached. Remove some files or meetings to free up space.',
      );
    }
    throw err;
  }
};

export const storage = {
  getMeetings(): Meeting[] {
    return read<Meeting[]>(MEETINGS_KEY, []);
  },
  getMeeting(id: string): Meeting | undefined {
    return this.getMeetings().find((m) => m.id === id);
  },
  saveMeeting(meeting: Meeting): void {
    const meetings = this.getMeetings();
    const index = meetings.findIndex((m) => m.id === meeting.id);
    if (index >= 0) meetings[index] = meeting;
    else meetings.unshift(meeting);
    write(MEETINGS_KEY, meetings);
  },
  deleteMeeting(id: string): void {
    write(
      MEETINGS_KEY,
      this.getMeetings().filter((m) => m.id !== id),
    );
  },
  clearMeetings(): void {
    write(MEETINGS_KEY, []);
  },
  getSettings(): UserSettings {
    return { ...defaultSettings, ...read<UserSettings>(SETTINGS_KEY, defaultSettings) };
  },
  saveSettings(settings: UserSettings): void {
    write(SETTINGS_KEY, settings);
  },
};
