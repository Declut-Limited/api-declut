import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ReportDocument = HydratedDocument<Report>;

// NEW removed 2026-09-17, explicit instruction — a report now starts
// straight at INVESTIGATING (there's no unread/untouched state anymore).
// DISPUTED added the same day — a report only ever reaches it the instant a
// seller escalates it into a formal Dispute (see ReportsService.attachDispute()),
// which is also the only moment `sellerDispute` below ever gets set.
export enum ReportStatus {
  INVESTIGATING = 'investigating',
  DISPUTED = 'disputed',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

@Schema({ timestamps: true })
export class Report {
  // RPT-#### — assigned once at creation via CounterService.
  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  reason: string;

  // A report targets a listing and/or an accused user — at least one required, checked in ReportsService (no clean schema-level "at least one of").
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Listing' })
  listing?: Types.ObjectId;

  // The specific purchase this report is about, when there is one — passed
  // directly by the client at creation time (CreateReportDto.transactionId),
  // not inferred server-side. Absent for a report with no purchase involved
  // (e.g. reporting a listing's photos, or a user directly). This is what
  // lets the admin resolve-report actions (see ReportsService.resolveRelease()/
  // resolveRefund()/resolveDelistAndRefund()) know which transaction to act
  // on — this is fundamentally a report-resolution feature, not a
  // transaction one, so the report itself carries the reference rather than
  // going through the Dispute. Added 2026-09-17, explicit instruction.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Transaction' })
  transaction?: Types.ObjectId;

  // The user being reported (typically the listing's seller, though a report
  // can also target a user directly with no listing/purchase involved at
  // all). Renamed from `user` 2026-09-17, explicit instruction, for clarity
  // against `reporter` below.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  accusedUser?: Types.ObjectId;

  // The user who actually filed this report — distinct from `accusedUser` above, which is the report's target, not its source. Now also the report's creator (users file their own reports directly), so a separate admin-authorship field is no longer meaningful — see the removed `createdBy` below.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reporter: Types.ObjectId;

  @Prop({
    type: String,
    enum: ReportStatus,
    default: ReportStatus.INVESTIGATING,
  })
  status: ReportStatus;

  // Set only at the same instant status becomes DISPUTED (see
  // ReportsService.attachDispute()) — a report doesn't store its own
  // transaction reference (the Dispute carries that, linking
  // transaction/listing/report together), so this is the only place the two
  // get tied together. Absent for a report never disputed (still
  // investigating, resolved by a direct seller refund, dismissed, or not
  // purchase-related at all). 2026-09-16.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Dispute' })
  sellerDispute?: Types.ObjectId;

  // Seller-response SLA — added 2026-09-19, explicit instruction. Both set
  // once, at report creation, only when enableSellerSLA is on at that
  // instant (see ReportsService.create()) — sellerResponseSlaTimeInHour is a
  // snapshot of the live setting so a later admin change never retroactively
  // moves an already-running deadline, same rule this app applies to
  // commissionPercentage/inspectionExtendedBy/etc.
  @Prop({ type: Date })
  sellerResponseDeadlineAt?: Date;

  @Prop({ type: Number })
  sellerResponseSlaTimeInHour?: number;

  // First admin to take any mutating action on this report (a status
  // update, or any of the three resolve actions) claims it automatically —
  // no separate "attend" endpoint, explicit instruction ("any admin who
  // first makes an action is the attendingAdmin on this case"). A different
  // admin attempting an action afterward is blocked, see
  // ReportsService.claimAttendingAdmin().
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin' })
  attendingAdmin?: Types.ObjectId;

  // Stamped once the pre-deadline reminder has actually been sent, so the
  // sweep doesn't resend it every run.
  @Prop({ type: Date })
  reminderSentAt?: Date;

  // True once the seller's response window is over — the seller responded
  // (refund or dispute). No auto-escalation on plain deadline expiry exists
  // (explicit instruction — that feature was dropped, not built), so this
  // never flips true on its own just because time ran out.
  @Prop({ type: Boolean, default: false })
  slaPeriodEnded: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
