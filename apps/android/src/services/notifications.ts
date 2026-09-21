import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }) });

export async function configureNotifications(): Promise<Notifications.NotificationPermissionsStatus> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', { name: '提醒', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 120, 250], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC, sound: 'default' });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.status !== 'granted') return Notifications.requestPermissionsAsync();
  return current;
}

export async function scheduleReminder(title: string, body: string, date: Date): Promise<string> {
  if (!Device.isDevice) return `mock-${Date.now()}`;
  return Notifications.scheduleNotificationAsync({ content: { title, body, sound: 'default', channelId: 'reminders', vibrate: [0, 250, 120, 250], data: { type: 'reminder' } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date } });
}

export async function cancelReminder(id: string): Promise<void> { if (!id.startsWith('mock-')) await Notifications.cancelScheduledNotificationAsync(id); }

export async function openExactAlarmSettings(): Promise<void> {
  if (Platform.OS === 'android') await Linking.openSettings();
}
