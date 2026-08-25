import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailtrapClient } from 'mailtrap';

/**
 * Sends via Mailtrap's own SDK (HTTP API), not SMTP — nodemailer's SMTP
 * transport hit send failures against Mailtrap, so this switched to their
 * dedicated client instead. Same lazy-config pattern as
 * Cloudinary/Paystack/QoreID: throws a clear 500 if MAILTRAP_API_KEY isn't
 * set rather than failing at app boot, EXCEPT unlike FcmService's push
 * notifications, email delivery here is the critical path (forgot-password
 * literally cannot work without it reaching the user), so this throws
 * rather than silently no-op'ing.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private client: MailtrapClient | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): MailtrapClient {
    if (this.client) return this.client;

    const token = this.config.get<string>('MAILTRAP_API_KEY');
    if (!token) {
      throw new InternalServerErrorException(
        'Email delivery is not configured on this server yet',
      );
    }

    this.client = new MailtrapClient({ token });
    return this.client;
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

    const client = this.getClient();

    try {
      await client.send({
        from: { email: fromEmail, name: fromName },
        to: [{ email: params.to, name: params.toName }],
        subject: params.subject,
        html: params.html,
      });
    } catch (err) {
      this.logger.error(`Mailtrap send failed: ${(err as Error).message}`);
      throw new InternalServerErrorException('Failed to send email');
    }
  }

  async sendOtpEmail(
    to: string,
    name: string,
    otp: string,
    expiryMinutes: number,
  ): Promise<void> {
    const { subject, html } = buildOtpEmailBody(name, otp, expiryMinutes);
    await this.sendEmail({ to, toName: name, subject, html });
  }
}

// Shared with AuthService.forgotPassword(), which echoes this back in the
// response as a dev-only fallback while Mailtrap's demo sending domain
// can't deliver to arbitrary recipients — see the comment there.
export function buildOtpEmailBody(
  name: string,
  otp: string,
  expiryMinutes: number,
): { subject: string; html: string } {
  return {
    subject: 'Your Declut verification code',
    html: `<p>Hi ${escapeHtml(name)},</p><p>Your verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${otp}</p><p>This code expires in ${expiryMinutes} minutes. If you didn't request this, you can safely ignore this email.</p>`,
  };
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
