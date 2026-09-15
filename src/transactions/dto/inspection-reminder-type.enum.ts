// The 3 predefined kinds of manual inspection reminder an admin can send —
// see TransactionsService.sendInspectionReminder(). Lives in transactions/dto
// (not admin/dto) since TransactionsService itself needs it for the
// content-building switch; the admin DTO imports it from here, matching this
// app's existing "admin depends on the feature module" direction.
export enum InspectionReminderType {
  INSPECTION_REMINDER = 'inspection_reminder',
  DEADLINE_WARNING = 'deadline_warning',
  CUSTOM_MESSAGE = 'custom_message',
}
