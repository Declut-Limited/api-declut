import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Sends through Brevo's SMTP relay via nodemailer, rather than Brevo's REST
 * API — same provider/account, different transport. Same lazy-config
 * pattern as Cloudinary/Paystack/QoreID: throws a clear 500 if SMTP_* isn't
 * set rather than failing at app boot, EXCEPT unlike FcmService's push
 * notifications, email delivery here is the critical path (forgot-password
 * literally cannot work without it reaching the user), so this throws
 * rather than silently no-op'ing.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASSWORD');

    if (!host || !port || !user || !pass) {
      throw new InternalServerErrorException(
        'Email delivery is not configured on this server yet',
      );
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 587 uses STARTTLS, not implicit TLS
      auth: { user, pass },
    });
    return this.transporter;
  }

  async sendEmail(params: {
    to: string;
    toName?: string;
    subject: string;
    html: string;
  }): Promise<void> {
    const fromEmail = this.config.get<string>('EMAIL_FROM');
    const fromName = this.config.get<string>('EMAIL_FROM_NAME', 'Declut');

    if (!fromEmail) {
      throw new InternalServerErrorException(
        'Email delivery is not configured on this server yet',
      );
    }

    const transporter = this.getTransporter();

    try {
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: params.toName ? `"${params.toName}" <${params.to}>` : params.to,
        subject: params.subject,
        html: params.html,
      });
    } catch (err) {
      this.logger.error(`SMTP send failed: ${(err as Error).message}`);
      throw new InternalServerErrorException('Failed to send email');
    }
  }

  async sendOtpEmail(
    to: string,
    name: string,
    otp: string,
    expiryMinutes: number,
  ): Promise<void> {
    await this.sendEmail({
      to,
      toName: name,
      subject: 'Your Declut verification code',
      html: `<p>Hi ${escapeHtml(name)},</p><p>Your verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${otp}</p><p>This code expires in ${expiryMinutes} minutes. If you didn't request this, you can safely ignore this email.</p>`,
    });
  }
}

// Minimal escaping — `name` is user-supplied and gets interpolated into an
// HTML email body.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
