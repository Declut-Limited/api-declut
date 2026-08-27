export const BROADCAST_QUEUE = 'notification-broadcast';

export interface BroadcastJobData {
  broadcastId: string;
  title: string;
  body: string;
}
