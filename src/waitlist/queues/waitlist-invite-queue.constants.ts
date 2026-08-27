export const WAITLIST_INVITE_QUEUE = 'waitlist-bulk-invite';

export interface WaitlistInviteRecipient {
  id: string;
  email: string;
}

export interface WaitlistBulkInviteJobData {
  recipients: WaitlistInviteRecipient[];
  message: string;
  adminId: string;
}
