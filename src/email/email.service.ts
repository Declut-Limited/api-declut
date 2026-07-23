import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Brevo's transactional email REST API (`POST /v3/smtp/email`, `api-key`
 * header) — well-documented and stable, same confidence level as
 * PaystackService's core endpoints. Same lazy-config pattern as
 * Cloudinary/Paystack/QoreID: throws a clear 500 if BREVO_API_KEY isn't set
 * rather than failing at app boot, EXCEPT unlike FcmService's push
 * notifications, email delivery here is the critical path (forgot-password
 * literally cannot work without it reaching the user), so this throws
 * rather than silently no-op'ing.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly baseUrl = 'https://api.brevo.com/v3';

  constructor(private readonly config: ConfigService) {}

  async sendEmail(params: {
    to: string;
    toName?: string;
    subject: string;
    html: string;
  }): Promise<void> {
    const apiKey = this.config.get<string>('BREVO_API_KEY');
    const fromEmail = this.config.get<string>('EMAIL_FROM');
    const fromName = this.config.get<string>('EMAIL_FROM_NAME', 'Declut');

    if (!apiKey || !fromEmail) {
      throw new InternalServerErrorException(
        'Email delivery is not configured on this server yet',
      );
    }

    const response = await fetch(`${this.baseUrl}/smtp/email`, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email: params.to, name: params.toName }],
        subject: params.subject,
        htmlContent: params.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Brevo send failed: ${response.status} ${body}`);
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
