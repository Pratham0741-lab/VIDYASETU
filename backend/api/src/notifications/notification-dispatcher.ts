import type { NotificationIntent } from './notification-intents';

/** Where notification intents go (bound to NotificationDeliveryService). */
export abstract class NotificationDispatcher {
  abstract dispatch(intent: NotificationIntent): Promise<void>;
}
